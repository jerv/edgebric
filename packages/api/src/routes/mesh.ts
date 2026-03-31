import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { requireOrg, requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { recordAuditEvent } from "../services/auditLog.js";
import {
  getMeshConfig,
  initMeshConfig,
  updateMeshConfig,
  deleteMeshConfig,
  regenerateMeshToken,
  registerNode,
  getNode,
  listNodes,
  updateNode,
  removeNode,
  createNodeGroup,
  getNodeGroup,
  listNodeGroups,
  updateNodeGroup,
  deleteNodeGroup,
} from "../services/nodeRegistry.js";
import { getPrimaryReachable } from "../services/meshScheduler.js";

export const meshRouter: IRouter = Router();

// All mesh routes require org membership
meshRouter.use(requireOrg);

// ─── Mesh Config ─────────────────────────────────────────────────────────────

/** GET /api/mesh/config — current mesh config (admin only) */
meshRouter.get("/config", requireAdmin, (_req, res) => {
  const cfg = getMeshConfig();
  if (!cfg) {
    res.json({ enabled: false, configured: false });
    return;
  }
  // Don't expose the full mesh token — only last 8 chars for identification
  res.json({
    ...cfg,
    meshToken: cfg.meshToken.length > 8 ? `...${cfg.meshToken.slice(-8)}` : cfg.meshToken,
    configured: true,
  });
});

/** GET /api/mesh/config/token — get full mesh token (admin only, for sharing with secondary nodes) */
meshRouter.get("/config/token", requireAdmin, (_req, res) => {
  const cfg = getMeshConfig();
  if (!cfg) {
    res.status(404).json({ error: "Mesh not configured" });
    return;
  }
  res.json({ meshToken: cfg.meshToken });
});

const initMeshSchema = z.object({
  role: z.enum(["primary", "secondary"]),
  nodeName: z.string().min(1).max(200),
  primaryEndpoint: z.string().url().optional(),
  groupId: z.string().uuid().optional(),
});

/** POST /api/mesh/config — initialize mesh (admin only) */
meshRouter.post("/config", requireAdmin, validateBody(initMeshSchema), (req, res) => {
  const email = req.session.email ?? "";
  const orgId = req.session.orgId ?? "";
  const data = req.body as z.infer<typeof initMeshSchema>;

  if (data.role === "secondary" && !data.primaryEndpoint) {
    res.status(400).json({ error: "Secondary nodes must provide the primary node endpoint" });
    return;
  }

  const cfg = initMeshConfig({
    role: data.role,
    nodeName: data.nodeName.trim(),
    orgId,
    ...(data.primaryEndpoint != null && { primaryEndpoint: data.primaryEndpoint }),
    ...(data.groupId != null && { groupId: data.groupId }),
  });

  recordAuditEvent({
    eventType: "mesh.init",
    actorEmail: email,
    actorIp: req.ip,
    resourceType: "mesh",
    resourceId: cfg.nodeId,
    details: { role: data.role, nodeName: data.nodeName },
  });

  res.status(201).json({
    ...cfg,
    meshToken: cfg.meshToken, // Full token on creation — admin needs to copy it
  });
});

const updateMeshSchema = z.object({
  enabled: z.boolean().optional(),
  nodeName: z.string().min(1).max(200).optional(),
  groupId: z.string().uuid().nullable().optional(),
});

/** PATCH /api/mesh/config — update mesh settings (admin only) */
meshRouter.patch("/config", requireAdmin, validateBody(updateMeshSchema), (req, res) => {
  const email = req.session.email ?? "";
  const data = req.body as z.infer<typeof updateMeshSchema>;

  const updated = updateMeshConfig({
    ...(data.enabled !== undefined && { enabled: data.enabled }),
    ...(data.nodeName !== undefined && { nodeName: data.nodeName.trim() }),
    ...(data.groupId !== undefined && { groupId: data.groupId }),
  });

  if (!updated) {
    res.status(404).json({ error: "Mesh not configured" });
    return;
  }

  recordAuditEvent({
    eventType: "mesh.update",
    actorEmail: email,
    actorIp: req.ip,
    resourceType: "mesh",
    resourceId: updated.nodeId,
    details: data,
  });

  res.json({
    ...updated,
    meshToken: updated.meshToken.length > 8 ? `...${updated.meshToken.slice(-8)}` : updated.meshToken,
  });
});

/** DELETE /api/mesh/config — leave mesh entirely (admin only) */
meshRouter.delete("/config", requireAdmin, (req, res) => {
  const email = req.session.email ?? "";
  const cfg = getMeshConfig();

  if (cfg) {
    recordAuditEvent({
      eventType: "mesh.leave",
      actorEmail: email,
      actorIp: req.ip,
      resourceType: "mesh",
      resourceId: cfg.nodeId,
      details: { nodeName: cfg.nodeName },
    });
  }

  deleteMeshConfig();
  res.json({ ok: true });
});

/** POST /api/mesh/config/regenerate-token — regenerate mesh token (admin only) */
meshRouter.post("/config/regenerate-token", requireAdmin, (req, res) => {
  const email = req.session.email ?? "";
  const cfg = getMeshConfig();
  if (!cfg) {
    res.status(404).json({ error: "Mesh not configured" });
    return;
  }

  const newToken = regenerateMeshToken();

  recordAuditEvent({
    eventType: "mesh.token_regenerated",
    actorEmail: email,
    actorIp: req.ip,
    resourceType: "mesh",
    resourceId: cfg.nodeId,
    details: {},
  });

  res.json({ meshToken: newToken });
});

// ─── Mesh Status (available to all authenticated users) ──────────────────────

/** GET /api/mesh/status — mesh status summary */
meshRouter.get("/status", (_req, res) => {
  const cfg = getMeshConfig();
  if (!cfg || !cfg.enabled) {
    res.json({
      enabled: false,
      role: null,
      nodeId: null,
      nodeName: null,
      connectedNodes: 0,
      totalNodes: 0,
      primaryEndpoint: null,
      primaryReachable: null,
    });
    return;
  }

  const nodes = listNodes({ orgId: cfg.orgId });
  const onlineCount = nodes.filter((n) => n.status === "online").length;

  res.json({
    enabled: true,
    role: cfg.role,
    nodeId: cfg.nodeId,
    nodeName: cfg.nodeName,
    connectedNodes: onlineCount,
    totalNodes: nodes.length,
    primaryEndpoint: cfg.primaryEndpoint,
    primaryReachable: getPrimaryReachable(),
  });
});

/** GET /api/mesh/query-targets — node groups for query targeting (available to all users) */
meshRouter.get("/query-targets", (req, res) => {
  const cfg = getMeshConfig();
  if (!cfg || !cfg.enabled) {
    res.json({ groups: [] });
    return;
  }
  const orgId = req.session.orgId ?? cfg.orgId;
  const groups = listNodeGroups(orgId);
  res.json({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      nodeCount: g.nodeCount,
    })),
  });
});

