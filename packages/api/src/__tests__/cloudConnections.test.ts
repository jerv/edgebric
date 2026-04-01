import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID, randomBytes } from "crypto";
import {
  setupTestApp,
  teardownTestApp,
  adminAgent,
  memberAgent,
  unauthAgent,
  getDefaultOrgId,
  createAgent,
} from "./helpers.js";
import {
  createConnection,
  createFolderSync,
  listSyncFiles,
  upsertSyncFile,
} from "../services/cloudConnectionStore.js";
import { createDataSource } from "../services/dataSourceStore.js";
import { saveTokens } from "../services/cloudTokenStore.js";
import { registerConnector } from "../connectors/registry.js";
import type { CloudConnectorAdapter, OAuthTokens } from "../connectors/types.js";
import type { CloudFolder } from "@edgebric/types";

// ─── Mock connector ──────────────────────────────────────────────────────────

function createMockConnector(overrides: Partial<CloudConnectorAdapter> = {}): CloudConnectorAdapter {
  return {
    provider: "google_drive",
    getAuthUrl: (state: string, redirectUri: string) =>
      `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: vi.fn().mockResolvedValue({
      accessToken: "mock-access-token-abc123",
      refreshToken: "mock-refresh-token-def456",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      accountEmail: "user@example.com",
      scopes: "drive.readonly email",
    } satisfies OAuthTokens),
    refreshAccessToken: vi.fn().mockResolvedValue({
      accessToken: "mock-refreshed-token",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }),
    listFolders: vi.fn().mockResolvedValue([
      { id: "folder-1", name: "Engineering Docs", hasChildren: true },
      { id: "folder-2", name: "HR Policies", hasChildren: false },
    ] satisfies CloudFolder[]),
    getChanges: vi.fn().mockResolvedValue({ changes: [], newCursor: "cursor-123" }),
    downloadFile: vi.fn().mockResolvedValue({
      buffer: Buffer.from("mock file content"),
      mimeType: "text/plain",
      name: "test.txt",
    }),
    ...overrides,
  };
}

// ─── Test helpers ────────────────────────────────────────────────────────────

/** Create a data source + cloud connection + optional folder sync directly in the DB. */
function seedConnection(orgId: string, opts: { provider?: string; folderId?: string } = {}) {
  const ds = createDataSource({
    name: "Google Drive (test@example.com)",
    description: "Synced from Google Drive",
    type: "organization",
    ownerId: "admin@test.com",
    orgId,
  });

  const conn = createConnection({
    provider: (opts.provider ?? "google_drive") as "google_drive",
    displayName: "Google Drive (test@example.com)",
    orgId,
    accountEmail: "test@example.com",
    createdBy: "admin@test.com",
  });

  // Store tokens so token lookups succeed
  saveTokens(conn.id, {
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });

  // Create folder sync if folderId provided
  let folderSync;
  if (opts.folderId) {
    folderSync = createFolderSync({
      connectionId: conn.id,
      dataSourceId: ds.id,
      folderId: opts.folderId,
      folderName: "Test Folder",
      createdBy: "admin@test.com",
    });
  }

  return { ds, conn, folderSync };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Cloud Connections API", () => {
  let orgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();

    // Register mock connector (replaces the real Google Drive connector loaded via import)
    registerConnector(createMockConnector());
  });

  afterAll(() => {
    teardownTestApp();
  });

  // ─── Authentication & Authorization ─────────────────────────────────────

  describe("Authentication & Authorization", () => {
    it("unauthenticated request returns 401", async () => {
      const res = await unauthAgent().get("/api/cloud-connections");
      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Authentication required");
    });

    it("non-admin member can access their own connections", async () => {
      const res = await memberAgent(orgId).get("/api/cloud-connections");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("connections");
    });

    it("without org selected returns 428", async () => {
      const agent = createAgent({
        email: "admin@test.com",
        isAdmin: true,
        // orgId intentionally omitted
      });
      const res = await agent.get("/api/cloud-connections");
      expect(res.status).toBe(428);
      expect(res.body.code).toBe("ORG_REQUIRED");
    });

    it("member can access provider list", async () => {
      const res = await memberAgent(orgId).get("/api/cloud-connections/providers");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("providers");
    });

    it("member cannot delete another user's connection", async () => {
      const { conn } = seedConnection(orgId);
      const res = await memberAgent(orgId).delete(`/api/cloud-connections/${conn.id}`);
      expect(res.status).toBe(404);
    });
  });

  // ─── GET /providers ─────────────────────────────────────────────────────

  describe("GET /api/cloud-connections/providers", () => {
    it("returns all providers with enabled/disabled status", async () => {
      const res = await adminAgent(orgId).get("/api/cloud-connections/providers");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("providers");
      expect(Array.isArray(res.body.providers)).toBe(true);
      expect(res.body.providers.length).toBe(5);

      // Google Drive should be enabled (mock connector registered + config has credentials)
      const gdrive = res.body.providers.find((p: { id: string }) => p.id === "google_drive");
      expect(gdrive).toBeDefined();
      expect(gdrive.name).toBe("Google Drive");
      expect(gdrive.enabled).toBe(true);

      // OneDrive should be disabled (no connector registered)
      const onedrive = res.body.providers.find((p: { id: string }) => p.id === "onedrive");
      expect(onedrive).toBeDefined();
      expect(onedrive.enabled).toBe(false);
    });
  });

  // ─── GET / (list connections) ───────────────────────────────────────────

  describe("GET /api/cloud-connections", () => {
    it("returns connections for the admin's org", async () => {
      const { conn } = seedConnection(orgId);

      const res = await adminAgent(orgId).get("/api/cloud-connections");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("connections");
      expect(Array.isArray(res.body.connections)).toBe(true);

      const found = res.body.connections.find((c: { id: string }) => c.id === conn.id);
      expect(found).toBeDefined();
      expect(found.provider).toBe("google_drive");
      expect(found.displayName).toBe("Google Drive (test@example.com)");
    });

    it("does not return connections from a different org", async () => {
      // Seed connection for a different org
      const otherOrgId = randomUUID();
      seedConnection(otherOrgId);

      const res = await adminAgent(orgId).get("/api/cloud-connections");
      expect(res.status).toBe(200);

      // Verify none of the returned connections belong to the other org
      for (const conn of res.body.connections) {
        expect(conn.orgId).toBe(orgId);
      }
    });
  });

  // ─── GET /:id (connection detail) ───────────────────────────────────────

  describe("GET /api/cloud-connections/:id", () => {
    it("returns connection detail with syncing status", async () => {
      const { conn } = seedConnection(orgId);

      const res = await adminAgent(orgId).get(`/api/cloud-connections/${conn.id}`);

      expect(res.status).toBe(200);
      expect(res.body.connection.id).toBe(conn.id);
      expect(res.body.connection.provider).toBe("google_drive");
      expect(res.body.connection.accountEmail).toBe("test@example.com");
      expect(res.body.connection.status).toBe("active");
      expect(typeof res.body.syncing).toBe("boolean");
      expect(res.body.syncing).toBe(false);
    });

    it("returns 404 for non-existent connection", async () => {
      const res = await adminAgent(orgId).get(`/api/cloud-connections/${randomUUID()}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });

    it("returns 404 when accessing another org's connection (org isolation)", async () => {
      const otherOrgId = randomUUID();
      const { conn } = seedConnection(otherOrgId);

      const res = await adminAgent(orgId).get(`/api/cloud-connections/${conn.id}`);
      expect(res.status).toBe(404);
    });
  });

  // ─── POST /oauth/authorize ──────────────────────────────────────────────

  describe("POST /api/cloud-connections/oauth/authorize", () => {
    it("generates an authorization URL for a valid provider", async () => {
      const res = await adminAgent(orgId)
        .post("/api/cloud-connections/oauth/authorize")
        .send({ provider: "google_drive" });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("authUrl");
      expect(res.body.authUrl).toContain("https://accounts.google.com");
      expect(res.body.authUrl).toContain("state=");
      expect(res.body.authUrl).toContain("redirect_uri=");
    });

    it("returns 400 for an unsupported provider", async () => {
      const res = await adminAgent(orgId)
        .post("/api/cloud-connections/oauth/authorize")
        .send({ provider: "dropbox" });

      // dropbox has no registered connector
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("not available");
    });

    it("returns 400 for an invalid provider value", async () => {
      const res = await adminAgent(orgId)
        .post("/api/cloud-connections/oauth/authorize")
        .send({ provider: "not_a_real_provider" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });

    it("returns 400 with missing body", async () => {
      const res = await adminAgent(orgId)
        .post("/api/cloud-connections/oauth/authorize")
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /oauth/callback ───────────────────────────────────────────────

  describe("GET /api/cloud-connections/oauth/callback", () => {
    it("returns 400 when code or state is missing", async () => {
      const res = await adminAgent(orgId).get("/api/cloud-connections/oauth/callback");

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Missing code or state");
    });

    it("returns 400 for invalid (non-base64url) state parameter", async () => {
      const res = await adminAgent(orgId).get(
        "/api/cloud-connections/oauth/callback?code=test-code&state=not-valid-json"
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid state");
    });

    it("returns 403 when nonce does not match session (CSRF protection)", async () => {
      // Build a valid state with a nonce that won't match the session
      const nonce = randomBytes(32).toString("hex");
      const statePayload = JSON.stringify({ provider: "google_drive", nonce });
      const state = Buffer.from(statePayload).toString("base64url");

      // The session won't have cloudOAuthNonce set, so it should fail CSRF check
      const res = await adminAgent(orgId).get(
        `/api/cloud-connections/oauth/callback?code=auth-code-123&state=${state}`
      );

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("state mismatch");
    });

    it("redirects with error query param when OAuth provider returns error", async () => {
      const res = await adminAgent(orgId).get(
        "/api/cloud-connections/oauth/callback?error=access_denied"
      );

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain("/integrations?error=access_denied");
    });
  });

  // ─── PUT /:id (update connection) ──────────────────────────────────────

  describe("PUT /api/cloud-connections/:id", () => {
    it("updates displayName", async () => {
      const { conn } = seedConnection(orgId);

      const res = await adminAgent(orgId)
        .put(`/api/cloud-connections/${conn.id}`)
        .send({ displayName: "Renamed Connection" });

      expect(res.status).toBe(200);
      expect(res.body.connection.displayName).toBe("Renamed Connection");
    });

    it("updates folder selection", async () => {
      const { conn } = seedConnection(orgId);

      const res = await adminAgent(orgId)
        .put(`/api/cloud-connections/${conn.id}`)
        .send({ folderId: "folder-abc", folderName: "Engineering Docs" });

      expect(res.status).toBe(200);
      expect(res.body.connection.folderId).toBe("folder-abc");
      expect(res.body.connection.folderName).toBe("Engineering Docs");
    });

    it("updates sync interval", async () => {
      const { conn } = seedConnection(orgId);

      const res = await adminAgent(orgId)
        .put(`/api/cloud-connections/${conn.id}`)
        .send({ syncIntervalMin: 30 });

      expect(res.status).toBe(200);
      expect(res.body.connection.syncIntervalMin).toBe(30);
    });

    it("updates status to paused", async () => {
      const { conn } = seedConnection(orgId);

      const res = await adminAgent(orgId)
        .put(`/api/cloud-connections/${conn.id}`)
        .send({ status: "paused" });

      expect(res.status).toBe(200);
      expect(res.body.connection.status).toBe("paused");
    });

    it("returns 404 for non-existent connection", async () => {
      const res = await adminAgent(orgId)
        .put(`/api/cloud-connections/${randomUUID()}`)
        .send({ displayName: "Ghost" });

      expect(res.status).toBe(404);
    });

    it("returns 404 when updating another org's connection (org isolation)", async () => {
      const otherOrgId = randomUUID();
      const { conn } = seedConnection(otherOrgId);

      const res = await adminAgent(orgId)
        .put(`/api/cloud-connections/${conn.id}`)
        .send({ displayName: "Hijacked" });

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid syncIntervalMin (below minimum)", async () => {
      const { conn } = seedConnection(orgId);

      const res = await adminAgent(orgId)
        .put(`/api/cloud-connections/${conn.id}`)
        .send({ syncIntervalMin: 2 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });

    it("returns 400 for invalid syncIntervalMin (above maximum)", async () => {
      const { conn } = seedConnection(orgId);

      const res = await adminAgent(orgId)
        .put(`/api/cloud-connections/${conn.id}`)
        .send({ syncIntervalMin: 9999 });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid status value", async () => {
      const { conn } = seedConnection(orgId);

      const res = await adminAgent(orgId)
        .put(`/api/cloud-connections/${conn.id}`)
        .send({ status: "invalid_status" });

      expect(res.status).toBe(400);
    });

    it("returns 400 for empty displayName", async () => {
      const { conn } = seedConnection(orgId);

      const res = await adminAgent(orgId)
        .put(`/api/cloud-connections/${conn.id}`)
        .send({ displayName: "" });

      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE /:id ───────────────────────────────────────────────────────

  describe("DELETE /api/cloud-connections/:id", () => {
    it("deletes a connection and returns success", async () => {
      const { conn } = seedConnection(orgId);

      const res = await adminAgent(orgId).delete(`/api/cloud-connections/${conn.id}`);

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);

      // Verify it's gone
      const check = await adminAgent(orgId).get(`/api/cloud-connections/${conn.id}`);
      expect(check.status).toBe(404);
    });

    it("returns 404 for non-existent connection", async () => {
      const res = await adminAgent(orgId).delete(`/api/cloud-connections/${randomUUID()}`);
      expect(res.status).toBe(404);
    });

    it("returns 404 when deleting another org's connection (org isolation)", async () => {
      const otherOrgId = randomUUID();
      const { conn } = seedConnection(otherOrgId);

      const res = await adminAgent(orgId).delete(`/api/cloud-connections/${conn.id}`);
      expect(res.status).toBe(404);
    });

    it("also deletes associated sync files", async () => {
      const { conn } = seedConnection(orgId);

      // Seed some sync files
      upsertSyncFile(conn.id, "ext-file-1", {
        externalName: "report.pdf",
        status: "synced",
      });
      upsertSyncFile(conn.id, "ext-file-2", {
        externalName: "notes.md",
        status: "synced",
      });

      // Verify files exist before delete
      expect(listSyncFiles(conn.id).length).toBe(2);

      await adminAgent(orgId).delete(`/api/cloud-connections/${conn.id}`);

      // Sync files should be gone
      expect(listSyncFiles(conn.id).length).toBe(0);
    });
  });

  // ─── GET /:id/folders ─────────────────────────────────────────────────

  describe("GET /api/cloud-connections/:id/folders", () => {
    it("returns folder list for a connection", async () => {
      const { conn } = seedConnection(orgId);

      const res = await adminAgent(orgId).get(`/api/cloud-connections/${conn.id}/folders`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("folders");
      expect(Array.isArray(res.body.folders)).toBe(true);
      expect(res.body.folders.length).toBe(2);
      expect(res.body.folders[0].name).toBe("Engineering Docs");
      expect(res.body.folders[1].name).toBe("HR Policies");
    });

    it("passes parentId query param to connector", async () => {
      const mockListFolders = vi.fn().mockResolvedValue([
        { id: "child-1", name: "Subfolder A", hasChildren: false },
      ]);
      registerConnector(createMockConnector({ listFolders: mockListFolders }));

      const { conn } = seedConnection(orgId);

      const res = await adminAgent(orgId).get(
        `/api/cloud-connections/${conn.id}/folders?parentId=parent-folder-xyz`
      );

      expect(res.status).toBe(200);
      expect(mockListFolders).toHaveBeenCalledWith(
        expect.any(String),
        "parent-folder-xyz"
      );

      // Restore default mock
      registerConnector(createMockConnector());
    });

    it("returns 404 for non-existent connection", async () => {
      const res = await adminAgent(orgId).get(
        `/api/cloud-connections/${randomUUID()}/folders`
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 for another org's connection (org isolation)", async () => {
      const otherOrgId = randomUUID();
      const { conn } = seedConnection(otherOrgId);

      const res = await adminAgent(orgId).get(`/api/cloud-connections/${conn.id}/folders`);
      expect(res.status).toBe(404);
    });

    it("returns 500 when connector throws", async () => {
      registerConnector(
        createMockConnector({
          listFolders: vi.fn().mockRejectedValue(new Error("Google API rate limit")),
        })
      );

      const { conn } = seedConnection(orgId);

      const res = await adminAgent(orgId).get(`/api/cloud-connections/${conn.id}/folders`);

      expect(res.status).toBe(500);
      expect(res.body.error).toContain("Failed to list folders");

      // Restore default mock
      registerConnector(createMockConnector());
    });
  });

  // ─── POST /:id/sync ──────────────────────────────────────────────────

  describe("POST /api/cloud-connections/:id/sync", () => {
    it("returns 404 for non-existent connection", async () => {
      const res = await adminAgent(orgId).post(
        `/api/cloud-connections/${randomUUID()}/sync`
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 for another org's connection (org isolation)", async () => {
      const otherOrgId = randomUUID();
      const { conn } = seedConnection(otherOrgId, { folderId: "folder-1" });

      const res = await adminAgent(orgId).post(`/api/cloud-connections/${conn.id}/sync`);
      expect(res.status).toBe(404);
    });

    it("returns 400 when no folder is configured", async () => {
      // Seed connection without a folderId
      const { conn } = seedConnection(orgId);

      const res = await adminAgent(orgId).post(`/api/cloud-connections/${conn.id}/sync`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("No folder configured");
    });
  });

  // ─── GET /:id/files ──────────────────────────────────────────────────

  describe("GET /api/cloud-connections/:id/files", () => {
    it("returns empty array for connection with no sync files", async () => {
      const { conn } = seedConnection(orgId);

      const res = await adminAgent(orgId).get(`/api/cloud-connections/${conn.id}/files`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("files");
      expect(res.body.files).toEqual([]);
    });

    it("returns sync files for a connection", async () => {
      const { conn } = seedConnection(orgId);

      // Seed sync files
      upsertSyncFile(conn.id, "gdrive-file-001", {
        externalName: "Q4-Budget.pdf",
        externalModified: "2026-03-01T10:00:00.000Z",
        status: "synced",
      });
      upsertSyncFile(conn.id, "gdrive-file-002", {
        externalName: "Meeting-Notes.docx",
        externalModified: "2026-03-15T14:30:00.000Z",
        status: "pending",
      });

      const res = await adminAgent(orgId).get(`/api/cloud-connections/${conn.id}/files`);

      expect(res.status).toBe(200);
      expect(res.body.files.length).toBe(2);

      const fileNames = res.body.files.map((f: { externalName: string }) => f.externalName);
      expect(fileNames).toContain("Q4-Budget.pdf");
      expect(fileNames).toContain("Meeting-Notes.docx");
    });

    it("returns 404 for non-existent connection", async () => {
      const res = await adminAgent(orgId).get(
        `/api/cloud-connections/${randomUUID()}/files`
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 for another org's connection (org isolation)", async () => {
      const otherOrgId = randomUUID();
      const { conn } = seedConnection(otherOrgId);

      const res = await adminAgent(orgId).get(`/api/cloud-connections/${conn.id}/files`);
      expect(res.status).toBe(404);
    });
  });

  // ─── Org isolation (comprehensive) ────────────────────────────────────

  describe("Org isolation", () => {
    let otherOrgId: string;
    let otherConnId: string;

    beforeAll(() => {
      otherOrgId = randomUUID();
      const { conn } = seedConnection(otherOrgId, { folderId: "folder-1" });
      otherConnId = conn.id;
    });

    it("GET /:id returns 404 for cross-org access", async () => {
      const res = await adminAgent(orgId).get(`/api/cloud-connections/${otherConnId}`);
      expect(res.status).toBe(404);
    });

    it("PUT /:id returns 404 for cross-org access", async () => {
      const res = await adminAgent(orgId)
        .put(`/api/cloud-connections/${otherConnId}`)
        .send({ displayName: "Stolen" });
      expect(res.status).toBe(404);
    });

    it("DELETE /:id returns 404 for cross-org access", async () => {
      const res = await adminAgent(orgId).delete(`/api/cloud-connections/${otherConnId}`);
      expect(res.status).toBe(404);
    });

    it("GET /:id/folders returns 404 for cross-org access", async () => {
      const res = await adminAgent(orgId).get(
        `/api/cloud-connections/${otherConnId}/folders`
      );
      expect(res.status).toBe(404);
    });

    it("POST /:id/sync returns 404 for cross-org access", async () => {
      const res = await adminAgent(orgId).post(
        `/api/cloud-connections/${otherConnId}/sync`
      );
      expect(res.status).toBe(404);
    });

    it("GET /:id/files returns 404 for cross-org access", async () => {
      const res = await adminAgent(orgId).get(
        `/api/cloud-connections/${otherConnId}/files`
      );
      expect(res.status).toBe(404);
    });
  });

  // ─── Multiple connections ─────────────────────────────────────────────

  describe("Multiple connections per org", () => {
    it("can create and list multiple connections independently", async () => {
      // Seed two connections for the same org
      const { conn: conn1 } = seedConnection(orgId);
      const { conn: conn2 } = seedConnection(orgId);

      // Both should appear in the list
      const res = await adminAgent(orgId).get("/api/cloud-connections");
      expect(res.status).toBe(200);

      const ids = res.body.connections.map((c: { id: string }) => c.id);
      expect(ids).toContain(conn1.id);
      expect(ids).toContain(conn2.id);

      // Deleting one should not affect the other
      await adminAgent(orgId).delete(`/api/cloud-connections/${conn1.id}`);

      const res2 = await adminAgent(orgId).get("/api/cloud-connections");
      const ids2 = res2.body.connections.map((c: { id: string }) => c.id);
      expect(ids2).not.toContain(conn1.id);
      expect(ids2).toContain(conn2.id);
    });
  });

  // ─── Connection with sync file counts ─────────────────────────────────

  describe("Sync file counts", () => {
    it("connection detail includes syncedFileCount", async () => {
      const { conn } = seedConnection(orgId);

      // Initially 0
      const res1 = await adminAgent(orgId).get(`/api/cloud-connections/${conn.id}`);
      expect(res1.body.connection.syncedFileCount).toBe(0);

      // Add some synced files
      upsertSyncFile(conn.id, "ext-a", { externalName: "a.pdf", status: "synced" });
      upsertSyncFile(conn.id, "ext-b", { externalName: "b.pdf", status: "synced" });
      upsertSyncFile(conn.id, "ext-c", { externalName: "c.pdf", status: "error" }); // not counted

      const res2 = await adminAgent(orgId).get(`/api/cloud-connections/${conn.id}`);
      expect(res2.body.connection.syncedFileCount).toBe(2);
    });
  });
});
