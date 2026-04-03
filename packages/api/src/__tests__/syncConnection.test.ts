import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import path from "path";
import fs from "fs";
import { setupTestApp, teardownTestApp, getDefaultOrgId } from "./helpers.js";
import {
  createConnection,
  createFolderSync,
  getFolderSync,
  getSyncFileByExternalId,
  listSyncFiles,
  upsertSyncFile,
} from "../services/cloudConnectionStore.js";
import { createDataSource } from "../services/dataSourceStore.js";
import { saveTokens } from "../services/cloudTokenStore.js";
import { getDocument, setDocument } from "../services/documentStore.js";
import { registerConnector } from "../connectors/registry.js";
import type { CloudConnectorAdapter, OAuthTokens, ConnectorSyncResult } from "../connectors/types.js";
import type { CloudFolder } from "@edgebric/types";
import { config } from "../config.js";

// ─── Mock ingestDocument so we don't need real embeddings ────────────────────

vi.mock("../jobs/ingestDocument.js", () => ({
  ingestDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/crypto.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/crypto.js")>();
  return {
    ...actual,
    // encryptFile is called on the downloaded file — skip actual encryption in tests
    encryptFile: vi.fn(),
  };
});

// ─── Mock connector ──────────────────────────────────────────────────────────

function createMockConnector(overrides: Partial<CloudConnectorAdapter> = {}): CloudConnectorAdapter {
  return {
    provider: "google_drive",
    getAuthUrl: (state: string, redirectUri: string) =>
      `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: vi.fn().mockResolvedValue({
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      accountEmail: "user@example.com",
      scopes: "drive.readonly email",
    } satisfies OAuthTokens),
    refreshAccessToken: vi.fn().mockResolvedValue({
      accessToken: "mock-refreshed-token",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }),
    listFolders: vi.fn().mockResolvedValue([] satisfies CloudFolder[]),
    getChanges: vi.fn().mockResolvedValue({ changes: [], newCursor: "cursor-1" } satisfies ConnectorSyncResult),
    downloadFile: vi.fn().mockResolvedValue({
      buffer: Buffer.from("mock file content"),
      mimeType: "text/plain",
      name: "test.txt",
    }),
    ...overrides,
  };
}

// ─── Test helpers ────────────────────────────────────────────────────────────

function seedFolderSync(orgId: string) {
  const ds = createDataSource({
    name: "Cloud Sync Test",
    description: "Test data source",
    type: "organization",
    ownerId: "admin@test.com",
    orgId,
  });

  const conn = createConnection({
    provider: "google_drive",
    displayName: "Google Drive (test@example.com)",
    orgId,
    accountEmail: "test@example.com",
    createdBy: "admin@test.com",
  });

  saveTokens(conn.id, {
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });

  const folderSync = createFolderSync({
    connectionId: conn.id,
    dataSourceId: ds.id,
    folderId: "gdrive-folder-123",
    folderName: "Engineering Docs",
    createdBy: "admin@test.com",
  });

  return { ds, conn, folderSync };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("syncFolderSync", () => {
  let orgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
    registerConnector(createMockConnector());

    // Ensure uploads directory exists
    const uploadsDir = path.join(config.dataDir, "uploads");
    fs.mkdirSync(uploadsDir, { recursive: true });
  });

  afterAll(() => {
    teardownTestApp();
  });

  beforeEach(() => {
    // Reset mock connector to defaults
    registerConnector(createMockConnector());
  });

  it("syncs added files and creates documents", async () => {
    const { syncFolderSync } = await import("../jobs/syncConnection.js");

    const mockConnector = createMockConnector({
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          {
            type: "added",
            file: { id: "file-1", name: "report.pdf", mimeType: "application/pdf", modifiedAt: "2026-03-01T10:00:00Z" },
          },
          {
            type: "added",
            file: { id: "file-2", name: "notes.txt", mimeType: "text/plain", modifiedAt: "2026-03-02T12:00:00Z" },
          },
        ],
        newCursor: "cursor-after-add",
      }),
      downloadFile: vi.fn().mockResolvedValue({
        buffer: Buffer.from("mock content"),
        mimeType: "application/pdf",
        name: "report.pdf",
      }),
    });
    registerConnector(mockConnector);

    const { folderSync } = seedFolderSync(orgId);
    const stats = await syncFolderSync(folderSync.id);

    expect(stats.added).toBe(2);
    expect(stats.modified).toBe(0);
    expect(stats.deleted).toBe(0);
    expect(stats.errors).toBe(0);

    // Verify sync files were created
    const syncFile1 = getSyncFileByExternalId(folderSync.id, "file-1");
    expect(syncFile1).toBeDefined();
    expect(syncFile1!.status).toBe("synced");
    expect(syncFile1!.documentId).toBeDefined();

    const syncFile2 = getSyncFileByExternalId(folderSync.id, "file-2");
    expect(syncFile2).toBeDefined();
    expect(syncFile2!.status).toBe("synced");

    // Verify documents were created
    const doc = getDocument(syncFile1!.documentId!);
    expect(doc).toBeDefined();
    expect(doc!.dataSourceId).toBe(folderSync.dataSourceId);

    // Verify cursor was updated
    const updated = getFolderSync(folderSync.id);
    expect(updated!.lastSyncAt).toBeDefined();
  });

  it("handles deleted files and removes documents", async () => {
    const { syncFolderSync } = await import("../jobs/syncConnection.js");

    // First sync: add a file
    const mockConnector = createMockConnector({
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          { type: "added", file: { id: "del-file-1", name: "temp.txt", mimeType: "text/plain", modifiedAt: "2026-03-01T10:00:00Z" } },
        ],
        newCursor: "cursor-1",
      }),
      downloadFile: vi.fn().mockResolvedValue({
        buffer: Buffer.from("temporary content"),
        mimeType: "text/plain",
        name: "temp.txt",
      }),
    });
    registerConnector(mockConnector);

    const { folderSync } = seedFolderSync(orgId);
    await syncFolderSync(folderSync.id);

    const syncFile = getSyncFileByExternalId(folderSync.id, "del-file-1");
    expect(syncFile).toBeDefined();
    const docId = syncFile!.documentId!;
    expect(getDocument(docId)).toBeDefined();

    // Second sync: delete the file
    registerConnector(createMockConnector({
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          { type: "deleted", file: { id: "del-file-1", name: "temp.txt", mimeType: "text/plain", modifiedAt: "2026-03-05T10:00:00Z" } },
        ],
        newCursor: "cursor-2",
      }),
    }));

    const stats = await syncFolderSync(folderSync.id);

    expect(stats.deleted).toBe(1);
    expect(stats.added).toBe(0);

    // Document should be gone
    expect(getDocument(docId)).toBeUndefined();

    // Sync file should be marked deleted
    const updatedSyncFile = getSyncFileByExternalId(folderSync.id, "del-file-1");
    expect(updatedSyncFile!.status).toBe("deleted");
  });

  it("handles modified files by replacing old document", async () => {
    const { syncFolderSync } = await import("../jobs/syncConnection.js");

    // First sync: add a file
    registerConnector(createMockConnector({
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          { type: "added", file: { id: "mod-file-1", name: "doc.txt", mimeType: "text/plain", modifiedAt: "2026-03-01T10:00:00Z" } },
        ],
        newCursor: "cursor-1",
      }),
      downloadFile: vi.fn().mockResolvedValue({
        buffer: Buffer.from("version 1"),
        mimeType: "text/plain",
        name: "doc.txt",
      }),
    }));

    const { folderSync } = seedFolderSync(orgId);
    await syncFolderSync(folderSync.id);

    const syncFileV1 = getSyncFileByExternalId(folderSync.id, "mod-file-1");
    const oldDocId = syncFileV1!.documentId!;
    expect(getDocument(oldDocId)).toBeDefined();

    // Second sync: modify the file
    registerConnector(createMockConnector({
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          { type: "modified", file: { id: "mod-file-1", name: "doc.txt", mimeType: "text/plain", modifiedAt: "2026-03-10T10:00:00Z" } },
        ],
        newCursor: "cursor-2",
      }),
      downloadFile: vi.fn().mockResolvedValue({
        buffer: Buffer.from("version 2"),
        mimeType: "text/plain",
        name: "doc.txt",
      }),
    }));

    const stats = await syncFolderSync(folderSync.id);

    expect(stats.modified).toBe(1);

    // Old document should be cleaned up
    expect(getDocument(oldDocId)).toBeUndefined();

    // New document should exist
    const syncFileV2 = getSyncFileByExternalId(folderSync.id, "mod-file-1");
    expect(syncFileV2!.documentId).toBeDefined();
    expect(syncFileV2!.documentId).not.toBe(oldDocId);
    expect(getDocument(syncFileV2!.documentId!)).toBeDefined();
    expect(syncFileV2!.status).toBe("synced");
  });

  it("skips unsupported file types with error status", async () => {
    const { syncFolderSync } = await import("../jobs/syncConnection.js");

    registerConnector(createMockConnector({
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          { type: "added", file: { id: "img-1", name: "photo.jpg", mimeType: "image/jpeg", modifiedAt: "2026-03-01T10:00:00Z" } },
        ],
        newCursor: "cursor-1",
      }),
    }));

    const { folderSync } = seedFolderSync(orgId);
    const stats = await syncFolderSync(folderSync.id);

    // Unsupported files count as added (they enter processFileChange) but get marked as error
    expect(stats.added).toBe(1);

    const syncFile = getSyncFileByExternalId(folderSync.id, "img-1");
    expect(syncFile).toBeDefined();
    expect(syncFile!.status).toBe("error");
    expect(syncFile!.lastError).toContain("Unsupported file type");
  });

  it("handles empty change set (no-op sync)", async () => {
    const { syncFolderSync } = await import("../jobs/syncConnection.js");

    registerConnector(createMockConnector({
      getChanges: vi.fn().mockResolvedValue({
        changes: [],
        newCursor: "cursor-empty",
      }),
    }));

    const { folderSync } = seedFolderSync(orgId);
    const stats = await syncFolderSync(folderSync.id);

    expect(stats.added).toBe(0);
    expect(stats.modified).toBe(0);
    expect(stats.deleted).toBe(0);
    expect(stats.errors).toBe(0);

    const updated = getFolderSync(folderSync.id);
    expect(updated!.lastSyncAt).toBeDefined();
    expect(updated!.status).toBe("active");
  });

  it("sets folder sync status to error when all files fail", async () => {
    const { syncFolderSync } = await import("../jobs/syncConnection.js");

    registerConnector(createMockConnector({
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          { type: "added", file: { id: "fail-1", name: "bad.txt", mimeType: "text/plain", modifiedAt: "2026-03-01T10:00:00Z" } },
        ],
        newCursor: "cursor-err",
      }),
      downloadFile: vi.fn().mockRejectedValue(new Error("Google API rate limit exceeded")),
    }));

    const { folderSync } = seedFolderSync(orgId);
    const stats = await syncFolderSync(folderSync.id);

    expect(stats.errors).toBe(1);
    expect(stats.added).toBe(0);

    const updated = getFolderSync(folderSync.id);
    expect(updated!.status).toBe("error");
    expect(updated!.lastError).toContain("1 file(s) failed");
  });

  it("stays active when some files succeed and some fail", async () => {
    const { syncFolderSync } = await import("../jobs/syncConnection.js");

    let callCount = 0;
    registerConnector(createMockConnector({
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          { type: "added", file: { id: "ok-1", name: "good.txt", mimeType: "text/plain", modifiedAt: "2026-03-01T10:00:00Z" } },
          { type: "added", file: { id: "fail-2", name: "bad.txt", mimeType: "text/plain", modifiedAt: "2026-03-01T10:00:00Z" } },
        ],
        newCursor: "cursor-partial",
      }),
      downloadFile: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error("Download failed"));
        }
        return Promise.resolve({
          buffer: Buffer.from("good content"),
          mimeType: "text/plain",
          name: "good.txt",
        });
      }),
    }));

    const { folderSync } = seedFolderSync(orgId);
    const stats = await syncFolderSync(folderSync.id);

    expect(stats.added).toBe(1);
    expect(stats.errors).toBe(1);

    // Status should stay active since at least one file succeeded
    const updated = getFolderSync(folderSync.id);
    expect(updated!.status).toBe("active");
  });

  it("throws when folder sync does not exist", async () => {
    const { syncFolderSync } = await import("../jobs/syncConnection.js");

    await expect(syncFolderSync("nonexistent-id")).rejects.toThrow("Folder sync not found");
  });

  it("correctly maps Google Docs MIME type to pdf", async () => {
    const { syncFolderSync } = await import("../jobs/syncConnection.js");

    registerConnector(createMockConnector({
      getChanges: vi.fn().mockResolvedValue({
        changes: [
          { type: "added", file: { id: "gdoc-1", name: "My Document", mimeType: "application/vnd.google-apps.document", modifiedAt: "2026-03-01T10:00:00Z" } },
        ],
        newCursor: "cursor-gdoc",
      }),
      downloadFile: vi.fn().mockResolvedValue({
        buffer: Buffer.from("exported pdf content"),
        mimeType: "application/pdf",
        name: "My Document.pdf",
      }),
    }));

    const { folderSync } = seedFolderSync(orgId);
    const stats = await syncFolderSync(folderSync.id);

    expect(stats.added).toBe(1);

    const syncFile = getSyncFileByExternalId(folderSync.id, "gdoc-1");
    expect(syncFile!.status).toBe("synced");

    const doc = getDocument(syncFile!.documentId!);
    expect(doc).toBeDefined();
    expect(doc!.type).toBe("pdf");
  });
});