// ─── Nodes (admin only) ──────────────────────────────────────────────────────

meshRouter.use("/nodes", requireAdmin);

/** GET /api/mesh/nodes — list all registered nodes */
meshRouter.get("/nodes", (req, res) => {
  const orgId = req.session.orgId ?? "";
  const nodes = listNodes({ orgId });
  res.json(nodes);
});

/** GET /api/mesh/nodes/:id — get a specific node */
meshRouter.get("/nodes/:id", (req, res) => {
  const node = getNode(req.params["id"] as string);
  if (!node) {
    res.status(404).json({ error: "Node not found" });
    return;
  }
  res.json(node);
});

const registerNodeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  role: z.enum(["primary", "secondary"]),
  endpoint: z.string().url(),
  version: z.string().optional(),
  groupId: z.string().uuid().optional(),
});

/** POST /api/mesh/nodes — register a node */
meshRouter.post("/nodes", validateBody(registerNodeSchema), (req, res) => {
  const email = req.session.email ?? "";
  const orgId = req.session.orgId ?? "";
  const data = req.body as z.infer<typeof registerNodeSchema>;

  const node = registerNode({
    id: data.id,
    name: data.name.trim(),
    role: data.role,
    endpoint: data.endpoint,
    orgId,
    ...(data.version != null && { version: data.version }),
    ...(data.groupId != null && { groupId: data.groupId }),
  });

  recordAuditEvent({
    eventType: "mesh.node_registered",
    actorEmail: email,
    actorIp: req.ip,
    resourceType: "mesh_node",
    resourceId: node.id,
    details: { name: node.name, role: node.role, endpoint: node.endpoint },
  });

  res.status(201).json(node);
});

const updateNodeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  groupId: z.string().uuid().nullable().optional(),
  endpoint: z.string().url().optional(),
});

