/**
 * Background sync scheduler for cloud connections.
 *
 * Checks all active connections every 60 seconds and triggers a sync
 * for any connection that is past its configured sync interval.
 *
 * Uses an in-memory Set to prevent overlapping syncs of the same connection.
 * Multiple different connections can sync in parallel.
 */
import { getDb } from "../db/index.js";
import { cloudConnections } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { syncConnection } from "./syncConnection.js";
import { updateConnection } from "../services/cloudConnectionStore.js";
import { logger } from "../lib/logger.js";

const SCHEDULER_INTERVAL_MS = 60_000; // Check every 60 seconds
const syncingConnections = new Set<string>();

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

async function checkAndSyncAll(): Promise<void> {
  const db = getDb();

  // Find all active connections that have a folder configured
  const activeConnections = db
    .select()
    .from(cloudConnections)
    .where(eq(cloudConnections.status, "active"))
    .all();

  const now = Date.now();

  for (const conn of activeConnections) {
    // Skip if no folder configured yet (setup incomplete)
    if (!conn.folderId) continue;

    // Skip if already syncing
    if (syncingConnections.has(conn.id)) continue;

    // Check if sync is due
    const intervalMs = conn.syncIntervalMin * 60_000;
    const lastSync = conn.lastSyncAt ? new Date(conn.lastSyncAt).getTime() : 0;
    if (now - lastSync < intervalMs) continue;

    // Trigger sync (non-blocking)
    syncingConnections.add(conn.id);
    syncConnection(conn.id)
      .catch((err) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error({ connectionId: conn.id, err: errMsg }, "Scheduled sync failed");
        updateConnection(conn.id, {
          status: "error",
          lastError: errMsg,
          lastSyncAt: new Date().toISOString(),
        });
      })
      .finally(() => {
        syncingConnections.delete(conn.id);
      });
  }
}

/** Start the background sync scheduler. Call once at server startup. */
export function startSyncScheduler(): void {
  if (schedulerTimer) return; // Already running

  logger.info("Cloud sync scheduler started (60s check interval)");
  schedulerTimer = setInterval(() => {
    checkAndSyncAll().catch((err) => {
      logger.error({ err }, "Sync scheduler check failed");
    });
  }, SCHEDULER_INTERVAL_MS);

  // Don't prevent process exit
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

/** Check if a specific connection is currently syncing. */
export function isConnectionSyncing(connectionId: string): boolean {
  return syncingConnections.has(connectionId);
}
