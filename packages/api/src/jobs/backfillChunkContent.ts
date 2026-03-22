/**
 * One-time backfill: populate the `content` column for chunks that were
 * inserted before Vault Mode sync was added.
 *
 * For each document with contentless chunks:
 * 1. Re-extract text from the stored file
 * 2. Re-chunk the markdown
 * 3. Match chunks by (sourceDocument, chunkIndex) and fill in content
 */
import { chunkMarkdown } from "@edgebric/core/ingestion";
import type { Document } from "@edgebric/types";
import { getDb } from "../db/index.js";
import { chunks, documents } from "../db/schema.js";
import { eq, isNull } from "drizzle-orm";
import { extractDocument } from "./extractors.js";
import { logger } from "../lib/logger.js";
import { encryptText } from "../lib/crypto.js";

export async function backfillChunkContent(): Promise<void> {
  const db = getDb();

  // Find distinct source documents that have chunks with no content
  const contentlessChunks = db
    .select({ sourceDocument: chunks.sourceDocument })
    .from(chunks)
    .where(isNull(chunks.content))
    .all();

  const docIds = [...new Set(contentlessChunks.map((c) => c.sourceDocument))];
  if (docIds.length === 0) return;

  logger.info({ count: docIds.length }, "Backfill: documents have chunks without content");

  for (const docId of docIds) {
    const docRow = db.select().from(documents).where(eq(documents.id, docId)).get();
    if (!docRow) {
      logger.warn({ docId }, "Backfill: document not found, skipping");
      continue;
    }

    try {
      const { markdown } = await extractDocument(docRow.storageKey, docRow.type as Document["type"]);
      const reChunked = chunkMarkdown(markdown, docId);

      // Build lookup: chunkIndex → content
      const contentByIndex = new Map<number, string>();
      for (const c of reChunked) {
        contentByIndex.set(c.metadata.chunkIndex, c.content);
      }

      // Update chunks that belong to this document and have no content
      const docChunks = db
        .select()
        .from(chunks)
        .where(eq(chunks.sourceDocument, docId))
        .all();

      let filled = 0;
      for (const row of docChunks) {
        if (row.content != null) continue;
        const content = contentByIndex.get(row.chunkIndex);
        if (content) {
          db.update(chunks)
            .set({ content: encryptText(content) })
            .where(eq(chunks.chunkId, row.chunkId))
            .run();
          filled++;
        }
      }
      logger.info({ docName: docRow.name, filled, total: docChunks.length }, "Backfill: filled chunks");
    } catch (err) {
      logger.warn({ err, docName: docRow.name }, "Backfill: failed for document");
    }
  }
}
