/**
 * Core sync logic for a single cloud connection.
 *
 * Fetches changes from the provider, downloads new/modified files,
 * feeds them into the existing ingestDocument() pipeline, and removes
 * documents whose external files were deleted.
 */
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { encryptFile } from "../lib/crypto.js";
import { getConnector } from "../connectors/registry.js";
import { getValidAccessToken } from "../services/cloudTokenStore.js";
import {
  getConnection,
  updateConnection,
  getSyncCursor,
  upsertSyncFile,
  getSyncFileByExternalId,
} from "../services/cloudConnectionStore.js";
import { refreshDocumentCount } from "../services/dataSourceStore.js";
import { setDocument, getDocument, deleteDocument } from "../services/documentStore.js";
import { clearChunksForDocument } from "../services/chunkRegistry.js";
import { ingestDocument } from "./ingestDocument.js";
import type { Document, DocumentType, CloudProvider } from "@edgebric/types";
import type { ConnectorChange } from "../connectors/types.js";

/** Map provider MIME types to supported document types. Returns undefined for unsupported types. */
function mimeToDocType(mimeType: string, filename: string): DocumentType | undefined {
  // Check extension first (more reliable for text files)
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".txt") return "txt";
  if (ext === ".md") return "md";

  // Fall back to MIME type
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mimeType === "text/plain") return "txt";
  if (mimeType === "text/markdown") return "md";
  // Google Docs get exported as PDF by the connector
  if (mimeType === "application/vnd.google-apps.document") return "pdf";

  return undefined;
}

/** Process a single file change (add or modify). */
async function processFileChange(
  change: ConnectorChange,
  connectionId: string,
  provider: CloudProvider,
  dataSourceId: string,
  datasetName: string,
  accessToken: string,
): Promise<void> {
  const { file } = change;
  const docType = mimeToDocType(file.mimeType, file.name);

  if (!docType) {
    logger.debug({ file: file.name, mimeType: file.mimeType }, "Skipping unsupported file type");
    upsertSyncFile(connectionId, file.id, {
      externalName: file.name,
      externalModified: file.modifiedAt,
      status: "error",
      lastError: `Unsupported file type: ${file.mimeType}`,
    });
    return;
  }

  const connector = getConnector(provider)!;

  // Download the file
  const { buffer, name: downloadedName } = await connector.downloadFile(accessToken, file.id);
  const finalName = downloadedName || file.name;

  // Write to uploads directory and encrypt
  const uploadsDir = path.join(config.dataDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });

  const docId = randomUUID();
  const ext = path.extname(finalName) || `.${docType}`;
  const storageFilename = `${docId}${ext}`;
  const storagePath = path.join(uploadsDir, storageFilename);

  fs.writeFileSync(storagePath, buffer, { mode: 0o600 });
  encryptFile(storagePath);

  // Check if this is a re-sync (file was modified)
  const existingSyncFile = getSyncFileByExternalId(connectionId, file.id);
  if (existingSyncFile?.documentId) {
    // Remove old document's chunks before re-ingesting
    const oldDoc = getDocument(existingSyncFile.documentId);
    if (oldDoc) {
      clearChunksForDocument(oldDoc.id);
      deleteDocument(oldDoc.id);
      // Clean up old file
      const oldPath = path.join(config.dataDir, oldDoc.storageKey);
      try { fs.unlinkSync(oldPath); } catch { /* file may already be gone */ }
    }
  }

  // Create document record
  const now = new Date();
  const doc: Document = {
    id: docId,
    name: finalName,
    type: docType,
    classification: "policy",
    uploadedAt: now,
    updatedAt: now,
    status: "processing",
    sectionHeadings: [],
    storageKey: `uploads/${storageFilename}`,
    dataSourceId,
  };
  setDocument(doc);

  // Track the sync file mapping
  upsertSyncFile(connectionId, file.id, {
    externalName: finalName,
    externalModified: file.modifiedAt,
    documentId: docId,
    status: "pending",
    lastError: null,
  });

  // Ingest (async — runs extraction, chunking, embedding)
  try {
    await ingestDocument(doc, { datasetName });
    upsertSyncFile(connectionId, file.id, {
      externalName: finalName,
      externalModified: file.modifiedAt,
      documentId: docId,
      status: "synced",
      lastError: null,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ file: finalName, err: errMsg }, "Failed to ingest synced file");
    upsertSyncFile(connectionId, file.id, {
      externalName: finalName,
      externalModified: file.modifiedAt,
      documentId: docId,
      status: "error",
      lastError: errMsg,
    });
  }
}

