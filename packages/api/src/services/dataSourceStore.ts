import type { DataSource, DataSourceType, DataSourceAccessMode } from "@edgebric/types";
import { getDb } from "../db/index.js";
import { dataSources, documents, dataSourceAccess } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

function rowToDataSource(row: typeof dataSources.$inferSelect): DataSource {
  const ds: DataSource = {
    id: row.id,
    name: row.name,
    type: row.type as DataSourceType,
    ownerId: row.ownerId,
    datasetName: row.datasetName,
    documentCount: row.documentCount,
    status: row.status as DataSource["status"],
    accessMode: (row.accessMode ?? "all") as DataSourceAccessMode,
    allowSourceViewing: row.allowSourceViewing !== 0,
    allowVaultSync: row.allowVaultSync !== 0,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
  if (row.description != null) ds.description = row.description;
  if (row.avatarUrl != null) ds.avatarUrl = row.avatarUrl;
  return ds;
}

/** Create a new data source. Returns the created data source. */
export function createDataSource(opts: {
  name: string;
  description?: string;
  type?: DataSourceType;
  ownerId: string;
  orgId?: string;
  datasetName?: string;
}): DataSource {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  // Generate a unique dataset name prefix for chunk IDs
  const datasetName = opts.datasetName ?? `ds-${id.slice(0, 8)}`;

  db.insert(dataSources)
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

  return getDataSource(id)!;
}

/** Get a single data source by ID. */
export function getDataSource(id: string): DataSource | undefined {
  const db = getDb();
  const row = db.select().from(dataSources).where(eq(dataSources.id, id)).get();
  return row ? rowToDataSource(row) : undefined;
}

/** Check if a data source belongs to a specific org. */
export function dataSourceBelongsToOrg(dataSourceId: string, orgId: string): boolean {
  const db = getDb();
  const row = db.select({ orgId: dataSources.orgId }).from(dataSources)
    .where(and(eq(dataSources.id, dataSourceId), eq(dataSources.orgId, orgId)))
    .get();
  return !!row;
}

/** Get a data source by its dataset name. */
export function getDataSourceByDatasetName(datasetName: string): DataSource | undefined {
  const db = getDb();
  const row = db.select().from(dataSources).where(eq(dataSources.datasetName, datasetName)).get();
  return row ? rowToDataSource(row) : undefined;
}

/** List all data sources, optionally filtered by type, owner, and/or org. */
export function listDataSources(opts?: {
  type?: DataSourceType;
  ownerId?: string;
  orgId?: string;
  includeArchived?: boolean;
}): DataSource[] {
  const db = getDb();
  const conditions = [];

  if (opts?.type) {
    conditions.push(eq(dataSources.type, opts.type));
  }
  if (opts?.ownerId) {
    conditions.push(eq(dataSources.ownerId, opts.ownerId));
  }
  if (opts?.orgId) {
    conditions.push(eq(dataSources.orgId, opts.orgId));
  }
  if (!opts?.includeArchived) {
    conditions.push(eq(dataSources.status, "active"));
  }

  const query = conditions.length > 0
    ? db.select().from(dataSources).where(and(...conditions))
    : db.select().from(dataSources);

  return query.all().map(rowToDataSource);
}

/**
 * List data sources accessible to a specific user email.
 * Admins see all data sources. Regular users only see data sources with accessMode "all"
 * or restricted data sources where their email is in the access list.
 */
export function listAccessibleDataSources(email: string, isAdmin: boolean, orgId?: string): DataSource[] {
  // Org-wide sources
  const orgDataSources = listDataSources({ type: "organization", ...(orgId && { orgId }) });
  // Personal/vault sources owned by this user
  const myVaultDataSources = listDataSources({ type: "personal", ownerId: email.toLowerCase() });

  if (isAdmin) return [...orgDataSources, ...myVaultDataSources];

  const db = getDb();

  // Get all data source IDs this user has explicit access to
  const accessRows = db
    .select({ dataSourceId: dataSourceAccess.dataSourceId })
    .from(dataSourceAccess)
    .where(eq(dataSourceAccess.email, email.toLowerCase()))
    .all();
  const accessibleIds = new Set(accessRows.map((r) => r.dataSourceId));

  const accessibleOrgDataSources = orgDataSources.filter(
    (ds) => ds.accessMode === "all" || accessibleIds.has(ds.id),
  );

  return [...accessibleOrgDataSources, ...myVaultDataSources];
}

/** Update data source metadata. */
export function updateDataSource(
  id: string,
  data: {
    name?: string;
    description?: string;
    type?: "organization" | "personal";
    accessMode?: DataSourceAccessMode;
    avatarUrl?: string;
    allowSourceViewing?: boolean;
    allowVaultSync?: boolean;
  },
): DataSource | undefined {
  const db = getDb();
  const existing = getDataSource(id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  db.update(dataSources)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.type !== undefined && { type: data.type }),
      ...(data.accessMode !== undefined && { accessMode: data.accessMode }),
      ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
      ...(data.allowSourceViewing !== undefined && { allowSourceViewing: data.allowSourceViewing ? 1 : 0 }),
      ...(data.allowVaultSync !== undefined && { allowVaultSync: data.allowVaultSync ? 1 : 0 }),
      updatedAt: now,
    })
    .where(eq(dataSources.id, id))
    .run();

  return getDataSource(id);
}

