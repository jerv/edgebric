import type { ChunkMetadata } from "@edgebric/types";
import { getDb, getSqlite } from "../db/index.js";
import { chunks, documents, dataSources } from "../db/schema.js";
import { eq, sql, isNotNull, and } from "drizzle-orm";
import { encryptText, decryptText, addEmbeddingNoise, shiftQueryEmbedding } from "../lib/crypto.js";

/**
 * Escape LIKE special characters (%, _) so dataset names containing
 * wildcards don't match other datasets' chunks.
 * Uses backslash as the escape char — callers MUST add ESCAPE '\\' to the LIKE clause.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

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
 * Register chunks with metadata, content, and embeddings.
 *
 * ChunkIds are assigned as "{datasetName}-{0-indexed-position}" sequentially.
 * Stores metadata in the chunks table, plaintext in FTS5 for BM25 search,
 * and embedding vectors in sqlite-vec for semantic similarity search.
 *
 * Wrapped in a transaction for performance (1 disk sync instead of N).
 */
export function registerChunks(
  datasetName: string,
  startIndex: number,
  metadataList: ChunkMetadata[],
  contentList?: string[],
  parentContentList?: string[],
  embeddings?: number[][],
): void {
  const db = getDb();
  const sqlite = getSqlite();

  const ftsInsert = sqlite.prepare(
    "INSERT OR REPLACE INTO chunks_fts(chunk_id, content) VALUES (?, ?)",
  );
  const vecInsert = sqlite.prepare(
    "INSERT OR REPLACE INTO chunks_vec(chunk_id, embedding) VALUES (?, ?)",
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

      // Store noise-protected embedding vector for semantic search.
      // Noise is shared per dataset (derived from master key + datasetName),
      // so sqlite-vec ANN still works — shift the query by the same noise.
      if (embeddings?.[i]) {
        const noised = addEmbeddingNoise(embeddings[i]!, datasetName);
        const vecBuf = new Float32Array(noised);
        vecInsert.run(chunkId, Buffer.from(vecBuf.buffer));
      }
    }
  });
}

// ─── Vector Search ──────────────────────────────────────────────────────────

interface VecSearchRow {
  chunk_id: string;
  distance: number;
}

/**
 * Semantic vector search using sqlite-vec with embedding noise protection.
 *
 * Noise is shared per dataset: all chunks in a dataset are shifted by the
 * same HMAC-derived vector. To search, we shift the query embedding by the
 * same noise per dataset, which preserves L2 distances:
 *   L2(real + noise, query + noise) = L2(real, query)
 *
 * For multi-dataset searches, we run one ANN query per dataset (each with
 * its own noise-shifted query), then merge and sort.
 */
export function vectorSearch(
  queryEmbedding: number[],
  datasetNames: string[],
  topN: number,
): Array<{ chunkId: string; chunk: string; similarity: number; metadata: ChunkMetadata }> {
  const sqlite = getSqlite();

  const stmt = sqlite.prepare(`
    SELECT chunk_id, distance
    FROM chunks_vec
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `);

  // Run one ANN query per dataset with the appropriately noise-shifted query
  const candidateLimit = topN * 3;
  const allResults: Array<{ chunkId: string; distance: number }> = [];

  for (const ds of datasetNames) {
    const shifted = shiftQueryEmbedding(queryEmbedding, ds);
    const vecBuf = new Float32Array(shifted);
    const queryBlob = Buffer.from(vecBuf.buffer);

    const rows = stmt.all(queryBlob, candidateLimit) as VecSearchRow[];
    const prefix = `${ds}-`;

    for (const r of rows) {
      if (r.chunk_id.startsWith(prefix)) {
        allResults.push({ chunkId: r.chunk_id, distance: r.distance });
      }
    }
  }

  // Sort by distance ascending (closest first), take top-N
  allResults.sort((a, b) => a.distance - b.distance);

  return allResults.slice(0, topN).map((r) => {
    const meta = lookupChunk(r.chunkId);
    const content = getChunkContent(r.chunkId);
    return {
      chunkId: r.chunkId,
      chunk: content ?? "",
      similarity: 1 / (1 + r.distance), // Convert distance to 0-1 similarity
      metadata: meta ?? {
        sourceDocument: "",
        sectionPath: [],
        pageNumber: 0,
        heading: "",
        chunkIndex: 0,
      },
    };
  });
}