/** Process a file deletion. */
function processFileDeletion(
  change: ConnectorChange,
  connectionId: string,
): void {
  const syncFile = getSyncFileByExternalId(connectionId, change.file.id);
  if (!syncFile) return; // We weren't tracking this file

  if (syncFile.documentId) {
    const doc = getDocument(syncFile.documentId);
    if (doc) {
      clearChunksForDocument(doc.id);
      deleteDocument(doc.id);
      // Clean up file on disk
      const filePath = path.join(config.dataDir, doc.storageKey);
      try { fs.unlinkSync(filePath); } catch { /* file may already be gone */ }
      logger.info({ file: doc.name, docId: doc.id }, "Deleted synced document (external file removed)");
    }
  }

  // Mark as deleted (keep record for audit, will be cleaned up eventually)
  upsertSyncFile(connectionId, change.file.id, {
    externalName: syncFile.externalName,
    status: "deleted",
    lastError: null,
  });
}

/**
 * Execute a full sync for a single cloud connection.
 *
 * This is called by the sync scheduler or manually via the API.
 * Each file change is wrapped in its own try/catch so one failure
 * doesn't abort the entire sync.
 */
export async function syncConnection(connectionId: string): Promise<{
  added: number;
  modified: number;
  deleted: number;
  errors: number;
}> {
  const conn = getConnection(connectionId);
  if (!conn) throw new Error(`Connection not found: ${connectionId}`);
  if (!conn.folderId) throw new Error(`Connection ${connectionId} has no folder configured`);

  const connector = getConnector(conn.provider as CloudProvider);
  if (!connector) throw new Error(`No connector for provider: ${conn.provider}`);

  const accessToken = await getValidAccessToken(connectionId, conn.provider as CloudProvider);
  const cursor = getSyncCursor(connectionId);

  // Fetch changes from provider
  const result = await connector.getChanges(accessToken, conn.folderId, cursor);

  const stats = { added: 0, modified: 0, deleted: 0, errors: 0 };

  // Get the data source's dataset name for chunk ID prefixes
  // (imported inline to avoid circular deps)
  const { getDataSource } = await import("../services/dataSourceStore.js");
  const ds = getDataSource(conn.dataSourceId);
  if (!ds) throw new Error(`Data source not found for connection: ${connectionId}`);

  for (const change of result.changes) {
    try {
      if (change.type === "deleted") {
        processFileDeletion(change, connectionId);
        stats.deleted++;
      } else {
        await processFileChange(
          change,
          connectionId,
          conn.provider as CloudProvider,
          conn.dataSourceId,
          ds.datasetName,
          accessToken,
        );
        if (change.type === "added") stats.added++;
        else stats.modified++;
      }
    } catch (err) {
      stats.errors++;
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ file: change.file.name, changeType: change.type, err: errMsg }, "Error processing sync change");
    }
  }

  // Update connection state
  const now = new Date().toISOString();
  updateConnection(connectionId, {
    lastSyncAt: now,
    lastError: stats.errors > 0 ? `${stats.errors} file(s) failed to sync` : null,
    syncCursor: result.newCursor,
    status: stats.errors > 0 && stats.added === 0 && stats.modified === 0 ? "error" : "active",
  });

  // Refresh document count on the data source
  refreshDocumentCount(conn.dataSourceId);

  logger.info(
    { connectionId, provider: conn.provider, ...stats },
    "Cloud sync completed",
  );

  return stats;
}
