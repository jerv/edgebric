import type { MeshNode, NodeGroup, MeshConfig, NodeRole } from "@edgebric/types";
import { getDb } from "../db/index.js";
import { meshConfig, meshNodes, nodeGroups, userMeshGroups } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID, randomBytes } from "crypto";

// ─── Mesh Config (single-row) ────────────────────────────────────────────────

export function getMeshConfig(): MeshConfig | undefined {
  const db = getDb();
  const row = db.select().from(meshConfig).where(eq(meshConfig.key, "main")).get();
  if (!row) return undefined;
  return {
    enabled: row.enabled === 1,
    role: row.role as NodeRole,
    primaryEndpoint: row.primaryEndpoint,
    meshToken: row.meshToken,
    nodeId: row.nodeId,
    nodeName: row.nodeName,
    groupId: row.groupId,
    orgId: row.orgId,
  };
}

export function isMeshEnabled(): boolean {
  const cfg = getMeshConfig();
  return cfg?.enabled === true;
}

export function initMeshConfig(opts: {
  role: NodeRole;
  nodeName: string;
  orgId: string;
  primaryEndpoint?: string;
  groupId?: string;
}): MeshConfig {
  const db = getDb();
  const nodeId = randomUUID();
  const meshToken = randomBytes(32).toString("hex");

  // Upsert — if config already exists, overwrite
  db.delete(meshConfig).where(eq(meshConfig.key, "main")).run();
  db.insert(meshConfig).values({
    key: "main",
    enabled: 1,
    role: opts.role,
    primaryEndpoint: opts.primaryEndpoint ?? null,
    meshToken,
    nodeId,
    nodeName: opts.nodeName,
    groupId: opts.groupId ?? null,
    orgId: opts.orgId,
  }).run();

  return getMeshConfig()!;
}

export function updateMeshConfig(data: {
  enabled?: boolean;
  role?: NodeRole;
  nodeName?: string;
  primaryEndpoint?: string | null;
  meshToken?: string;
  groupId?: string | null;
}): MeshConfig | undefined {
  const db = getDb();
  const existing = getMeshConfig();
  if (!existing) return undefined;

  db.update(meshConfig).set({
    ...(data.enabled !== undefined && { enabled: data.enabled ? 1 : 0 }),
    ...(data.role !== undefined && { role: data.role }),
    ...(data.nodeName !== undefined && { nodeName: data.nodeName }),
    ...(data.primaryEndpoint !== undefined && { primaryEndpoint: data.primaryEndpoint }),
    ...(data.meshToken !== undefined && { meshToken: data.meshToken }),
    ...(data.groupId !== undefined && { groupId: data.groupId }),
  }).where(eq(meshConfig.key, "main")).run();

  return getMeshConfig();
}

export function deleteMeshConfig(): void {
  const db = getDb();
  db.delete(meshConfig).where(eq(meshConfig.key, "main")).run();
}

export function regenerateMeshToken(): string {
  const db = getDb();
  const newToken = randomBytes(32).toString("hex");
  db.update(meshConfig).set({ meshToken: newToken }).where(eq(meshConfig.key, "main")).run();
  return newToken;
}

// ─── Mesh Nodes ──────────────────────────────────────────────────────────────

function rowToNode(row: typeof meshNodes.$inferSelect): MeshNode {
  // Look up group name
  let groupName: string | null = null;
  if (row.groupId) {
    const db = getDb();
    const group = db.select({ name: nodeGroups.name }).from(nodeGroups)
      .where(eq(nodeGroups.id, row.groupId)).get();
    if (group) groupName = group.name;
  }

  return {
    id: row.id,
    name: row.name,
    role: row.role as NodeRole,
    status: row.status as MeshNode["status"],
    endpoint: row.endpoint,
    groupId: row.groupId,
    groupName,
    sourceCount: row.sourceCount,
    lastSeen: row.lastSeen,
    version: row.version,
    orgId: row.orgId,
  };
}

export function registerNode(opts: {
  id: string;
  name: string;
  role: NodeRole;
  endpoint: string;
  orgId: string;
  version?: string;
  groupId?: string;
}): MeshNode {
  const db = getDb();
  const now = new Date().toISOString();

  // Upsert — if node already registered, update it
  const existing = db.select().from(meshNodes).where(eq(meshNodes.id, opts.id)).get();
  if (existing) {
    db.update(meshNodes).set({
      name: opts.name,
      role: opts.role,
      endpoint: opts.endpoint,
      status: "online",
      lastSeen: now,
      version: opts.version ?? existing.version,
      ...(opts.groupId !== undefined && { groupId: opts.groupId }),
    }).where(eq(meshNodes.id, opts.id)).run();
  } else {
    db.insert(meshNodes).values({
      id: opts.id,
      name: opts.name,
      role: opts.role,
      status: "online",
      endpoint: opts.endpoint,
      groupId: opts.groupId ?? null,
      sourceCount: 0,
      lastSeen: now,
      version: opts.version ?? "0.0.0",
      orgId: opts.orgId,
    }).run();
  }

  return getNode(opts.id)!;
}

export function getNode(id: string): MeshNode | undefined {
  const db = getDb();
  const row = db.select().from(meshNodes).where(eq(meshNodes.id, id)).get();
  return row ? rowToNode(row) : undefined;
}

