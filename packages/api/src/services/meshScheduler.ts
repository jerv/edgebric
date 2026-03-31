/**
 * Background scheduler for mesh networking.
 *
 * - Heartbeat (every 30s): sends heartbeat to all online peer nodes so they
 *   know this node is alive. Also checks primary reachability for secondary nodes.
 * - Stale detection (every 60s): marks nodes as offline if they haven't sent
 *   a heartbeat within 90s (3 missed heartbeat windows).
 *
 * Start/stop is managed by server.ts (on boot/shutdown) and mesh.ts routes
 * (when mesh is toggled on/off at runtime).
 */
import { isMeshEnabled, getMeshConfig, listNodes, markStaleNodesOffline } from "./nodeRegistry.js";
import { sendHeartbeat } from "./meshClient.js";
import { listDataSources } from "./dataSourceStore.js";
import { logger } from "../lib/logger.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
const STALE_CHECK_INTERVAL_MS = 60_000;
const STALE_TIMEOUT_MS = 90_000; // 3 missed heartbeats
const PRIMARY_CHECK_TIMEOUT_MS = 5_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let staleCheckTimer: ReturnType<typeof setInterval> | null = null;
let primaryReachable: boolean | null = null;

// ─── Heartbeat Tick ──────────────────────────────────────────────────────────

async function sendHeartbeatsToAll(): Promise<void> {
  if (!isMeshEnabled()) return;

  const cfg = getMeshConfig();
  if (!cfg) return;

  const localSourceCount = listDataSources({ orgId: cfg.orgId }).length;

  // Get all registered nodes (excluding self)
  const nodes = listNodes({ orgId: cfg.orgId })
    .filter((n) => n.id !== cfg.nodeId);

  // Send heartbeat to each peer (fire-and-forget)
  for (const node of nodes) {
    sendHeartbeat(node.id, localSourceCount).catch((err) => {
      logger.debug(
        { nodeId: node.id, nodeName: node.name, err: err instanceof Error ? err.message : String(err) },
        "Mesh heartbeat send failed",
      );
    });
  }

  // Check primary reachability (secondary nodes only)
  if (cfg.role === "secondary" && cfg.primaryEndpoint) {
    primaryReachable = await checkPrimaryReachable(cfg.primaryEndpoint, cfg.meshToken, cfg.nodeId);
  }
}

// ─── Primary Reachability Check ──────────────────────────────────────────────

async function checkPrimaryReachable(
  endpoint: string,
  meshToken: string,
  nodeId: string,
): Promise<boolean> {
  try {
    const url = `${endpoint.replace(/\/$/, "")}/api/mesh/peer/info`;
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `MeshToken ${meshToken}`,
        "X-Mesh-Node-Id": nodeId,
      },
      signal: AbortSignal.timeout(PRIMARY_CHECK_TIMEOUT_MS),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── Stale Detection Tick ────────────────────────────────────────────────────

function checkStaleNodes(): void {
  if (!isMeshEnabled()) return;

  const marked = markStaleNodesOffline(STALE_TIMEOUT_MS);
  if (marked > 0) {
    logger.info({ count: marked }, "Marked stale mesh nodes as offline");
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Start the mesh scheduler. No-op if already running. */
export function startMeshScheduler(): void {
  if (heartbeatTimer) return;

  logger.info("Mesh scheduler started (heartbeat: 30s, stale check: 60s)");

  heartbeatTimer = setInterval(() => {
    sendHeartbeatsToAll().catch((err) => {
      logger.error({ err }, "Mesh heartbeat tick failed");
    });
  }, HEARTBEAT_INTERVAL_MS);

  staleCheckTimer = setInterval(() => {
    checkStaleNodes();
  }, STALE_CHECK_INTERVAL_MS);

  // Don't prevent process exit
  if (heartbeatTimer.unref) heartbeatTimer.unref();
  if (staleCheckTimer.unref) staleCheckTimer.unref();
}

/** Stop the mesh scheduler (for shutdown or mesh disable). */
export function stopMeshScheduler(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (staleCheckTimer) {
    clearInterval(staleCheckTimer);
    staleCheckTimer = null;
  }
  primaryReachable = null;
  logger.info("Mesh scheduler stopped");
}

/** Cached primary reachability (updated every 30s). Null if not a secondary or scheduler not running. */
export function getPrimaryReachable(): boolean | null {
  return primaryReachable;
}