/** PATCH /api/mesh/nodes/:id — update a node */
meshRouter.patch("/nodes/:id", validateBody(updateNodeSchema), (req, res) => {
  const email = req.session.email ?? "";
  const nodeId = req.params["id"] as string;
  const data = req.body as z.infer<typeof updateNodeSchema>;

  const updated = updateNode(nodeId, {
    ...(data.name !== undefined && { name: data.name.trim() }),
    ...(data.groupId !== undefined && { groupId: data.groupId }),
    ...(data.endpoint !== undefined && { endpoint: data.endpoint }),
  });

  if (!updated) {
    res.status(404).json({ error: "Node not found" });
    return;
  }

  recordAuditEvent({
    eventType: "mesh.node_updated",
    actorEmail: email,
    actorIp: req.ip,
    resourceType: "mesh_node",
    resourceId: nodeId,
    details: data,
  });

  res.json(updated);
});

/** DELETE /api/mesh/nodes/:id — remove a node from the mesh */
meshRouter.delete("/nodes/:id", (req, res) => {
  const email = req.session.email ?? "";
  const nodeId = req.params["id"] as string;
  const node = getNode(nodeId);

  if (!node) {
    res.status(404).json({ error: "Node not found" });
    return;
  }

  recordAuditEvent({
    eventType: "mesh.node_removed",
    actorEmail: email,
    actorIp: req.ip,
    resourceType: "mesh_node",
    resourceId: nodeId,
    details: { name: node.name },
  });

  removeNode(nodeId);
  res.json({ ok: true });
});

// ─── Node Groups (admin only) ────────────────────────────────────────────────

meshRouter.use("/groups", requireAdmin);

/** GET /api/mesh/groups — list all node groups */
meshRouter.get("/groups", (req, res) => {
  const orgId = req.session.orgId ?? "";
  const groups = listNodeGroups(orgId);
  res.json(groups);
});

/** GET /api/mesh/groups/:id — get a specific group */
meshRouter.get("/groups/:id", (req, res) => {
  const group = getNodeGroup(req.params["id"] as string);
  if (!group) {
    res.status(404).json({ error: "Node group not found" });
    return;
  }
  res.json(group);
});

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

/** POST /api/mesh/groups — create a node group */
meshRouter.post("/groups", validateBody(createGroupSchema), (req, res) => {
  const email = req.session.email ?? "";
  const orgId = req.session.orgId ?? "";
  const data = req.body as z.infer<typeof createGroupSchema>;

  const group = createNodeGroup({
    name: data.name,
    orgId,
    ...(data.description != null && { description: data.description }),
    ...(data.color != null && { color: data.color }),
  });

  recordAuditEvent({
    eventType: "mesh.group_created",
    actorEmail: email,
    actorIp: req.ip,
    resourceType: "node_group",
    resourceId: group.id,
    details: { name: group.name },
  });

  res.status(201).json(group);
});

const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

/** PATCH /api/mesh/groups/:id — update a node group */
meshRouter.patch("/groups/:id", validateBody(updateGroupSchema), (req, res) => {
  const email = req.session.email ?? "";
  const groupId = req.params["id"] as string;
  const data = req.body as z.infer<typeof updateGroupSchema>;

  const updated = updateNodeGroup(groupId, {
    ...(data.name != null && { name: data.name }),
    ...(data.description != null && { description: data.description }),
    ...(data.color != null && { color: data.color }),
  });
  if (!updated) {
    res.status(404).json({ error: "Node group not found" });
    return;
  }

  recordAuditEvent({
    eventType: "mesh.group_updated",
    actorEmail: email,
    actorIp: req.ip,
    resourceType: "node_group",
    resourceId: groupId,
    details: data,
  });

  res.json(updated);
});

/** DELETE /api/mesh/groups/:id — delete a node group (nodes move to Ungrouped) */
meshRouter.delete("/groups/:id", (req, res) => {
  const email = req.session.email ?? "";
  const groupId = req.params["id"] as string;
  const group = getNodeGroup(groupId);

  if (!group) {
    res.status(404).json({ error: "Node group not found" });
    return;
  }

  recordAuditEvent({
    eventType: "mesh.group_deleted",
    actorEmail: email,
    actorIp: req.ip,
    resourceType: "node_group",
    resourceId: groupId,
    details: { name: group.name, nodeCount: group.nodeCount },
  });

  deleteNodeGroup(groupId);
  res.json({ ok: true });
});
