/**
 * Cloud connection persistence layer.
 *
 * Manages cloud_connections and cloud_sync_files tables.
 * Each connection is linked 1:1 with a data source.
 */
import { getDb } from "../db/index.js";
import { cloudConnections, cloudSyncFiles } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { CloudConnection, CloudSyncFile, CloudProvider, CloudConnectionStatus, CloudSyncFileStatus } from "@edgebric/types";

// ─── Row → Type converters ──────────────────────────────────────────────────

function rowToConnection(row: typeof cloudConnections.$inferSelect): CloudConnection {
  return {
    id: row.id,
    provider: row.provider as CloudProvider,
    displayName: row.displayName,
    dataSourceId: row.dataSourceId,
    orgId: row.orgId,
    accountEmail: row.accountEmail ?? undefined,
    folderId: row.folderId ?? undefined,
    folderName: row.folderName ?? undefined,
    syncIntervalMin: row.syncIntervalMin,
    status: row.status as CloudConnectionStatus,
    lastSyncAt: row.lastSyncAt ?? undefined,
    lastError: row.lastError ?? undefined,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToSyncFile(row: typeof cloudSyncFiles.$inferSelect): CloudSyncFile {
  return {
    id: row.id,
    connectionId: row.connectionId,
    externalFileId: row.externalFileId,
    externalName: row.externalName,
    externalModified: row.externalModified ?? undefined,
    documentId: row.documentId ?? undefined,
    status: row.status as CloudSyncFileStatus,
    lastError: row.lastError ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Connections ────────────────────────────────────────────────────────────

export function createConnection(opts: {
  provider: CloudProvider;
  displayName: string;
  dataSourceId: string;
  orgId: string;
  accountEmail?: string | undefined;
  folderId?: string | undefined;
  folderName?: string | undefined;
  syncIntervalMin?: number | undefined;
  createdBy: string;
}): CloudConnection {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.insert(cloudConnections)
    .values({
      id,
      provider: opts.provider,
      displayName: opts.displayName,
      dataSourceId: opts.dataSourceId,
      orgId: opts.orgId,
      accountEmail: opts.accountEmail ?? null,
      folderId: opts.folderId ?? null,
      folderName: opts.folderName ?? null,
      syncIntervalMin: opts.syncIntervalMin ?? 60,
      status: "active",
      createdBy: opts.createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return getConnection(id)!;
}

export function getConnection(id: string): CloudConnection | undefined {
  const db = getDb();
  const row = db.select().from(cloudConnections).where(eq(cloudConnections.id, id)).get();
  if (!row) return undefined;

  const conn = rowToConnection(row);

  // Attach computed counts
  const syncCount = db
    .select({ count: sql<number>`count(*)` })
    .from(cloudSyncFiles)
    .where(and(eq(cloudSyncFiles.connectionId, id), eq(cloudSyncFiles.status, "synced")))
    .get();
  conn.syncedFileCount = syncCount?.count ?? 0;

  return conn;
}

export function listConnections(orgId: string): CloudConnection[] {
  const db = getDb();
  const rows = db.select().from(cloudConnections).where(eq(cloudConnections.orgId, orgId)).all();
  return rows.map(rowToConnection);
}

export function updateConnection(
  id: string,
  data: {
    displayName?: string | undefined;
    folderId?: string | undefined;
    folderName?: string | undefined;
    syncIntervalMin?: number | undefined;
    status?: CloudConnectionStatus | undefined;
    lastSyncAt?: string | undefined;
    lastError?: string | null | undefined;
    syncCursor?: string | null | undefined;
    accountEmail?: string | undefined;
  },
): CloudConnection | undefined {
  const db = getDb();
  const now = new Date().toISOString();

  db.update(cloudConnections)
    .set({
      ...(data.displayName !== undefined && { displayName: data.displayName }),
      ...(data.folderId !== undefined && { folderId: data.folderId }),
      ...(data.folderName !== undefined && { folderName: data.folderName }),
      ...(data.syncIntervalMin !== undefined && { syncIntervalMin: data.syncIntervalMin }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.lastSyncAt !== undefined && { lastSyncAt: data.lastSyncAt }),
      ...(data.lastError !== undefined && { lastError: data.lastError }),
      ...(data.syncCursor !== undefined && { syncCursor: data.syncCursor }),
      ...(data.accountEmail !== undefined && { accountEmail: data.accountEmail }),
      updatedAt: now,
    })
    .where(eq(cloudConnections.id, id))
    .run();

  return getConnection(id);
}

export function deleteConnection(id: string): void {
  const db = getDb();
  // Delete sync files first (FK)
  db.delete(cloudSyncFiles).where(eq(cloudSyncFiles.connectionId, id)).run();
  // Delete connection
  db.delete(cloudConnections).where(eq(cloudConnections.id, id)).run();
}

/** Get the raw sync cursor for a connection (not exposed in the CloudConnection type). */
export function getSyncCursor(id: string): string | null {
  const db = getDb();
  const row = db
    .select({ syncCursor: cloudConnections.syncCursor })
    .from(cloudConnections)
    .where(eq(cloudConnections.id, id))
    .get();
  return row?.syncCursor ?? null;
}

// ─── Sync Files ─────────────────────────────────────────────────────────────

export function upsertSyncFile(
  connectionId: string,
  externalFileId: string,
  data: {
    externalName: string;
    externalModified?: string | undefined;
    documentId?: string | undefined;
    status: CloudSyncFileStatus;
    lastError?: string | null | undefined;
  },
): CloudSyncFile {
  const db = getDb();
  const now = new Date().toISOString();

  // Check if exists
  const existing = db
    .select()
    .from(cloudSyncFiles)
    .where(and(eq(cloudSyncFiles.connectionId, connectionId), eq(cloudSyncFiles.externalFileId, externalFileId)))
    .get();

  if (existing) {
    db.update(cloudSyncFiles)
      .set({
        externalName: data.externalName,
        ...(data.externalModified !== undefined && { externalModified: data.externalModified }),
        ...(data.documentId !== undefined && { documentId: data.documentId }),
        status: data.status,
        ...(data.lastError !== undefined && { lastError: data.lastError }),
        updatedAt: now,
      })
      .where(eq(cloudSyncFiles.id, existing.id))
      .run();
    return getSyncFile(existing.id)!;
  }

  const id = randomUUID();
  db.insert(cloudSyncFiles)
    .values({
      id,
      connectionId,
      externalFileId,
      externalName: data.externalName,
      externalModified: data.externalModified ?? null,
      documentId: data.documentId ?? null,
      status: data.status,
      lastError: data.lastError ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return getSyncFile(id)!;
}

export function getSyncFile(id: string): CloudSyncFile | undefined {
  const db = getDb();
  const row = db.select().from(cloudSyncFiles).where(eq(cloudSyncFiles.id, id)).get();
  return row ? rowToSyncFile(row) : undefined;
}

export function getSyncFileByExternalId(connectionId: string, externalFileId: string): CloudSyncFile | undefined {
  const db = getDb();
  const row = db
    .select()
    .from(cloudSyncFiles)
    .where(and(eq(cloudSyncFiles.connectionId, connectionId), eq(cloudSyncFiles.externalFileId, externalFileId)))
    .get();
  return row ? rowToSyncFile(row) : undefined;
}

export function listSyncFiles(connectionId: string): CloudSyncFile[] {
  const db = getDb();
  const rows = db.select().from(cloudSyncFiles).where(eq(cloudSyncFiles.connectionId, connectionId)).all();
  return rows.map(rowToSyncFile);
}

export function deleteSyncFile(id: string): void {
  const db = getDb();
  db.delete(cloudSyncFiles).where(eq(cloudSyncFiles.id, id)).run();
}
