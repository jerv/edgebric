import { embed } from "../services/ollamaClient.js";
import {
  getChunksForDataset,
  clearChunksForDataset,
  registerChunks,
} from "../services/chunkRegistry.js";
import { logger } from "../lib/logger.js";

// Debounce + lock per dataset to coalesce rapid deletions and prevent races
const pendingRebuilds = new Map<string, ReturnType<typeof setTimeout>>();
const activeRebuilds = new Set<string>();

/** Returns all dataset names that are currently rebuilding or pending rebuild. */
export function getRebuildsInProgress(): Set<string> {
  const all = new Set<string>();
  for (const name of pendingRebuilds.keys()) all.add(name);
  for (const name of activeRebuilds) all.add(name);
  return all;
}

/**
 * Schedule a dataset rebuild. Debounced by 2s per dataset so that rapid
 * successive document deletions are coalesced into a single rebuild.
 *
 * Rebuild pipeline:
 * 1. Read remaining chunks from SQLite (deleted doc chunks already removed by caller)
 * 2. Clear all chunk registry entries (metadata + FTS5 + vectors)
 * 3. Re-embed each chunk via Ollama
 * 4. Re-register with fresh sequential IDs and new embeddings
 *
 * Called after document deletion to ensure zero stale data.
 * Runs async — callers should fire-and-forget.
 */
export function rebuildDataset(datasetName: string): void {
  // Cancel any pending debounced rebuild for this dataset
  const existing = pendingRebuilds.get(datasetName);
  if (existing) clearTimeout(existing);

  // Schedule rebuild after a short delay to coalesce rapid deletes
  const timer = setTimeout(() => {
    pendingRebuilds.delete(datasetName);
    void executeRebuild(datasetName);
  }, 2000);
  pendingRebuilds.set(datasetName, timer);
}

async function executeRebuild(datasetName: string): Promise<void> {
  // If a rebuild is already running for this dataset, re-schedule
  if (activeRebuilds.has(datasetName)) {
    rebuildDataset(datasetName);
    return;
  }

  activeRebuilds.add(datasetName);
  const log = logger.child({ job: "rebuildDataset", datasetName });

  try {
    // 1. Get remaining chunks from registry (deleted doc chunks already removed by caller)
    const remaining = getChunksForDataset(datasetName);
    log.info({ remainingChunks: remaining.length }, "Starting dataset rebuild");

    // 2. If no chunks remain, we're done — dataset is clean
    if (remaining.length === 0) {
      clearChunksForDataset(datasetName);
      log.info("No remaining chunks — dataset fully cleaned");
      return;
    }

    // 3. Re-embed all remaining chunks via Ollama
    const embeddings: number[][] = [];
    for (const chunk of remaining) {
      const embedding = await embed(chunk.content);
      embeddings.push(embedding);
    }
    log.info({ count: embeddings.length }, "Re-embedded chunks");

    // 4. Clear old registry entries and re-register with new sequential IDs + embeddings
    const oldMetadata = remaining.map((c) => c.metadata);
    const oldContent = remaining.map((c) => c.content);
    const oldParentContent = remaining.map((c) => c.metadata.parentContent ?? c.content);

    clearChunksForDataset(datasetName);
    registerChunks(datasetName, 0, oldMetadata, oldContent, oldParentContent, embeddings);

    log.info({ chunkCount: remaining.length }, "Dataset rebuild complete");
  } catch (err) {
    log.error({ err }, "Dataset rebuild failed");
  } finally {
    activeRebuilds.delete(datasetName);
  }
}