export function listNodes(opts?: { orgId?: string; groupId?: string }): MeshNode[] {
  const db = getDb();
  const conditions = [];
  if (opts?.orgId) conditions.push(eq(meshNodes.orgId, opts.orgId));
  if (opts?.groupId) conditions.push(eq(meshNodes.groupId, opts.groupId));

  const query = conditions.length > 0
    ? db.select().from(meshNodes).where(and(...conditions))
    : db.select().from(meshNodes);

  const rows = query.all();
  if (rows.length === 0) return [];

  // Batch-load group names to avoid N+1 queries in rowToNode
  const groupIds = [...new Set(rows.map((r) => r.groupId).filter(Boolean))] as string[];
  const groupNameMap = new Map<string, string>();
  for (const gid of groupIds) {
    const group = db.select({ name: nodeGroups.name }).from(nodeGroups)
      .where(eq(nodeGroups.id, gid)).get();
    if (group) groupNameMap.set(gid, group.name);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role as NodeRole,
    status: row.status as MeshNode["status"],
    endpoint: row.endpoint,
    groupId: row.groupId,
    groupName: row.groupId ? (groupNameMap.get(row.groupId) ?? null) : null,
    sourceCount: row.sourceCount,
    lastSeen: row.lastSeen,
    version: row.version,
    orgId: row.orgId,
  }));
}

export function updateNode(id: string, data: {
  name?: string;
  status?: MeshNode["status"];
  endpoint?: string;
  groupId?: string | null;
  sourceCount?: number;
  lastSeen?: string;
  version?: string;
  role?: NodeRole;
}): MeshNode | undefined {
  const db = getDb();
  const existing = db.select().from(meshNodes).where(eq(meshNodes.id, id)).get();
  if (!existing) return undefined;

  db.update(meshNodes).set({
    ...(data.name !== undefined && { name: data.name }),
    ...(data.status !== undefined && { status: data.status }),
    ...(data.endpoint !== undefined && { endpoint: data.endpoint }),
    ...(data.groupId !== undefined && { groupId: data.groupId }),
    ...(data.sourceCount !== undefined && { sourceCount: data.sourceCount }),
    ...(data.lastSeen !== undefined && { lastSeen: data.lastSeen }),
    ...(data.version !== undefined && { version: data.version }),
    ...(data.role !== undefined && { role: data.role }),
  }).where(eq(meshNodes.id, id)).run();

  return getNode(id);
}

export function removeNode(id: string): void {
  const db = getDb();
  db.delete(meshNodes).where(eq(meshNodes.id, id)).run();
}

export function removeAllNodes(): void {
  const db = getDb();
  db.delete(meshNodes).run();
}

/** Mark nodes as offline if not seen within the timeout period (default 60s). */
export function markStaleNodesOffline(timeoutMs: number = 60_000): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - timeoutMs).toISOString();
  const result = db.update(meshNodes).set({ status: "offline" })
    .where(and(
      eq(meshNodes.status, "online"),
      sql`${meshNodes.lastSeen} < ${cutoff}`,
    )).run();
  return result.changes;
}

/** Record a heartbeat from a node (update lastSeen + status). */
export function heartbeat(nodeId: string, sourceCount?: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.update(meshNodes).set({
    status: "online",
    lastSeen: now,
    ...(sourceCount !== undefined && { sourceCount }),
  }).where(eq(meshNodes.id, nodeId)).run();
}

// ─── Node Groups ─────────────────────────────────────────────────────────────

function rowToGroup(row: typeof nodeGroups.$inferSelect): NodeGroup {
  const db = getDb();
  const countResult = db.select({ count: sql<number>`count(*)` })
    .from(meshNodes)
    .where(eq(meshNodes.groupId, row.id))
    .get();

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    nodeCount: countResult?.count ?? 0,
    color: row.color,
    orgId: row.orgId,
  };
}

export function createNodeGroup(opts: {
  name: string;
  description?: string;
  color?: string;
  orgId: string;
}): NodeGroup {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.insert(nodeGroups).values({
    id,
    name: opts.name.trim(),
    description: opts.description?.trim() ?? "",
    color: opts.color ?? "#3b82f6",
    orgId: opts.orgId,
    createdAt: now,
    updatedAt: now,
  }).run();

  return getNodeGroup(id)!;
}

export function getNodeGroup(id: string): NodeGroup | undefined {
  const db = getDb();
  const row = db.select().from(nodeGroups).where(eq(nodeGroups.id, id)).get();
  return row ? rowToGroup(row) : undefined;
}

export function listNodeGroups(orgId: string): NodeGroup[] {
  const db = getDb();
  return db.select().from(nodeGroups)
    .where(eq(nodeGroups.orgId, orgId))
    .all()
    .map(rowToGroup);
}

export function updateNodeGroup(id: string, data: {
  name?: string;
  description?: string;
  color?: string;
}): NodeGroup | undefined {
  const db = getDb();
  const existing = db.select().from(nodeGroups).where(eq(nodeGroups.id, id)).get();
  if (!existing) return undefined;

  const now = new Date().toISOString();
  db.update(nodeGroups).set({
    ...(data.name !== undefined && { name: data.name.trim() }),
    ...(data.description !== undefined && { description: data.description.trim() }),
    ...(data.color !== undefined && { color: data.color }),
    updatedAt: now,
  }).where(eq(nodeGroups.id, id)).run();

  return getNodeGroup(id);
}

export function deleteNodeGroup(id: string): void {
  const db = getDb();
  // Move nodes in this group to Ungrouped
  db.update(meshNodes).set({ groupId: null })
    .where(eq(meshNodes.groupId, id)).run();
  // Clean up user mesh group assignments for this group
  db.delete(userMeshGroups).where(eq(userMeshGroups.groupId, id)).run();
  db.delete(nodeGroups).where(eq(nodeGroups.id, id)).run();
}
