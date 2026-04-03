/**
 * Core sync logic for a cloud folder sync.
 *
 * Fetches changes from the provider, downloads new/modified files,
 * feeds them into the existing ingestDocument() pipeline, and removes
 * documents whose external files were deleted.
 */
import path from "path";
import fsNode from "fs";
import { randomUUID } from "crypto";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { encryptFile } from "../lib/crypto.js";
import { getConnector } from "../connectors/registry.js";
import { getValidAccessToken } from "../services/cloudTokenStore.js";
import {
  getConnection,
  getFolderSync,
  getFolderSyncCursor,
  updateFolderSync,
  upsertSyncFile,
  getSyncFileByExternalId,
  listSyncFiles,
} from "../services/cloudConnectionStore.js";
import { refreshDocumentCount } from "../services/dataSourceStore.js";
import { setDocument, getDocument, deleteDocument } from "../services/documentStore.js";
import { clearChunksForDocument } from "../services/chunkRegistry.js";
import { ingestDocument } from "./ingestDocument.js";
import type { Document, DocumentType, CloudProvider, PIIMode } from "@edgebric/types";
import type { ConnectorChange } from "../connectors/types.js";

/** Map provider MIME types to supported document types. */
function mimeToDocType(mimeType: string, filename: string): DocumentType | undefined {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".txt") return "txt";
  if (ext === ".md") return "md";

  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mimeType === "text/plain") return "txt";
  if (mimeType === "text/markdown") return "md";
  if (mimeType === "application/vnd.google-apps.document") return "pdf";

  return undefined;
}

/** Process a single file change (add or modify). */
async function processFileChange(
  change: ConnectorChange,
  folderSyncId: string,
  provider: CloudProvider,
  dataSourceId: string,
  datasetName: string,
  accessToken: string,
  piiMode?: PIIMode,
): Promise<void> {
  const { file } = change;
  const docType = mimeToDocType(file.mimeType, file.name);

  if (!docType) {
    logger.debug({ file: file.name, mimeType: file.mimeType }, "Skipping unsupported file type");
    upsertSyncFile(folderSyncId, file.id, {
      externalName: file.name,
      externalModified: file.modifiedAt,
      status: "error",
      lastError: `Unsupported file type: ${file.mimeType}`,
    });
    return;
  }

  const connector = getConnector(provider)!;
  const { buffer, name: downloadedName } = await connector.downloadFile(accessToken, file.id);
  const finalName = downloadedName || file.name;

  // For modified files, clean up the old document before creating a new one
  if (change.type === "modified") {
    const existingSyncFile = getSyncFileByExternalId(folderSyncId, file.id);
    if (existingSyncFile?.documentId) {
      const oldDoc = getDocument(existingSyncFile.documentId);
      if (oldDoc) {
        clearChunksForDocument(oldDoc.id);
        deleteDocument(oldDoc.id);
        const oldPath = path.join(config.dataDir, oldDoc.storageKey);
        try { fsNode.unlinkSync(oldPath); } catch { /* file may already be gone */ }
      }
    }
  }

  const uploadsDir = path.join(config.dataDir, "uploads");
  fsNode.mkdirSync(uploadsDir, { recursive: true });

  const docId = randomUUID();
  const ext = path.extname(finalName) || `.${docType}`;
  const storageFilename = `${docId}${ext}`;
  const storagePath = path.join(uploadsDir, storageFilename);

  fsNode.writeFileSync(storagePath, buffer, { mode: 0o600 });
  encryptFile(storagePath);

  const doc: Document = {
    id: docId,
    name: finalName,
    type: docType,
    classification: "policy",
    uploadedAt: new Date(),
    updatedAt: new Date(),
    status: "processing",
    sectionHeadings: [],
    storageKey: `uploads/${storageFilename}`,
    dataSourceId,
  };
  setDocument(doc);

  upsertSyncFile(folderSyncId, file.id, {
    externalName: finalName,
    externalModified: file.modifiedAt,
    documentId: docId,
    status: "pending",
    lastError: null,
  });

  try {
    await ingestDocument(doc, { datasetName, ...(piiMode && { piiMode }) });
    upsertSyncFile(folderSyncId, file.id, {
      externalName: finalName,
      externalModified: file.modifiedAt,
      documentId: docId,
      status: "synced",
      lastError: null,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ file: finalName, err: errMsg }, "Failed to ingest synced file");
    upsertSyncFile(folderSyncId, file.id, {
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
  folderSyncId: string,
): void {
  // Find the sync file by external ID
  const allFiles = listSyncFiles(folderSyncId);
  const syncFile = allFiles.find((f) => f.externalFileId === change.file.id);
  if (!syncFile) return;

  if (syncFile.documentId) {
    const doc = getDocument(syncFile.documentId);
    if (doc) {
      clearChunksForDocument(doc.id);
      deleteDocument(doc.id);
      const filePath = path.join(config.dataDir, doc.storageKey);
      try { fsNode.unlinkSync(filePath); } catch { /* file may already be gone */ }
      logger.info({ file: doc.name, docId: doc.id }, "Deleted synced document (external file removed)");
    }
  }

  upsertSyncFile(folderSyncId, change.file.id, {
    externalName: syncFile.externalName,
    status: "deleted",
    lastError: null,
  });
}

/**
 * Execute a full sync for a single folder sync.
 */
export async function syncFolderSync(folderSyncId: string): Promise<{
  added: number;
  modified: number;
  deleted: number;
  errors: number;
}> {
  const folderSync = getFolderSync(folderSyncId);
  if (!folderSync) throw new Error(`Folder sync not found: ${folderSyncId}`);

  const conn = getConnection(folderSync.connectionId);
  if (!conn) throw new Error(`Connection not found: ${folderSync.connectionId}`);

  const connector = getConnector(conn.provider as CloudProvider);
  if (!connector) throw new Error(`No connector for provider: ${conn.provider}`);

  const accessToken = await getValidAccessToken(conn.id, conn.provider as CloudProvider);
  const cursor = getFolderSyncCursor(folderSyncId);

  const result = await connector.getChanges(accessToken, folderSync.folderId, cursor);

  const stats = { added: 0, modified: 0, deleted: 0, errors: 0 };

  const { getDataSource } = await import("../services/dataSourceStore.js");
  const ds = getDataSource(folderSync.dataSourceId);
  if (!ds) throw new Error(`Data source not found for folder sync: ${folderSyncId}`);

  for (const change of result.changes) {
    try {
      if (change.type === "deleted") {
        processFileDeletion(change, folderSyncId);
        stats.deleted++;
      } else {
        await processFileChange(
          change,
          folderSyncId,
          conn.provider as CloudProvider,
          folderSync.dataSourceId,
          ds.datasetName,
          accessToken,
          ds.piiMode,
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

  const now = new Date().toISOString();
  updateFolderSync(folderSyncId, {
    lastSyncAt: now,
    lastError: stats.errors > 0 ? `${stats.errors} file(s) failed to sync` : null,
    syncCursor: result.newCursor,
    status: stats.errors > 0 && stats.added === 0 && stats.modified === 0 ? "error" : "active",
  });

  refreshDocumentCount(folderSync.dataSourceId);

  logger.info(
    { folderSyncId, provider: conn.provider, ...stats },
    "Cloud sync completed",
  );

  return stats;
}
