import type { KnowledgeBase, KnowledgeBaseType, KBAccessMode } from "@edgebric/types";
import { getDb } from "../db/index.js";
import { knowledgeBases, documents, kbAccess } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

function rowToKB(row: typeof knowledgeBases.$inferSelect): KnowledgeBase {
  const kb: KnowledgeBase = {
    id: row.id,
    name: row.name,
    type: row.type as KnowledgeBaseType,
    ownerId: row.ownerId,
    datasetName: row.datasetName,
    documentCount: row.documentCount,
    status: row.status as KnowledgeBase["status"],
    accessMode: (row.accessMode ?? "all") as KBAccessMode,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
  if (row.description != null) kb.description = row.description;
  return kb;
}

/** Create a new knowledge base. Returns the created KB. */
export function createKB(opts: {
  name: string;
  description?: string;
  type?: KnowledgeBaseType;
  ownerId: string;
  orgId?: string;
  datasetName?: string;
}): KnowledgeBase {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  // Generate a unique mKB dataset name from the KB name
  const datasetName = opts.datasetName ?? `kb-${id.slice(0, 8)}`;

  db.insert(knowledgeBases)
    .values({
      id,
      name: opts.name,
      description: opts.description ?? null,
      type: opts.type ?? "organization",
      ownerId: opts.ownerId,
      orgId: opts.orgId ?? null,
      datasetName,
      documentCount: 0,
      status: "active",
      accessMode: "all",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return getKB(id)!;
}

/** Get a single KB by ID. */
export function getKB(id: string): KnowledgeBase | undefined {
  const db = getDb();
  const row = db.select().from(knowledgeBases).where(eq(knowledgeBases.id, id)).get();
  return row ? rowToKB(row) : undefined;
}

/** Check if a KB belongs to a specific org. */
export function kbBelongsToOrg(kbId: string, orgId: string): boolean {
  const db = getDb();
  const row = db.select({ orgId: knowledgeBases.orgId }).from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.orgId, orgId)))
    .get();
  return !!row;
}

/** Get a KB by its dataset name. */
export function getKBByDatasetName(datasetName: string): KnowledgeBase | undefined {
  const db = getDb();
  const row = db.select().from(knowledgeBases).where(eq(knowledgeBases.datasetName, datasetName)).get();
  return row ? rowToKB(row) : undefined;
}

/** List all KBs, optionally filtered by type, owner, and/or org. */
export function listKBs(opts?: {
  type?: KnowledgeBaseType;
  ownerId?: string;
  orgId?: string;
  includeArchived?: boolean;
}): KnowledgeBase[] {
  const db = getDb();
  const conditions = [];

  if (opts?.type) {
    conditions.push(eq(knowledgeBases.type, opts.type));
  }
  if (opts?.ownerId) {
    conditions.push(eq(knowledgeBases.ownerId, opts.ownerId));
  }
  if (opts?.orgId) {
    conditions.push(eq(knowledgeBases.orgId, opts.orgId));
  }
  if (!opts?.includeArchived) {
    conditions.push(eq(knowledgeBases.status, "active"));
  }

  const query = conditions.length > 0
    ? db.select().from(knowledgeBases).where(and(...conditions))
    : db.select().from(knowledgeBases);

  return query.all().map(rowToKB);
}

/**
 * List KBs accessible to a specific user email.
 * Admins see all KBs. Regular users only see KBs with accessMode "all"
 * or restricted KBs where their email is in the access list.
 */
export function listAccessibleKBs(email: string, isAdmin: boolean, orgId?: string): KnowledgeBase[] {
  if (isAdmin) return listKBs({ type: "organization", ...(orgId && { orgId }) });

  const allKBs = listKBs({ type: "organization", ...(orgId && { orgId }) });
  const db = getDb();

  // Get all KB IDs this user has explicit access to
  const accessRows = db
    .select({ kbId: kbAccess.kbId })
    .from(kbAccess)
    .where(eq(kbAccess.email, email.toLowerCase()))
    .all();
  const accessibleIds = new Set(accessRows.map((r) => r.kbId));

  return allKBs.filter(
    (kb) => kb.accessMode === "all" || accessibleIds.has(kb.id),
  );
}

/** Update KB metadata. */
export function updateKB(
  id: string,
  data: { name?: string; description?: string; accessMode?: KBAccessMode },
): KnowledgeBase | undefined {
  const db = getDb();
  const existing = getKB(id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  db.update(knowledgeBases)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.accessMode !== undefined && { accessMode: data.accessMode }),
      updatedAt: now,
    })
    .where(eq(knowledgeBases.id, id))
    .run();

  return getKB(id);
}

/** Archive a KB (soft delete). */
export function archiveKB(id: string): KnowledgeBase | undefined {
  const db = getDb();
  const existing = getKB(id);
  if (!existing) return undefined;

  db.update(knowledgeBases)
    .set({ status: "archived", updatedAt: new Date().toISOString() })
    .where(eq(knowledgeBases.id, id))
    .run();

  return getKB(id);
}

/** Hard delete a KB. Does NOT delete the mKB dataset or files — caller must handle that. */
export function deleteKB(id: string): void {
  const db = getDb();
  db.delete(kbAccess).where(eq(kbAccess.kbId, id)).run();
  db.delete(knowledgeBases).where(eq(knowledgeBases.id, id)).run();
}

/** Recalculate and update document count for a KB. */
export function refreshDocumentCount(knowledgeBaseId: string): void {
  const db = getDb();
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(documents)
    .where(eq(documents.knowledgeBaseId, knowledgeBaseId))
    .get();

  const count = result?.count ?? 0;
  db.update(knowledgeBases)
    .set({ documentCount: count, updatedAt: new Date().toISOString() })
    .where(eq(knowledgeBases.id, knowledgeBaseId))
    .run();
}

/** Get or create a default "Policy Documents" KB. Idempotent. */
export function ensureDefaultKB(ownerId: string, orgId?: string): KnowledgeBase {
  const existing = getKBByDatasetName("knowledge-base");
  if (existing) return existing;

  return createKB({
    name: "Policy Documents",
    description: "Default knowledge base for organization policy documents.",
    type: "organization",
    ownerId,
    ...(orgId && { orgId }),
    datasetName: "knowledge-base",
  });
}

// ─── KB Access Control ──────────────────────────────────────────────────────

/** Get the access list for a restricted KB. */
export function getKBAccessList(kbId: string): string[] {
  const db = getDb();
  const rows = db
    .select({ email: kbAccess.email })
    .from(kbAccess)
    .where(eq(kbAccess.kbId, kbId))
    .all();
  return rows.map((r) => r.email);
}

/** Set the access list for a KB (replaces existing list). */
export function setKBAccessList(kbId: string, emails: string[]): void {
  const db = getDb();
  // Clear existing
  db.delete(kbAccess).where(eq(kbAccess.kbId, kbId)).run();
  // Insert new
  const now = new Date().toISOString();
  for (const email of emails) {
    db.insert(kbAccess)
      .values({
        id: randomUUID(),
        kbId,
        email: email.toLowerCase().trim(),
        createdAt: now,
      })
      .run();
  }
}

/** Check if a user has access to a specific KB. */
export function userHasKBAccess(kbId: string, email: string): boolean {
  const kb = getKB(kbId);
  if (!kb) return false;
  if (kb.accessMode === "all") return true;

  const db = getDb();
  const row = db
    .select()
    .from(kbAccess)
    .where(and(eq(kbAccess.kbId, kbId), eq(kbAccess.email, email.toLowerCase())))
    .get();
  return !!row;
}
