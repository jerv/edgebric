import type { ChunkMetadata } from "@edgebric/types";
import { getDb, getSqlite } from "../db/index.js";
import { chunks, documents, knowledgeBases } from "../db/schema.js";
import { eq, sql, isNotNull, and } from "drizzle-orm";
import { encryptText, decryptText } from "../lib/crypto.js";

/**
 * Decrypt content, handling both encrypted (base64) and legacy plaintext.
 * Legacy content won't be valid base64 AES-256-GCM output, so decryption
 * will throw — in that case we return the raw string.
 */
function decryptContentSafe(content: string): string {
  try {
    return decryptText(content);
  } catch {
    // Legacy plaintext content — return as-is
    return content;
  }
}

/** Convert a DB row to ChunkMetadata. */
function rowToMeta(row: typeof chunks.$inferSelect): ChunkMetadata {
  const meta: ChunkMetadata = {
    sourceDocument: row.sourceDocument,
    sectionPath: JSON.parse(row.sectionPath) as string[],
    pageNumber: row.pageNumber,
    heading: row.heading,
    chunkIndex: row.chunkIndex,
  };
  if (row.documentName != null) meta.documentName = row.documentName;
  if (row.parentContent != null) meta.parentContent = decryptContentSafe(row.parentContent);
  return meta;
}

/**
 * Register chunks after mKB upload.
 *
 * mKB assigns chunkIds as "{datasetName}-{0-indexed-position}" sequentially.
 * We store our own metadata here since mKB v1.3.0 doesn't persist it.
 *
 * Wrapped in a transaction for performance (1 disk sync instead of N).
 * Also populates the FTS5 index for hybrid BM25+vector search.
 */
export function registerChunks(
  datasetName: string,
  startIndex: number,
  metadataList: ChunkMetadata[],
  contentList?: string[],
  parentContentList?: string[],
): void {
  const db = getDb();
  const sqlite = getSqlite();

  const ftsInsert = sqlite.prepare(
    "INSERT OR REPLACE INTO chunks_fts(chunk_id, content) VALUES (?, ?)",
  );

  db.transaction(() => {
    for (let i = 0; i < metadataList.length; i++) {
      const meta = metadataList[i]!;
      const raw = contentList?.[i] ?? null;
      const chunkContent = raw ? encryptText(raw) : null;
      const parentRaw = parentContentList?.[i] ?? null;
      const parentContent = parentRaw ? encryptText(parentRaw) : null;
      const chunkId = `${datasetName}-${startIndex + i}`;

      db.insert(chunks)
        .values({
          chunkId,
          sourceDocument: meta.sourceDocument,
          documentName: meta.documentName ?? null,
          sectionPath: JSON.stringify(meta.sectionPath),
          pageNumber: meta.pageNumber,
          heading: meta.heading,
          chunkIndex: meta.chunkIndex,
          content: chunkContent,
          parentContent,
        })
        .onConflictDoUpdate({
          target: chunks.chunkId,
          set: {
            sourceDocument: meta.sourceDocument,
            documentName: meta.documentName ?? null,
            sectionPath: JSON.stringify(meta.sectionPath),
            pageNumber: meta.pageNumber,
            heading: meta.heading,
            chunkIndex: meta.chunkIndex,
            content: chunkContent,
            parentContent,
          },
        })
        .run();

      // Populate FTS5 index with plaintext for BM25 search
      if (raw) {
        ftsInsert.run(chunkId, raw);
      }
    }
  });
}

/** Look up metadata for a single mKB chunk. */
export function lookupChunk(chunkId: string): ChunkMetadata | undefined {
  const db = getDb();
  const row = db.select().from(chunks).where(eq(chunks.chunkId, chunkId)).get();
  return row ? rowToMeta(row) : undefined;
}

/** Get all chunks (with content) for Vault Mode sync, optionally filtered by org. */
export function getAllChunksWithContent(orgId?: string): Array<{
  chunkId: string;
  content: string;
  metadata: ChunkMetadata;
}> {
  const db = getDb();

  if (orgId) {
    // Filter chunks to those belonging to documents in KBs owned by this org
    const orgKBIds = db.select({ id: knowledgeBases.id }).from(knowledgeBases)
      .where(eq(knowledgeBases.orgId, orgId)).all().map((r) => r.id);
    if (orgKBIds.length === 0) return [];
    const orgDocIds = db.select({ id: documents.id }).from(documents)
      .where(sql`${documents.knowledgeBaseId} IN (${sql.join(orgKBIds.map((id) => sql`${id}`), sql`, `)})`)
      .all().map((r) => r.id);
    if (orgDocIds.length === 0) return [];
    const rows = db.select().from(chunks)
      .where(and(
        sql`${chunks.sourceDocument} IN (${sql.join(orgDocIds.map((id) => sql`${id}`), sql`, `)})`,
        isNotNull(chunks.content),
      ))
      .all();
    return rows.map((row) => ({
      chunkId: row.chunkId,
      content: decryptContentSafe(row.content!),
      metadata: rowToMeta(row),
    }));
  }

  const rows = db.select().from(chunks).all();
  return rows
    .filter((row) => row.content != null)
    .map((row) => ({
      chunkId: row.chunkId,
      content: decryptContentSafe(row.content!),
      metadata: rowToMeta(row),
    }));
}

