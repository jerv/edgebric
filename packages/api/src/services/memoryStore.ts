/**
 * Memory Store — manages the special "Memory" data source for storing
 * user memories (preferences, facts, instructions) that the AI can recall.
 *
 * Memory entries are stored as documents in a special data source, with
 * chunks embedded for hybrid search. No new database tables needed.
 */
import type { DataSource, Document } from "@edgebric/types";
import { randomUUID } from "crypto";
import {
  createDataSource,
  listDataSources,
  refreshDocumentCount,
} from "./dataSourceStore.js";
import { setDocument, getDocumentsByDataSource, deleteDocument, getDocument } from "./documentStore.js";
import {
  registerChunks,
  clearChunksForDocument,
  getChunkCountForDataset,
} from "./chunkRegistry.js";
import { embed } from "./inferenceClient.js";
import { getIntegrationConfig } from "./integrationConfigStore.js";
import { logger } from "../lib/logger.js";

/** Memory entry category. */
export type MemoryCategory = "preference" | "fact" | "instruction";

/** Memory entry source: explicit = user asked to remember, auto = rule-based extraction. */
export type MemorySource = "explicit" | "auto";

/** A memory entry with its metadata. */
export interface MemoryEntry {
  id: string;
  content: string;
  category: MemoryCategory;
  confidence: number;
  source: MemorySource;
  createdAt: Date;
  updatedAt: Date;
}

/** Special dataset name prefix for memory data sources. */
const MEMORY_DATASET_PREFIX = "memory";

/** Special name for the memory data source. */
const MEMORY_DS_NAME = "Memory";

/**
 * Get or create the special Memory data source.
 *
 * - Solo mode (no orgId or userId): one global memory data source
 * - Org mode with userId: per-user memory data source
 */
export function getOrCreateMemoryDataSource(orgId?: string, userId?: string): DataSource {
  const ownerId = userId ?? "solo@localhost";
  const datasetName = userId
    ? `${MEMORY_DATASET_PREFIX}-${userId.replace(/[^a-z0-9]/gi, "-").slice(0, 30)}`
    : MEMORY_DATASET_PREFIX;

  // Look for existing memory data source by dataset name
  const existing = listDataSources({ ownerId }).find(
    (ds) => ds.datasetName === datasetName,
  );
  if (existing) return existing;

  // Create the memory data source
  return createDataSource({
    name: MEMORY_DS_NAME,
    description: "AI memory — stores preferences, facts, and instructions for personalized responses.",
    type: "personal",
    ownerId,
    ...(orgId && { orgId }),
    datasetName,
    piiMode: "off", // Memory content is user-provided, no PII scanning needed
  });
}

/**
 * Check if a data source is a Memory data source.
 */
export function isMemoryDataSource(ds: DataSource): boolean {
  return ds.name === MEMORY_DS_NAME && ds.datasetName.startsWith(MEMORY_DATASET_PREFIX);
}

/**
 * Check if memory is enabled (via integration config).
 */
export function isMemoryEnabled(): boolean {
  const cfg = getIntegrationConfig();
  return (cfg as Record<string, unknown>).memoryEnabled !== false; // Default: enabled
}

/**
 * Encode memory metadata into the document name for storage.
 * Format: "memory|category|confidence|source"
 */
function encodeMemoryMeta(category: MemoryCategory, confidence: number, source: MemorySource): string {
  return `memory|${category}|${confidence}|${source}`;
}

/**
 * Decode memory metadata from a document name.
 */
function decodeMemoryMeta(name: string): { category: MemoryCategory; confidence: number; source: MemorySource } | null {
  const parts = name.split("|");
  if (parts[0] !== "memory" || parts.length < 4) return null;
  return {
    category: (parts[1] as MemoryCategory) ?? "fact",
    confidence: parseFloat(parts[2] ?? "1.0"),
    source: (parts[3] as MemorySource) ?? "explicit",
  };
}

/**
 * Convert a document from the Memory data source to a MemoryEntry.
 */