/** Get decrypted content for a single chunk. */
function getChunkContent(chunkId: string): string | null {
  const db = getDb();
  const row = db.select({ content: chunks.content }).from(chunks).where(eq(chunks.chunkId, chunkId)).get();
  if (!row?.content) return null;
  return decryptContentSafe(row.content);
}

/** Get the number of chunks in a dataset (by prefix match on chunkId). */
export function getChunkCountForDataset(datasetName: string): number {
  const sqlite = getSqlite();
  const row = sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM chunks WHERE chunk_id LIKE ? ESCAPE '\\'",
  ).get(`${escapeLikePattern(datasetName)}-%`) as { cnt: number };
  return row.cnt;
}

/** Look up metadata for a single chunk. */
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
    // Filter chunks to those belonging to documents in data sources owned by this org
    const orgDsIds = db.select({ id: dataSources.id }).from(dataSources)
      .where(eq(dataSources.orgId, orgId)).all().map((r) => r.id);
    if (orgDsIds.length === 0) return [];
    const orgDocIds = db.select({ id: documents.id }).from(documents)
      .where(sql`${documents.dataSourceId} IN (${sql.join(orgDsIds.map((id) => sql`${id}`), sql`, `)})`)
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

  // Get chunk IDs before deleting so we can clean FTS5 + vec
  const rows = db.select({ chunkId: chunks.chunkId })
    .from(chunks)
    .where(eq(chunks.sourceDocument, documentId))
    .all();

  db.delete(chunks).where(eq(chunks.sourceDocument, documentId)).run();

  // Clean FTS5 and vector indexes
  if (rows.length > 0) {
    const deleteFts = sqlite.prepare("DELETE FROM chunks_fts WHERE chunk_id = ?");
    const deleteVec = sqlite.prepare("DELETE FROM chunks_vec WHERE chunk_id = ?");
    const tx = sqlite.transaction((ids: string[]) => {
      for (const id of ids) {
        deleteFts.run(id);
        deleteVec.run(id);
      }
    });
    tx(rows.map((r) => r.chunkId));
  }
}

/**
 * Get all chunks belonging to a specific dataset, with content.
 * Used by rebuildDataset to re-embed remaining chunks after deletion.
 */
export function getChunksForDataset(datasetName: string): Array<{
  chunkId: string;
  content: string;
  metadata: ChunkMetadata;
}> {
  const db = getDb();
  const escaped = escapeLikePattern(datasetName);
  const rows = db.select().from(chunks)
    .where(sql`${chunks.chunkId} LIKE ${escaped + "-%"} ESCAPE '\\'`)
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

  // Get chunk IDs before deleting so we can clean FTS5 + vec
  const escaped = escapeLikePattern(datasetName);
  const rows = db.select({ chunkId: chunks.chunkId })
    .from(chunks)
    .where(sql`${chunks.chunkId} LIKE ${escaped + "-%"} ESCAPE '\\'`)
    .all();

  db.run(sql`DELETE FROM ${chunks} WHERE ${chunks.chunkId} LIKE ${escaped + "-%"} ESCAPE '\\'`);

  // Clean FTS5 and vector indexes
  if (rows.length > 0) {
    const deleteFts = sqlite.prepare("DELETE FROM chunks_fts WHERE chunk_id = ?");
    const deleteVec = sqlite.prepare("DELETE FROM chunks_vec WHERE chunk_id = ?");
    const tx = sqlite.transaction((ids: string[]) => {
      for (const id of ids) {
        deleteFts.run(id);
        deleteVec.run(id);
      }
    });
    tx(rows.map((r) => r.chunkId));
  }
}

/**
 * Remove orphaned chunk registry entries whose source document no longer exists.
 * Called at startup to keep the registry in sync with the documents table.
 * Datasets are rebuilt on document deletion, so orphaned chunks should not
 * accumulate. This is a safety net for edge cases.
 */
export function purgeOrphanedChunks(): number {
  const db = getDb();
  const result = db.run(
    sql`DELETE FROM ${chunks} WHERE ${chunks.sourceDocument} NOT IN (SELECT ${documents.id} FROM ${documents})`,
  );
  return result.changes;
}
