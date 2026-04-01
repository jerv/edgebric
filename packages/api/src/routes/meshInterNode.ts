/**
 * Mesh inter-node endpoints — called by other mesh nodes (not by the admin UI).
 * All endpoints are protected by requireMeshToken middleware.
 *
 * These endpoints form the mesh protocol:
 * - POST /api/mesh/peer/search — search this node's sources
 * - POST /api/mesh/peer/heartbeat — register/update heartbeat
 * - GET  /api/mesh/peer/info — get this node's info
 */
import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { requireMeshToken, type MeshRequest } from "../middleware/meshAuth.js";
import { validateBody } from "../middleware/validate.js";
import {
  getMeshConfig,
  heartbeat,
  listNodeGroups,
} from "../services/nodeRegistry.js";
import { revokeSessionsByEmail } from "../services/sessionRevocation.js";
import { listDataSources } from "../services/dataSourceStore.js";
import { hybridMultiDatasetSearch } from "../services/searchService.js";
import { config } from "../config.js";
import { OIDC_PROVIDERS } from "../lib/oidcProviders.js";
import { logger } from "../lib/logger.js";

export const meshInterNodeRouter: IRouter = Router();

// All inter-node endpoints require valid mesh token
meshInterNodeRouter.use(requireMeshToken);

// ─── Search ──────────────────────────────────────────────────────────────────

const searchSchema = z.object({
  query: z.string().min(1).max(10000),
  datasetNames: z.array(z.string()).optional(),
  topN: z.number().int().min(1).max(50).optional().default(10),
});

/**
 * POST /api/mesh/peer/search
 *
 * Search this node's sources. Access control is handled by the query route
 * on the requesting node (group-based). All sources on this node are
 * searchable via mesh — if the requesting node can reach us, it's authorized.
 *
 * If datasetNames is omitted, searches ALL sources on this node.
 */
meshInterNodeRouter.post("/search", validateBody(searchSchema), async (req, res) => {
  const meshReq = req as MeshRequest;
  const { query, datasetNames, topN } = req.body as z.infer<typeof searchSchema>;
  const cfg = getMeshConfig();

  if (!cfg) {
    res.status(503).json({ error: "Mesh not configured" });
    return;
  }

  try {
    // All sources on this node are mesh-searchable (access controlled by groups on the requesting side)
    const localSources = listDataSources({ orgId: cfg.orgId });

    // If specific datasets requested, filter to those
    let targetDatasets: string[];
    if (datasetNames && datasetNames.length > 0) {
      const allowedNames = new Set(localSources.map((ds) => ds.datasetName));
      targetDatasets = datasetNames.filter((name) => allowedNames.has(name));
    } else {
      targetDatasets = localSources.map((ds) => ds.datasetName);
    }

    if (targetDatasets.length === 0) {
      res.json({
        chunks: [],
        nodeId: cfg.nodeId,
        nodeName: cfg.nodeName,
      });
      return;
    }

    // Build a map from datasetName → source name for the response
    const datasetToSourceName = new Map<string, string>();
    for (const ds of localSources) {
      datasetToSourceName.set(ds.datasetName, ds.name);
    }

    // Run the hybrid search
    const { results } = await hybridMultiDatasetSearch(targetDatasets, query, topN);

    // Map to mesh response format — never include raw content beyond the chunk text
    // Derive dataset name from chunkId (format: "{datasetName}-{index}")
    const chunks = results.map((r) => {
      const dsName = r.chunkId.replace(/-\d+$/, "");
      return {
        chunkId: r.chunkId,
        content: r.chunk,
        similarity: r.similarity,
        documentName: r.metadata?.documentName,
        sectionPath: r.metadata?.sectionPath,
        pageNumber: r.metadata?.pageNumber,
        heading: r.metadata?.heading,
        sourceName: datasetToSourceName.get(dsName) ?? "Unknown",
      };
    });

    logger.info(
      { fromNode: meshReq.meshNode.name, queryLen: query.length, results: chunks.length },
      "Mesh search completed",
    );

    res.json({
      chunks,
      nodeId: cfg.nodeId,
      nodeName: cfg.nodeName,
    });
  } catch (err) {
    logger.error({ err }, "Mesh search failed");
    res.status(500).json({ error: "Search failed" });
  }
});

// ─── Heartbeat ───────────────────────────────────────────────────────────────

const heartbeatSchema = z.object({
  sourceCount: z.number().int().min(0).optional(),
  version: z.string().optional(),
});

/**
 * POST /api/mesh/peer/heartbeat
 *
 * Called periodically by other nodes to update their status.
 * Updates lastSeen timestamp and optional source count.
 */
meshInterNodeRouter.post("/heartbeat", validateBody(heartbeatSchema), (req, res) => {
  const meshReq = req as MeshRequest;
  const { sourceCount } = req.body as z.infer<typeof heartbeatSchema>;

  heartbeat(meshReq.meshNode.id, sourceCount);

  res.json({ ok: true });
});

// ─── Node Info ───────────────────────────────────────────────────────────────

/**
 * GET /api/mesh/peer/info
 *
 * Returns this node's identity, role, and available source count.
 * Used during initial mesh handshake and for status checks.
 */
meshInterNodeRouter.get("/info", (_req, res) => {
  const cfg = getMeshConfig();
  if (!cfg) {
    res.status(503).json({ error: "Mesh not configured" });
    return;
  }

  const localSources = listDataSources({ orgId: cfg.orgId });

  // Look up group name
  let groupName: string | null = null;
  if (cfg.groupId) {
    const groups = listNodeGroups(cfg.orgId);
    const group = groups.find((g) => g.id === cfg.groupId);
    if (group) groupName = group.name;
  }

  res.json({
    nodeId: cfg.nodeId,
    nodeName: cfg.nodeName,
    role: cfg.role,
    version: process.env["npm_package_version"] ?? "0.0.0",
    sourceCount: localSources.length,
    meshVisibleSourceCount: localSources.length,
    groupId: cfg.groupId,
    groupName,
  });
});

// ─── Auth Info ────────────────────────────────────────────────────────────────

/**
 * GET /api/mesh/peer/auth-info
 *
 * Returns the auth provider info for this node. Secondary nodes call this
 * to display the correct provider (Google, Microsoft, etc.) on their login page
 * even though they don't configure OIDC themselves.
 */
// ─── User Revocation ────────────────────────────────────────────────────────

const revokeSchema = z.object({
  email: z.string().email(),
});

/**
 * POST /api/mesh/peer/revoke-user
 *
 * Called by the primary node when a user is deactivated/removed.
 * Destroys all local sessions for the given email so the user
 * is immediately locked out, even if this node can't reach the primary.
 */
meshInterNodeRouter.post("/revoke-user", validateBody(revokeSchema), (req, res) => {
  const { email } = req.body as z.infer<typeof revokeSchema>;
  const destroyed = revokeSessionsByEmail(email);

  logger.info(
    { email, destroyed, fromNode: (req as MeshRequest).meshNode.name },
    "Mesh revocation: destroyed user sessions",
  );

  res.json({ ok: true, destroyed });
});

// ─── Auth Info ────────────────────────────────────────────────────────────

meshInterNodeRouter.get("/auth-info", (_req, res) => {
  if (config.authMode === "none") {
    res.json({ provider: "none", providerName: "Solo Mode" });
    return;
  }
  const providerDef = OIDC_PROVIDERS[config.oidc.provider] ?? OIDC_PROVIDERS.generic;
  res.json({ provider: providerDef.id, providerName: providerDef.name });
});
