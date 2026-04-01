/**
 * Background sync scheduler for cloud folder syncs.
 *
 * Checks all active folder syncs every 60 seconds and triggers a sync
 * for any that are past their configured sync interval.
 *
 * Uses an in-memory Set to prevent overlapping syncs of the same folder sync.
 */
import { listAllActiveFolderSyncs, updateFolderSync } from "../services/cloudConnectionStore.js";
import { syncFolderSync } from "./syncConnection.js";
import { logger } from "../lib/logger.js";

const SCHEDULER_INTERVAL_MS = 60_000;
const syncingFolderSyncs = new Set<string>();

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

async function checkAndSyncAll(): Promise<void> {
  const activeSyncs = listAllActiveFolderSyncs();
  const now = Date.now();

  for (const fs of activeSyncs) {
    if (syncingFolderSyncs.has(fs.id)) continue;

    const intervalMs = fs.syncIntervalMin * 60_000;
    const lastSync = fs.lastSyncAt ? new Date(fs.lastSyncAt).getTime() : 0;
    if (now - lastSync < intervalMs) continue;

    syncingFolderSyncs.add(fs.id);
    syncFolderSync(fs.id)
      .catch((err) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error({ folderSyncId: fs.id, err: errMsg }, "Scheduled sync failed");
        updateFolderSync(fs.id, {
          status: "error",
          lastError: errMsg,
          lastSyncAt: new Date().toISOString(),
        });
      })
      .finally(() => {
        syncingFolderSyncs.delete(fs.id);
      });
  }
}

/** Start the background sync scheduler. Call once at server startup. */
export function startSyncScheduler(): void {
  if (schedulerTimer) return;

  logger.info("Cloud sync scheduler started (60s check interval)");
  schedulerTimer = setInterval(() => {
    checkAndSyncAll().catch((err) => {
      logger.error({ err }, "Sync scheduler check failed");
    });
  }, SCHEDULER_INTERVAL_MS);

  if (schedulerTimer.unref) schedulerTimer.unref();
}

/** Stop the scheduler (for graceful shutdown). */
export function stopSyncScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    logger.info("Cloud sync scheduler stopped");
  }
}

/** Check if a specific folder sync is currently syncing. */
export function isFolderSyncSyncing(folderSyncId: string): boolean {
  return syncingFolderSyncs.has(folderSyncId);
}
