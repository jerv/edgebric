import { createMILMClient, createMKBClient } from "@edgebric/edge";
import { runtimeEdgeConfig } from "../config.js";
import {
  getChunksForDataset,
  clearChunksForDataset,
  registerChunks,
} from "../services/chunkRegistry.js";
import { logger } from "../lib/logger.js";

const milm = createMILMClient(runtimeEdgeConfig);
const mkb = createMKBClient(runtimeEdgeConfig);

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
 * This is the nuclear option for guaranteeing deleted data is gone:
 * 1. Delete the entire mKB dataset (all vectors removed)
 * 2. Read remaining chunks from our SQLite registry (content is stored locally)
 * 3. Re-embed each chunk via mILM
 * 4. Re-upload to a fresh mKB dataset
 * 5. Update chunk IDs in the registry to match new mKB-assigned IDs
 *
 * Called after document deletion to ensure zero stale data leaks through
 * mKB search results. Runs async — callers should fire-and-forget.
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

    // 2. Delete the mKB dataset entirely
    try {
      await mkb.deleteDataset(datasetName);
      log.info("Deleted mKB dataset");
    } catch (err) {
      // Dataset might not exist (e.g. never had chunks uploaded)
      log.warn({ err }, "Failed to delete mKB dataset (may not exist)");
    }

    // 3. If no chunks remain, we're done — dataset is clean
    if (remaining.length === 0) {
      clearChunksForDataset(datasetName);
      log.info("No remaining chunks — dataset fully cleaned");
      return;
    }

    // 4. Re-create the dataset
    await mkb.createDataset(datasetName);
    log.info("Re-created mKB dataset");

    // 5. Re-embed all remaining chunks
    const embeddedChunks: Array<{ text: string; embedding: number[] }> = [];
    for (const chunk of remaining) {
      const embedding = await milm.embed(chunk.content);
      embeddedChunks.push({ text: chunk.content, embedding });
    }
    log.info({ count: embeddedChunks.length }, "Re-embedded chunks");

    // 6. Upload to mKB
    await mkb.uploadChunks(datasetName, embeddedChunks);
    log.info("Uploaded chunks to mKB");

    // 7. Clear old registry entries and re-register with new sequential IDs
    //    mKB assigns IDs as {datasetName}-{0..N-1}
    const oldMetadata = remaining.map((c) => c.metadata);
    const oldContent = remaining.map((c) => c.content);
    const oldParentContent = remaining.map((c) => c.metadata.parentContent ?? c.content);

    clearChunksForDataset(datasetName);
    registerChunks(datasetName, 0, oldMetadata, oldContent, oldParentContent);

    log.info({ chunkCount: remaining.length }, "Dataset rebuild complete");
  } catch (err) {
    log.error({ err }, "Dataset rebuild failed");
  } finally {
    activeRebuilds.delete(datasetName);
  }
}
