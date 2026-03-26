import type { Request, Response, NextFunction } from "express";
import { getMeshConfig, getNode } from "../services/nodeRegistry.js";

/**
 * Middleware for mesh-to-mesh endpoints (POST /api/mesh/search, heartbeat, etc.).
 * Validates the mesh token in the Authorization header and the requesting node ID.
 *
 * Expected header: Authorization: MeshToken <token>
 * Expected header: X-Mesh-Node-Id: <uuid>
 */
export function requireMeshToken(req: Request, res: Response, next: NextFunction): void {
  const cfg = getMeshConfig();
  if (!cfg || !cfg.enabled) {
    res.status(503).json({ error: "Mesh networking is not enabled on this node" });
    return;
  }

  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("MeshToken ")) {
    res.status(401).json({ error: "Missing or invalid mesh authorization" });
    return;
  }

  const token = authHeader.slice("MeshToken ".length);
  if (token !== cfg.meshToken) {
    res.status(403).json({ error: "Invalid mesh token" });
    return;
  }

  const nodeId = req.headers["x-mesh-node-id"] as string | undefined;
  if (!nodeId) {
    res.status(400).json({ error: "Missing X-Mesh-Node-Id header" });
    return;
  }

  // Verify the requesting node is registered
  const node = getNode(nodeId);
  if (!node) {
    res.status(403).json({ error: "Unknown node — not registered in this mesh" });
    return;
  }

  // Attach mesh context to request for downstream handlers
  (req as MeshRequest).meshNode = node;
  (req as MeshRequest).meshConfig = cfg;

  next();
}

/** Extended Request with mesh context attached by requireMeshToken middleware. */
export interface MeshRequest extends Request {
  meshNode: {
    id: string;
    name: string;
    orgId: string;
  };
  meshConfig: {
    nodeId: string;
    nodeName: string;
    orgId: string;
  };
}