/** Archive a data source (soft delete). */
export function archiveDataSource(id: string): DataSource | undefined {
  const db = getDb();
  const existing = getDataSource(id);
  if (!existing) return undefined;

  db.update(dataSources)
    .set({ status: "archived", updatedAt: new Date().toISOString() })
    .where(eq(dataSources.id, id))
    .run();

  return getDataSource(id);
}

/** Hard delete a data source. Does NOT delete chunks or files — caller must handle that. */
export function deleteDataSource(id: string): void {
  const db = getDb();
  db.delete(dataSourceAccess).where(eq(dataSourceAccess.dataSourceId, id)).run();
  db.delete(dataSources).where(eq(dataSources.id, id)).run();
}

/** Recalculate and update document count for a data source. */
export function refreshDocumentCount(dataSourceId: string): void {
  const db = getDb();
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(documents)
    .where(eq(documents.dataSourceId, dataSourceId))
    .get();

  const count = result?.count ?? 0;
  db.update(dataSources)
    .set({ documentCount: count, updatedAt: new Date().toISOString() })
    .where(eq(dataSources.id, dataSourceId))
    .run();
}

/** Get or create a default "Policy Documents" data source. Idempotent. */
export function ensureDefaultDataSource(ownerId: string, orgId?: string): DataSource {
  const existing = getDataSourceByDatasetName("knowledge-base");
  if (existing) return existing;

  return createDataSource({
    name: "Policy Documents",
    description: "Default source for organization policy documents.",
    type: "organization",
    ownerId,
    ...(orgId && { orgId }),
    datasetName: "knowledge-base",
  });
}

// ─── Data Source Access Control ─────────────────────────────────────────────

/** Get the access list for a restricted data source. */
export function getDataSourceAccessList(dataSourceId: string): string[] {
  const db = getDb();
  const rows = db
    .select({ email: dataSourceAccess.email })
    .from(dataSourceAccess)
    .where(eq(dataSourceAccess.dataSourceId, dataSourceId))
    .all();
  return rows.map((r) => r.email);
}

/** Set the access list for a data source (replaces existing list). */
export function setDataSourceAccessList(dataSourceId: string, emails: string[]): void {
  const db = getDb();
  // Clear existing
  db.delete(dataSourceAccess).where(eq(dataSourceAccess.dataSourceId, dataSourceId)).run();
  // Insert new
  const now = new Date().toISOString();
  for (const email of emails) {
    db.insert(dataSourceAccess)
      .values({
        id: randomUUID(),
        dataSourceId,
        email: email.toLowerCase().trim(),
        createdAt: now,
      })
      .run();
  }
}

/** Check if a user has access to a specific data source. */
export function userHasDataSourceAccess(dataSourceId: string, email: string): boolean {
  const ds = getDataSource(dataSourceId);
  if (!ds) return false;
  if (ds.accessMode === "all") return true;

  const db = getDb();
  const row = db
    .select()
    .from(dataSourceAccess)
    .where(and(eq(dataSourceAccess.dataSourceId, dataSourceId), eq(dataSourceAccess.email, email.toLowerCase())))
    .get();
  return !!row;
}