/** Get all chunks for a document, ordered by chunkIndex. Used by source viewer. */
export function getChunksForDocument(documentId: string): Array<{
  chunkIndex: number;
  heading: string;
  sectionPath: string[];
  pageNumber: number;
  content: string;
}> {
  const db = getDb();
  const rows = db
    .select()
    .from(chunks)
    .where(eq(chunks.sourceDocument, documentId))
    .all();

  return rows
    .filter((row) => row.content != null)
    .map((row) => ({
      chunkIndex: row.chunkIndex,
      heading: row.heading,
      sectionPath: JSON.parse(row.sectionPath) as string[],
      pageNumber: row.pageNumber,
      content: decryptContentSafe(row.content!),
    }))
    .sort((a, b) => a.chunkIndex - b.chunkIndex);
}

/** Remove all chunks belonging to a document. */
export function clearChunksForDocument(documentId: string): void {
  const db = getDb();
  const sqlite = getSqlite();

  // Get chunk IDs before deleting so we can clean FTS5
  const rows = db.select({ chunkId: chunks.chunkId })
    .from(chunks)
    .where(eq(chunks.sourceDocument, documentId))
    .all();

  db.delete(chunks).where(eq(chunks.sourceDocument, documentId)).run();

  // Clean FTS5 index
  if (rows.length > 0) {
    const deleteStmt = sqlite.prepare("DELETE FROM chunks_fts WHERE chunk_id = ?");
    const tx = sqlite.transaction((ids: string[]) => {
      for (const id of ids) deleteStmt.run(id);
    });
    tx(rows.map((r) => r.chunkId));
  }
}

/**
 * Get all chunks belonging to a specific mKB dataset, with content.
 * Used by rebuildDataset to re-upload remaining chunks after deletion.
 */
export function getChunksForDataset(datasetName: string): Array<{
  chunkId: string;
  content: string;
  metadata: ChunkMetadata;
}> {
  const db = getDb();
  const rows = db.select().from(chunks)
    .where(sql`${chunks.chunkId} LIKE ${datasetName + "-%"}`)
    .all();

  return rows
    .filter((row) => row.content != null)
    .map((row) => ({
      chunkId: row.chunkId,
      content: decryptContentSafe(row.content!),
      metadata: rowToMeta(row),
    }))
    .sort((a, b) => {
      // Sort by chunk index to maintain order
      const idxA = parseInt(a.chunkId.split("-").pop() ?? "0", 10);
      const idxB = parseInt(b.chunkId.split("-").pop() ?? "0", 10);
      return idxA - idxB;
    });
}

/** Clear all chunk registry entries for a dataset. */
export function clearChunksForDataset(datasetName: string): void {
  const db = getDb();
  const sqlite = getSqlite();

  // Get chunk IDs before deleting so we can clean FTS5
  const rows = db.select({ chunkId: chunks.chunkId })
    .from(chunks)
    .where(sql`${chunks.chunkId} LIKE ${datasetName + "-%"}`)
    .all();

  db.run(sql`DELETE FROM ${chunks} WHERE ${chunks.chunkId} LIKE ${datasetName + "-%"}`);

  // Clean FTS5 index
  if (rows.length > 0) {
    const deleteStmt = sqlite.prepare("DELETE FROM chunks_fts WHERE chunk_id = ?");
    const tx = sqlite.transaction((ids: string[]) => {
      for (const id of ids) deleteStmt.run(id);
    });
    tx(rows.map((r) => r.chunkId));
  }
}

/**
 * Remove orphaned chunk registry entries whose source document no longer exists.
 * Called at startup to keep the registry in sync with the documents table.
 * Note: mKB datasets are now rebuilt on document deletion, so orphaned mKB chunks
 * should not accumulate. This is a safety net for edge cases.
 */
export function purgeOrphanedChunks(): number {
  const db = getDb();
  const result = db.run(
    sql`DELETE FROM ${chunks} WHERE ${chunks.sourceDocument} NOT IN (SELECT ${documents.id} FROM ${documents})`,
  );
  return result.changes;
}
