import fs from "fs/promises";
import { chunkMarkdown, detectPII } from "@edgebric/core/ingestion";
import { createMILMClient } from "@edgebric/edge";
import { createMKBClient } from "@edgebric/edge";
import { config } from "../config.js";
import type { Document, EmbeddedChunk } from "@edgebric/types";

const milm = createMILMClient(config.edge);
const mkb = createMKBClient(config.edge);

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
  documents: Map<string, Document>,
): Promise<void> {
  try {
    const rawContent = await fs.readFile(doc.storageKey);

    // TODO (Spike 3): Replace this with Docling/Mammoth routing based on doc.type
    // For now, assume the file is plain text or markdown for development
    const markdownContent = rawContent.toString("utf-8");

    const chunks = chunkMarkdown(markdownContent, doc.id);

    const piiWarnings = detectPII(chunks);
    if (piiWarnings.length > 0) {
      // Store warnings on the document for admin review
      // Admin must confirm before proceeding (UI flow — not implemented yet)
      console.warn(`PII detected in ${doc.name}:`, piiWarnings);
      // For now, continue ingestion. UI will surface the warnings separately.
    }

    // Create a dataset in mKB for this document
    const datasetName = `doc-${doc.id}`;
    await mkb.createDataset(datasetName);

    // Embed and collect all chunks
    const embeddedChunks: EmbeddedChunk[] = [];
    for (const chunk of chunks) {
      const embedding = await milm.embed(chunk.content);
      embeddedChunks.push({ ...chunk, embedding });
    }

    // Upload to mKB
    await mkb.uploadChunks(datasetName, embeddedChunks);

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
    documents.set(doc.id, updated);

    console.log(`Ingestion complete: ${doc.name} (${chunks.length} chunks)`);
  } catch (err) {
    console.error(`Ingestion failed for ${doc.name}:`, err);
    const failed: Document = { ...doc, status: "failed", updatedAt: new Date() };
    documents.set(doc.id, failed);
  }
}
