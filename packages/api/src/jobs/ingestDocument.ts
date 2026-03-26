import { chunkMarkdown, detectPII } from "@edgebric/core/ingestion";
import { createMILMClient, createMKBClient } from "@edgebric/edge";
import { runtimeEdgeConfig } from "../config.js";
import { registerChunks, clearChunksForDocument } from "../services/chunkRegistry.js";
import { setDocument } from "../services/documentStore.js";
import { refreshDocumentCount } from "../services/dataSourceStore.js";
import { extractDocument } from "./extractors.js";
import { logger } from "../lib/logger.js";
import type { Document } from "@edgebric/types";

const milm = createMILMClient(runtimeEdgeConfig);
const mkb = createMKBClient(runtimeEdgeConfig);

/**
 * Background ingestion job.
 *
 * Flow:
 * 1. Read file from disk
 * 2. Extract text (Docling/Mammoth/pass-through — TODO: full extraction in spike)
 * 3. Chunk the extracted markdown
 * 4. Run PII detection
 * 5. Embed each chunk via mILM
 * 6. Upload embedded chunks to mKB
 * 7. Update document status
 *
 * For MVP, text extraction is a placeholder — the spike will determine
 * the exact Docling integration (Python subprocess or JS wrapper).
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
    await mkb.createDataset(datasetName); // no-op if already exists

    // Clear any previous registry entries for this document (handles re-ingestion)
    clearChunksForDocument(doc.id);

    // Snapshot chunk count before upload so we can compute the mKB-assigned chunkIds.
    // mKB assigns chunkIds as "{datasetName}-{0-indexed-position}" sequentially
    // across all uploads to the dataset.
    const startIndex = await mkb.getDatasetChunkCount(datasetName);
    logger.info({ docName: doc.name, startIndex, chunkCount: chunks.length }, "Ingesting document");

    // Embed each chunk
    const embeddedChunks: Array<{ text: string; embedding: number[] }> = [];
    for (const chunk of chunks) {
      const embedding = await milm.embed(chunk.content);
      embeddedChunks.push({ text: chunk.content, embedding });
    }
    await mkb.uploadChunks(datasetName, embeddedChunks);

    // Verify post-upload count matches expectations
    const postCount = await mkb.getDatasetChunkCount(datasetName);
    const actualStartIndex = postCount - chunks.length;
    if (actualStartIndex !== startIndex) {
      logger.warn(
        { expected: startIndex, actual: actualStartIndex },
        "Chunk ID offset mismatch — using actual",
      );
    }

    // Register chunkId → metadata so the query route can build accurate citations.
    // mKB v1.3.0 does not persist custom metadata, so we maintain this in SQLite.
    // Also stores parent content for parent-child retrieval and populates FTS5 for BM25 search.
    registerChunks(
      datasetName,
      actualStartIndex,
      chunks.map((c) => ({ ...c.metadata, documentName: doc.name })),
      chunks.map((c) => c.content),
      chunks.map((c) => c.metadata.parentContent ?? c.content),
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
