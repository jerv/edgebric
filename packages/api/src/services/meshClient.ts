/**
 * HTTP client for calling other mesh nodes' inter-node endpoints.
 * Used by the query router to fan out searches across the mesh.
 */
import type { MeshSearchResponse, MeshNodeInfo } from "@edgebric/types";
import { getMeshConfig, getNode, listNodes } from "./nodeRegistry.js";
import { logger } from "../lib/logger.js";

const MESH_TIMEOUT_MS = 10_000; // 10 second timeout for mesh requests

interface MeshClientOptions {
  /** Override the mesh token (for testing). */
  meshToken?: string;
  /** Override timeout in ms. */
  timeoutMs?: number;
}

/**
 * Make an authenticated request to a mesh node's peer endpoint.
 */
async function meshFetch(
  nodeEndpoint: string,
  path: string,
  opts: {
    method: "GET" | "POST";
    body?: unknown;
    meshToken: string;
    nodeId: string;
    timeoutMs: number;
  },
): Promise<Response> {
  const url = `${nodeEndpoint.replace(/\/$/, "")}/api/mesh/peer${path}`;

  return fetch(url, {
    method: opts.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `MeshToken ${opts.meshToken}`,
      "X-Mesh-Node-Id": opts.nodeId,
    },
    ...(opts.body != null && { body: JSON.stringify(opts.body) }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
}

/**
 * Search a remote mesh node.
 * Returns null if the node is unreachable or returns an error.
 */
export async function searchRemoteNode(
  nodeId: string,
  query: string,
  datasetNames?: string[],
  topN?: number,
  options?: MeshClientOptions,
): Promise<MeshSearchResponse | null> {
  const cfg = getMeshConfig();
  if (!cfg) return null;

  const node = getNode(nodeId);
  if (!node) {
    logger.warn({ nodeId }, "Mesh search: node not found in registry");
    return null;
  }

  try {
    const resp = await meshFetch(node.endpoint, "/search", {
      method: "POST",
      body: {
        query,
        ...(datasetNames && { datasetNames }),
        ...(topN != null && { topN }),
      },
      meshToken: options?.meshToken ?? cfg.meshToken,
      nodeId: cfg.nodeId,
      timeoutMs: options?.timeoutMs ?? MESH_TIMEOUT_MS,
    });

    if (!resp.ok) {
      logger.warn(
        { nodeId, nodeName: node.name, status: resp.status },
        "Mesh search: remote node returned error",
      );
      return null;
    }

    const body: unknown = await resp.json();
    // Validate that the response has the expected shape
    const obj = body as Record<string, unknown> | null;
    if (!obj || !Array.isArray(obj.chunks) || typeof obj.nodeId !== "string") {
      logger.warn({ nodeId, nodeName: node.name }, "Mesh search: malformed response from remote node");
      return null;
    }
    return obj as unknown as MeshSearchResponse;
  } catch (err) {
    logger.warn(
      { nodeId, nodeName: node.name, err: err instanceof Error ? err.message : String(err) },
      "Mesh search: failed to reach remote node",
    );
    return null;
  }
}

/**
 * Get info from a remote mesh node.
 * Used for health checks and status display.
 */
export async function getRemoteNodeInfo(
  nodeId: string,
  options?: MeshClientOptions,
): Promise<MeshNodeInfo | null> {
  const cfg = getMeshConfig();
  if (!cfg) return null;

  const node = getNode(nodeId);
  if (!node) return null;

  try {
    const resp = await meshFetch(node.endpoint, "/info", {
      method: "GET",
      meshToken: options?.meshToken ?? cfg.meshToken,
      nodeId: cfg.nodeId,
      timeoutMs: options?.timeoutMs ?? MESH_TIMEOUT_MS,
    });

    if (!resp.ok) return null;
    const body: unknown = await resp.json();
    const obj = body as Record<string, unknown> | null;
    if (!obj || typeof obj.nodeId !== "string") return null;
    return obj as unknown as MeshNodeInfo;
  } catch {
    return null;
  }
}

/**
 * Send a heartbeat to a remote mesh node.
 * Used to update this node's status on remote nodes.
 */
export async function sendHeartbeat(
  nodeId: string,
  sourceCount: number,
  options?: MeshClientOptions,
): Promise<boolean> {
  const cfg = getMeshConfig();
  if (!cfg) return false;

  const node = getNode(nodeId);
  if (!node) return false;

  try {
    const resp = await meshFetch(node.endpoint, "/heartbeat", {
      method: "POST",
      body: { sourceCount },
      meshToken: options?.meshToken ?? cfg.meshToken,
      nodeId: cfg.nodeId,
      timeoutMs: options?.timeoutMs ?? 5_000, // shorter timeout for heartbeats
    });

    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Fan out a search to all online nodes in the mesh.
 * Returns results from each node that responds successfully.
 * Nodes that fail or time out are silently skipped.
 */
/**
 * Broadcast a user revocation to all mesh nodes.
 * Called when a user is removed/deactivated on any node.
 * Best-effort — failures are logged but don't block the removal.
 */
export async function broadcastRevocation(email: string): Promise<void> {
  const cfg = getMeshConfig();
  if (!cfg) return;

  const nodes = listNodes({ orgId: cfg.orgId })
    .filter((n) => n.id !== cfg.nodeId && n.status === "online");

  for (const node of nodes) {
    meshFetch(node.endpoint, "/revoke-user", {
      method: "POST",
      body: { email },
      meshToken: cfg.meshToken,
      nodeId: cfg.nodeId,
      timeoutMs: 5_000,
    }).catch((err) => {
      logger.warn(
        { nodeId: node.id, nodeName: node.name, err: err instanceof Error ? err.message : String(err) },
        "Failed to send revocation to mesh node",
      );
    });
  }
}

export async function searchAllNodes(
  query: string,
  opts?: {
    groupIds?: string[];
    datasetNames?: string[];
    topN?: number;
    excludeNodeId?: string;
  },
): Promise<{
  results: MeshSearchResponse[];
  nodesSearched: number;
  nodesUnavailable: number;
}> {
  const cfg = getMeshConfig();
  if (!cfg) return { results: [], nodesSearched: 0, nodesUnavailable: 0 };

  // Get all online nodes, filtered by allowed groups if specified
  let nodes = listNodes({ orgId: cfg.orgId });
  if (opts?.groupIds) {
    const allowedSet = new Set(opts.groupIds);
    nodes = nodes.filter((n) => n.groupId != null && allowedSet.has(n.groupId));
  }
  // Exclude self and optionally another node
  nodes = nodes.filter((n) => {
    if (n.id === cfg.nodeId) return false;
    if (opts?.excludeNodeId && n.id === opts.excludeNodeId) return false;
    return n.status === "online";
  });

  if (nodes.length === 0) {
    return { results: [], nodesSearched: 0, nodesUnavailable: 0 };
  }

  // Fan out searches in parallel
  const promises = nodes.map((node) =>
    searchRemoteNode(node.id, query, opts?.datasetNames, opts?.topN),
  );

  const settled = await Promise.allSettled(promises);

  const results: MeshSearchResponse[] = [];
  let unavailable = 0;

  for (const result of settled) {
    if (result.status === "fulfilled" && result.value !== null) {
      results.push(result.value);
    } else {
      unavailable++;
    }
  }

  return {
    results,
    nodesSearched: results.length,
    nodesUnavailable: unavailable,
  };
}