function docToMemoryEntry(doc: Document): MemoryEntry | null {
  // Try new format (metadata in sectionHeadings[0]), fall back to legacy (encoded in name)
  const metaStr = doc.sectionHeadings?.[0] ?? doc.name;
  const meta = decodeMemoryMeta(metaStr);
  if (!meta) return null;
  return {
    id: doc.id,
    content: doc.storageKey, // We store the content text in storageKey (no file needed)
    category: meta.category,
    confidence: meta.confidence,
    source: meta.source,
    createdAt: doc.uploadedAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Save a new memory entry. Creates a document, chunks it, and embeds it.
 */
export async function saveMemory(opts: {
  content: string;
  category: MemoryCategory;
  confidence?: number;
  source?: MemorySource;
  orgId?: string | undefined;
  userId?: string | undefined;
}): Promise<MemoryEntry> {
  const ds = getOrCreateMemoryDataSource(opts.orgId, opts.userId);
  const docId = randomUUID();
  const now = new Date();
  const confidence = opts.confidence ?? 1.0;
  const source = opts.source ?? "explicit";

  // Human-readable name: truncated content with category prefix
  const categoryLabel = opts.category === "fact" ? "Fact" : opts.category === "preference" ? "Preference" : opts.category === "instruction" ? "Instruction" : "Correction";
  const contentPreview = opts.content.length > 60 ? opts.content.slice(0, 57) + "..." : opts.content;
  const displayName = `${categoryLabel}: ${contentPreview}`;

  // Create the document record — we use storageKey to hold the content text
  // since memory entries are short text, not files on disk.
  // sectionHeadings stores the encoded metadata for internal use.
  const doc: Document = {
    id: docId,
    name: displayName,
    type: "txt",
    classification: "policy",
    uploadedAt: now,
    updatedAt: now,
    status: "ready",
    sectionHeadings: [encodeMemoryMeta(opts.category, confidence, source)],
    storageKey: opts.content, // Store content directly — no file
    dataSourceId: ds.id,
  };
  setDocument(doc);

  // Embed and register as a single chunk
  try {
    const embedding = await embed(opts.content);
    const startIndex = getChunkCountForDataset(ds.datasetName);
    registerChunks(
      ds.datasetName,
      startIndex,
      [{
        sourceDocument: docId,
        documentName: opts.content.slice(0, 100),
        sectionPath: [opts.category],
        pageNumber: 0,
        heading: opts.category,
        chunkIndex: 0,
      }],
      [opts.content],
      [opts.content],
      [embedding],
    );
  } catch (err) {
    logger.warn({ err }, "Failed to embed memory — stored without embedding");
  }

  refreshDocumentCount(ds.id);

  return {
    id: docId,
    content: opts.content,
    category: opts.category,
    confidence,
    source,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * List all memory entries for a user.
 */
export function listMemories(orgId?: string, userId?: string): MemoryEntry[] {
  const ds = getOrCreateMemoryDataSource(orgId, userId);
  const docs = getDocumentsByDataSource(ds.id);
  return docs
    .map(docToMemoryEntry)
    .filter((entry): entry is MemoryEntry => entry !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Get a single memory entry by ID.
 */
export function getMemory(id: string): MemoryEntry | null {
  const doc = getDocument(id);
  if (!doc) return null;
  return docToMemoryEntry(doc);
}

/**
 * Update a memory entry's content and/or metadata.
 */
export async function updateMemory(
  id: string,
  updates: { content?: string | undefined; category?: MemoryCategory | undefined; confidence?: number | undefined },
  orgId?: string | undefined,
  userId?: string | undefined,
): Promise<MemoryEntry | null> {
  const doc = getDocument(id);
  if (!doc) return null;

  const existing = docToMemoryEntry(doc);
  if (!existing) return null;

  const newContent = updates.content ?? existing.content;
  const newCategory = updates.category ?? existing.category;
  const newConfidence = updates.confidence ?? existing.confidence;
  const now = new Date();

  // Update the document
  const updated: Document = {
    ...doc,
    name: encodeMemoryMeta(newCategory, newConfidence, existing.source),
    storageKey: newContent,
    updatedAt: now,
  };
  setDocument(updated);

  // Re-embed if content changed
  if (updates.content && updates.content !== existing.content) {
    const ds = getOrCreateMemoryDataSource(orgId, userId);
    try {
      clearChunksForDocument(id);
      const embedding = await embed(newContent);
      const startIndex = getChunkCountForDataset(ds.datasetName);
      registerChunks(
        ds.datasetName,
        startIndex,
        [{
          sourceDocument: id,
          documentName: newContent.slice(0, 100),
          sectionPath: [newCategory],
          pageNumber: 0,
          heading: newCategory,
          chunkIndex: 0,
        }],
        [newContent],
        [newContent],
        [embedding],
      );
    } catch (err) {
      logger.warn({ err }, "Failed to re-embed updated memory");
    }
  }

  return {
    id,
    content: newContent,
    category: newCategory,
    confidence: newConfidence,
    source: existing.source,
    createdAt: existing.createdAt,
    updatedAt: now,
  };
}

/**
 * Delete a memory entry.
 */
export function deleteMemory(id: string, _orgId?: string, _userId?: string): boolean {
  const doc = getDocument(id);
  if (!doc) return false;

  clearChunksForDocument(id);
  deleteDocument(id);

  // Update document count on the data source
  if (doc.dataSourceId) {
    refreshDocumentCount(doc.dataSourceId);
  }

  return true;
}

/**
 * Get the dataset name for a user's memory data source.
 * Used by the memory context injection to search memory chunks.
 */
export function getMemoryDatasetName(orgId?: string, userId?: string): string | null {
  const ownerId = userId ?? "solo@localhost";
  const datasetName = userId
    ? `${MEMORY_DATASET_PREFIX}-${userId.replace(/[^a-z0-9]/gi, "-").slice(0, 30)}`
    : MEMORY_DATASET_PREFIX;

  const existing = listDataSources({ ownerId }).find(
    (ds) => ds.datasetName === datasetName,
  );
  return existing ? existing.datasetName : null;
}
