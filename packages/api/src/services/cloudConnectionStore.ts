/**
 * Cloud connection persistence layer.
 *
 * cloudConnections = OAuth credentials (one per user per provider).
 * cloudFolderSyncs = links a cloud folder to a data source via a connection.
 * cloudSyncFiles   = tracks individual files synced from a folder.
 */
import { getDb } from "../db/index.js";
import { cloudConnections, cloudFolderSyncs, cloudSyncFiles } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import type {
  CloudConnection, CloudConnectionStatus,
  CloudFolderSync, CloudFolderSyncStatus,
  CloudSyncFile, CloudSyncFileStatus,
  CloudProvider,
} from "@edgebric/types";

// ─── Row → Type converters ──────────────────────────────────────────────────

function rowToConnection(row: typeof cloudConnections.$inferSelect): CloudConnection {
  return {
    id: row.id,
    provider: row.provider as CloudProvider,
    displayName: row.displayName,
    orgId: row.orgId,
    accountEmail: row.accountEmail ?? undefined,
    status: row.status as CloudConnectionStatus,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToFolderSync(row: typeof cloudFolderSyncs.$inferSelect): CloudFolderSync {
  return {
    id: row.id,
    connectionId: row.connectionId,
    dataSourceId: row.dataSourceId,
    folderId: row.folderId,
    folderName: row.folderName,
    syncIntervalMin: row.syncIntervalMin,
    status: row.status as CloudFolderSyncStatus,
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
    folderSyncId: row.folderSyncId,
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

// ─── Connections (OAuth credentials) ───────────────────────────────────────

export function createConnection(opts: {
  provider: CloudProvider;
  displayName: string;
  orgId: string;
  accountEmail?: string | undefined;
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
      orgId: opts.orgId,
      accountEmail: opts.accountEmail ?? null,
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
  return row ? rowToConnection(row) : undefined;
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
    status?: CloudConnectionStatus | undefined;
    accountEmail?: string | undefined;
  },
): CloudConnection | undefined {
  const db = getDb();
  const now = new Date().toISOString();

  db.update(cloudConnections)
    .set({
      ...(data.displayName !== undefined && { displayName: data.displayName }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.accountEmail !== undefined && { accountEmail: data.accountEmail }),
      updatedAt: now,
    })
    .where(eq(cloudConnections.id, id))
    .run();

  return getConnection(id);
}

export function deleteConnection(id: string): void {
  const db = getDb();
  // Delete folder syncs and their files first
  const syncs = db.select({ id: cloudFolderSyncs.id }).from(cloudFolderSyncs)
    .where(eq(cloudFolderSyncs.connectionId, id)).all();
  for (const sync of syncs) {
    db.delete(cloudSyncFiles).where(eq(cloudSyncFiles.folderSyncId, sync.id)).run();
  }
  db.delete(cloudFolderSyncs).where(eq(cloudFolderSyncs.connectionId, id)).run();
  // Also delete sync files directly linked by connectionId as folderSyncId
  db.delete(cloudSyncFiles).where(eq(cloudSyncFiles.folderSyncId, id)).run();
  db.delete(cloudConnections).where(eq(cloudConnections.id, id)).run();
}

// ─── Folder Syncs ──────────────────────────────────────────────────────────

export function createFolderSync(opts: {
  connectionId: string;
  dataSourceId: string;
  folderId: string;
  folderName: string;
  syncIntervalMin?: number | undefined;
  createdBy: string;
}): CloudFolderSync {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.insert(cloudFolderSyncs)
    .values({
      id,
      connectionId: opts.connectionId,
      dataSourceId: opts.dataSourceId,
      folderId: opts.folderId,
      folderName: opts.folderName,
      syncIntervalMin: opts.syncIntervalMin ?? 60,
      status: "active",
      createdBy: opts.createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return getFolderSync(id)!;
}

export function getFolderSync(id: string): CloudFolderSync | undefined {
  const db = getDb();
  const row = db.select().from(cloudFolderSyncs).where(eq(cloudFolderSyncs.id, id)).get();
  if (!row) return undefined;

  const fs = rowToFolderSync(row);

  // Attach computed count
  const syncCount = db
    .select({ count: sql<number>`count(*)` })
    .from(cloudSyncFiles)
    .where(and(eq(cloudSyncFiles.folderSyncId, id), eq(cloudSyncFiles.status, "synced")))
    .get();
  fs.syncedFileCount = syncCount?.count ?? 0;

  // Attach connection info
  const conn = getConnection(row.connectionId);
  if (conn) {
    fs.provider = conn.provider;
    fs.accountEmail = conn.accountEmail;
  }

  return fs;
}

export function listFolderSyncs(dataSourceId: string): CloudFolderSync[] {
  const db = getDb();
  const rows = db.select().from(cloudFolderSyncs)
    .where(eq(cloudFolderSyncs.dataSourceId, dataSourceId)).all();
  return rows.map((row) => {
    const fs = rowToFolderSync(row);
    const conn = getConnection(row.connectionId);
    if (conn) {
      fs.provider = conn.provider;
      fs.accountEmail = conn.accountEmail;
    }
    return fs;
  });
}

export function listAllActiveFolderSyncs(): CloudFolderSync[] {
  const db = getDb();
  const rows = db.select().from(cloudFolderSyncs)
    .where(eq(cloudFolderSyncs.status, "active")).all();
  return rows.map(rowToFolderSync);
}

export function updateFolderSync(
  id: string,
  data: {
    folderId?: string | undefined;
    folderName?: string | undefined;
    syncIntervalMin?: number | undefined;
    status?: CloudFolderSyncStatus | undefined;
    lastSyncAt?: string | undefined;
    lastError?: string | null | undefined;
    syncCursor?: string | null | undefined;
  },
): CloudFolderSync | undefined {
  const db = getDb();
  const now = new Date().toISOString();

  db.update(cloudFolderSyncs)
    .set({
      ...(data.folderId !== undefined && { folderId: data.folderId }),
      ...(data.folderName !== undefined && { folderName: data.folderName }),
      ...(data.syncIntervalMin !== undefined && { syncIntervalMin: data.syncIntervalMin }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.lastSyncAt !== undefined && { lastSyncAt: data.lastSyncAt }),
      ...(data.lastError !== undefined && { lastError: data.lastError }),
      ...(data.syncCursor !== undefined && { syncCursor: data.syncCursor }),
      updatedAt: now,
    })
    .where(eq(cloudFolderSyncs.id, id))
    .run();

  return getFolderSync(id);
}

export function deleteFolderSync(id: string): void {
  const db = getDb();
  db.delete(cloudSyncFiles).where(eq(cloudSyncFiles.folderSyncId, id)).run();
  db.delete(cloudFolderSyncs).where(eq(cloudFolderSyncs.id, id)).run();
}

export function getFolderSyncCursor(id: string): string | null {
  const db = getDb();
  const row = db
    .select({ syncCursor: cloudFolderSyncs.syncCursor })
    .from(cloudFolderSyncs)
    .where(eq(cloudFolderSyncs.id, id))
    .get();
  return row?.syncCursor ?? null;
}

// ─── Sync Files ─────────────────────────────────────────────────────────────

export function upsertSyncFile(
  folderSyncId: string,
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

  const existing = db
    .select()
    .from(cloudSyncFiles)
    .where(and(eq(cloudSyncFiles.folderSyncId, folderSyncId), eq(cloudSyncFiles.externalFileId, externalFileId)))
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
      folderSyncId,
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

export function listSyncFiles(folderSyncId: string): CloudSyncFile[] {
  const db = getDb();
  const rows = db.select().from(cloudSyncFiles).where(eq(cloudSyncFiles.folderSyncId, folderSyncId)).all();
  return rows.map(rowToSyncFile);
}

export function getSyncFileByExternalId(folderSyncId: string, externalFileId: string): CloudSyncFile | undefined {
  const db = getDb();
  const row = db.select().from(cloudSyncFiles)
    .where(and(eq(cloudSyncFiles.folderSyncId, folderSyncId), eq(cloudSyncFiles.externalFileId, externalFileId)))
    .get();
  return row ? rowToSyncFile(row) : undefined;
}

export function deleteSyncFile(id: string): void {
  const db = getDb();
  db.delete(cloudSyncFiles).where(eq(cloudSyncFiles.id, id)).run();
}

// ─── Connection-level helpers ──────────────────────────────────────────────

/** List all folder syncs belonging to a connection. */
export function listFolderSyncsByConnectionId(connectionId: string): CloudFolderSync[] {
  const db = getDb();
  const rows = db.select().from(cloudFolderSyncs)
    .where(eq(cloudFolderSyncs.connectionId, connectionId)).all();
  return rows.map(rowToFolderSync);
}

/** List sync files across all folder syncs for a connection (and any directly linked by connectionId). */
export function listSyncFilesByConnectionId(connectionId: string): CloudSyncFile[] {
  const db = getDb();
  // Get folder sync IDs for this connection
  const syncIds = db.select({ id: cloudFolderSyncs.id }).from(cloudFolderSyncs)
    .where(eq(cloudFolderSyncs.connectionId, connectionId)).all().map((r) => r.id);

  // Include the connectionId itself as a possible folderSyncId (backward compat)
  const allIds = [...new Set([...syncIds, connectionId])];

  const rows: (typeof cloudSyncFiles.$inferSelect)[] = [];
  for (const id of allIds) {
    const batch = db.select().from(cloudSyncFiles).where(eq(cloudSyncFiles.folderSyncId, id)).all();
    rows.push(...batch);
  }
  return rows.map(rowToSyncFile);
}

/** Count synced files across all folder syncs for a connection (and any directly linked). */
export function countSyncedFilesByConnectionId(connectionId: string): number {
  const db = getDb();
  const syncIds = db.select({ id: cloudFolderSyncs.id }).from(cloudFolderSyncs)
    .where(eq(cloudFolderSyncs.connectionId, connectionId)).all().map((r) => r.id);

  const allIds = [...new Set([...syncIds, connectionId])];
  let count = 0;
  for (const id of allIds) {
    const result = db
      .select({ count: sql<number>`count(*)` })
      .from(cloudSyncFiles)
      .where(and(eq(cloudSyncFiles.folderSyncId, id), eq(cloudSyncFiles.status, "synced")))
      .get();
    count += result?.count ?? 0;
  }
  return count;
}
