import { chunkMarkdown, detectPII } from "@edgebric/core/ingestion";
import { createMILMClient, createMKBClient } from "@edgebric/edge";
import { runtimeEdgeConfig } from "../config.js";
import { registerChunks, clearChunksForDocument } from "../services/chunkRegistry.js";
import { setDocument } from "../services/documentStore.js";
import { extractDocument } from "./extractors.js";
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

    const piiWarnings = detectPII(chunks);
    if (piiWarnings.length > 0) {
      // Store warnings on the document for admin review
      // Admin must confirm before proceeding (UI flow — not implemented yet)
      console.warn(`PII detected in ${doc.name}:`, piiWarnings);
      // For now, continue ingestion. UI will surface the warnings separately.
    }

    // All documents share a single mKB dataset.
    // This lets a single search call retrieve relevant chunks across the entire corpus.
    // Consequence: deleting a document does not remove its chunks from the index (V2 limitation).
    const datasetName = "knowledge-base";
    await mkb.createDataset(datasetName); // no-op if already exists

    // Clear any previous registry entries for this document (handles re-ingestion)
    clearChunksForDocument(doc.id);

    // Snapshot chunk count before upload so we can compute the mKB-assigned chunkIds.
    // mKB assigns chunkIds as "{datasetName}-{0-indexed-position}" sequentially
    // across all uploads to the dataset.
    const startIndex = await mkb.getDatasetChunkCount(datasetName);
    console.log(`Ingesting ${doc.name}: startIndex=${startIndex}, chunkCount=${chunks.length}`);

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
      console.warn(
        `Chunk ID offset mismatch: expected startIndex=${startIndex}, actual=${actualStartIndex}. Using actual.`,
      );
    }

    // Register chunkId → metadata so the query route can build accurate citations.
    // mKB v1.3.0 does not persist custom metadata, so we maintain this in SQLite.
    registerChunks(
      datasetName,
      actualStartIndex,
      chunks.map((c) => ({ ...c.metadata, documentName: doc.name })),
      chunks.map((c) => c.content),
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

    console.log(`Ingestion complete: ${doc.name} (${chunks.length} chunks)`);
  } catch (err) {
    console.error(`Ingestion failed for ${doc.name}:`, err);
    const failed: Document = { ...doc, status: "failed", updatedAt: new Date() };
    setDocument(failed);
  }
}
