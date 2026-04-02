import { chunkMarkdown, detectPII } from "@edgebric/core/ingestion";
import { embed } from "../services/inferenceClient.js";
import { registerChunks, clearChunksForDocument, getChunkCountForDataset } from "../services/chunkRegistry.js";
import { setDocument } from "../services/documentStore.js";
import { refreshDocumentCount } from "../services/dataSourceStore.js";
import { extractDocument } from "./extractors.js";
import { logger } from "../lib/logger.js";
import type { Document } from "@edgebric/types";

/**
 * Background ingestion job.
 *
 * Flow:
 * 1. Read file from disk
 * 2. Extract text (Mammoth for docx, pass-through for txt/md)
 * 3. Chunk the extracted markdown
 * 4. Run PII detection
 * 5. Embed each chunk via Ollama
 * 6. Store chunks with embeddings in SQLite (metadata + FTS5 + sqlite-vec)
 * 7. Update document status
 */
export async function ingestDocument(
  doc: Document,
  options?: { skipPII?: boolean; datasetName?: string },
): Promise<void> {
  try {
    const { markdown, headingPageMap } = await extractDocument(doc.storageKey, doc.type);
    const chunks = chunkMarkdown(markdown, doc.id);

    // Annotate page numbers for PDF chunks (others default to 0)
    if (headingPageMap.size > 0) {
      for (const chunk of chunks) {
        const page = headingPageMap.get(chunk.metadata.heading);
        if (page !== undefined) chunk.metadata.pageNumber = page;
      }
    }

    const piiWarnings = options?.skipPII ? [] : detectPII(chunks);
    if (piiWarnings.length > 0) {
      logger.warn({ docName: doc.name, count: piiWarnings.length }, "PII detected in document");
      const paused: Document = {
        ...doc,
        status: "pii_review",
        updatedAt: new Date(),
        piiWarnings,
        sectionHeadings: [
          ...new Set(chunks.map((c) => c.metadata.heading).filter(Boolean)),
        ],
      };
      setDocument(paused);
      return; // Halt — admin must approve before ingestion continues
    }

    // Use data-source-scoped dataset name, or fall back to the legacy shared dataset.
    const datasetName = options?.datasetName ?? "knowledge-base";

    // Clear any previous registry entries for this document (handles re-ingestion)
    clearChunksForDocument(doc.id);

    // Get current chunk count for this dataset to compute sequential chunkIds.
    // ChunkIds are assigned as "{datasetName}-{index}" sequentially.
    const startIndex = getChunkCountForDataset(datasetName);
    logger.info({ docName: doc.name, startIndex, chunkCount: chunks.length }, "Ingesting document");

    // Embed each chunk via Ollama
    const embeddings: number[][] = [];
    for (const chunk of chunks) {
      const embedding = await embed(chunk.content);
      embeddings.push(embedding);
    }

    // Store chunks with metadata, content, and embeddings in SQLite.
    // This populates three tables atomically:
    //   - chunks (metadata + encrypted content)
    //   - chunks_fts (FTS5 full-text index for BM25)
    //   - chunks_vec (sqlite-vec embeddings for semantic search)
    registerChunks(
      datasetName,
      startIndex,
      chunks.map((c) => ({ ...c.metadata, documentName: doc.name })),
      chunks.map((c) => c.content),
      chunks.map((c) => c.metadata.parentContent ?? c.content),
      embeddings,
    );

    // Update document record
    const updated: Document = {
      ...doc,
      status: "ready",
      updatedAt: new Date(),
      datasetName,
      sectionHeadings: [
        ...new Set(chunks.map((c) => c.metadata.heading).filter(Boolean)),
      ],
    };
    setDocument(updated);

    // Update the cached document count on the data source
    if (doc.dataSourceId) {
      refreshDocumentCount(doc.dataSourceId);
    }

    logger.info({ docName: doc.name, chunkCount: chunks.length }, "Ingestion complete");
  } catch (err) {
    logger.error({ err, docName: doc.name }, "Ingestion failed");
    const failed: Document = { ...doc, status: "failed", updatedAt: new Date() };
    setDocument(failed);
  }
}
