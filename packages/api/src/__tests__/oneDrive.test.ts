/**
 * Unit tests for the OneDrive connector (packages/api/src/connectors/oneDrive.ts).
 *
 * These test the connector adapter directly (not via HTTP routes).
 * All fetch() calls to Microsoft Graph API are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock config before any connector import ─────────────────────────────────

vi.mock("../config.js", () => ({
  config: {
    cloud: {
      onedrive: {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
      },
    },
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock registerConnector so importing the module doesn't require the full registry
vi.mock("../connectors/registry.js", () => ({
  registerConnector: vi.fn(),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { oneDriveAdapter } from "../connectors/oneDrive.js";

// ─── Fetch mock helpers ─────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

function binaryResponse(data: Uint8Array, mimeType: string, status = 200): Response {
  return new Response(data, {
    status,
    headers: { "Content-Type": mimeType },
  });
}

beforeEach(() => {
  mockFetch = vi.fn();
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("OneDrive connector", () => {
  // ─── getAuthUrl ──────────────────────────────────────────────────────────

  describe("getAuthUrl", () => {
    it("generates correct Microsoft OAuth URL with required params", () => {
      const url = oneDriveAdapter.getAuthUrl("state-abc", "http://localhost:3000/callback");
      const parsed = new URL(url);

      expect(parsed.origin).toBe("https://login.microsoftonline.com");
      expect(parsed.pathname).toBe("/common/oauth2/v2.0/authorize");
      expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
      expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:3000/callback");
      expect(parsed.searchParams.get("response_type")).toBe("code");
      expect(parsed.searchParams.get("scope")).toBe("Files.Read.All offline_access User.Read");
      expect(parsed.searchParams.get("state")).toBe("state-abc");
      expect(parsed.searchParams.get("prompt")).toBe("consent");
    });
  });

  // ─── exchangeCode ───────────────────────────────────────────────────────

  describe("exchangeCode", () => {
    it("exchanges code for tokens and fetches user info", async () => {
      // First call: token exchange
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
          scope: "Files.Read.All offline_access User.Read",
        }),
      );
      // Second call: /me for user info
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          mail: "user@contoso.com",
          userPrincipalName: "user@contoso.onmicrosoft.com",
        }),
      );

      const tokens = await oneDriveAdapter.exchangeCode("auth-code-123", "http://localhost:3000/callback");

      expect(tokens.accessToken).toBe("new-access-token");
      expect(tokens.refreshToken).toBe("new-refresh-token");
      expect(tokens.expiresAt).toBeDefined();
      expect(tokens.accountEmail).toBe("user@contoso.com");
      expect(tokens.scopes).toBe("Files.Read.All offline_access User.Read");

      // Verify token exchange request
      const [tokenUrl, tokenOpts] = mockFetch.mock.calls[0];
      expect(tokenUrl).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
      expect(tokenOpts.method).toBe("POST");
      const body = new URLSearchParams(tokenOpts.body);
      expect(body.get("code")).toBe("auth-code-123");
      expect(body.get("client_id")).toBe("test-client-id");
      expect(body.get("client_secret")).toBe("test-client-secret");
      expect(body.get("redirect_uri")).toBe("http://localhost:3000/callback");
      expect(body.get("grant_type")).toBe("authorization_code");

      // Verify /me request
      const [meUrl, meOpts] = mockFetch.mock.calls[1];
      expect(meUrl).toBe("https://graph.microsoft.com/v1.0/me");
      expect(meOpts.headers.Authorization).toBe("Bearer new-access-token");
    });

    it("falls back to userPrincipalName when mail is absent", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ access_token: "tok", refresh_token: "ref", expires_in: 3600 }),
      );
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ userPrincipalName: "admin@contoso.onmicrosoft.com" }),
      );

      const tokens = await oneDriveAdapter.exchangeCode("code", "http://localhost:3000/cb");
      expect(tokens.accountEmail).toBe("admin@contoso.onmicrosoft.com");
    });

    it("handles token exchange failure", async () => {
      mockFetch.mockResolvedValueOnce(textResponse("invalid_grant", 400));

      await expect(
        oneDriveAdapter.exchangeCode("bad-code", "http://localhost:3000/callback"),
      ).rejects.toThrow("OneDrive token exchange failed (400): invalid_grant");
    });

    it("succeeds even if user info fetch fails", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ access_token: "tok", refresh_token: "ref", expires_in: 3600 }),
      );
      // /me call throws
      mockFetch.mockRejectedValueOnce(new Error("network error"));

      const tokens = await oneDriveAdapter.exchangeCode("code", "http://localhost:3000/cb");
      expect(tokens.accessToken).toBe("tok");
      expect(tokens.accountEmail).toBeUndefined();
    });
  });

  // ─── refreshAccessToken ─────────────────────────────────────────────────

  describe("refreshAccessToken", () => {
    it("refreshes with correct params and returns new token + expiry", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ access_token: "refreshed-token", expires_in: 7200 }),
      );

      const result = await oneDriveAdapter.refreshAccessToken("old-refresh-token");

      expect(result.accessToken).toBe("refreshed-token");
      expect(result.expiresAt).toBeDefined();
      // Verify expiry is roughly 2 hours from now
      const expiresAt = new Date(result.expiresAt!).getTime();
      const twoHoursFromNow = Date.now() + 7200 * 1000;
      expect(Math.abs(expiresAt - twoHoursFromNow)).toBeLessThan(5000);

      // Verify the request body
      const [, opts] = mockFetch.mock.calls[0];
      const body = new URLSearchParams(opts.body);
      expect(body.get("refresh_token")).toBe("old-refresh-token");
      expect(body.get("client_id")).toBe("test-client-id");
      expect(body.get("client_secret")).toBe("test-client-secret");
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("scope")).toBe("Files.Read.All offline_access User.Read");
    });

    it("returns token without expiresAt when expires_in is absent", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ access_token: "refreshed-token" }),
      );

      const result = await oneDriveAdapter.refreshAccessToken("old-refresh-token");
      expect(result.accessToken).toBe("refreshed-token");
      expect(result.expiresAt).toBeUndefined();
    });

    it("handles refresh failure", async () => {
      mockFetch.mockResolvedValueOnce(textResponse("invalid_grant", 401));

      await expect(
        oneDriveAdapter.refreshAccessToken("expired-refresh-token"),
      ).rejects.toThrow("OneDrive token refresh failed (401): invalid_grant");
    });
  });

  // ─── listFolders ────────────────────────────────────────────────────────

  describe("listFolders", () => {
    it("calls root children endpoint and maps response correctly", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            { id: "folder-1", name: "Documents", folder: { childCount: 5 } },
            { id: "folder-2", name: "Empty Folder", folder: { childCount: 0 } },
          ],
        }),
      );

      const folders = await oneDriveAdapter.listFolders("access-tok");

      expect(folders).toEqual([
        { id: "folder-1", name: "Documents", hasChildren: true },
        { id: "folder-2", name: "Empty Folder", hasChildren: false },
      ]);

      // Verify it used the root endpoint
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("me/drive/root/children");
      // URLSearchParams encodes $ as %24
      expect(url).toContain("%24filter=folder+ne+null");
    });

    it("passes parentId when provided", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ value: [] }));

      await oneDriveAdapter.listFolders("access-tok", "parent-id-123");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("me/drive/items/parent-id-123/children");
      expect(url).not.toContain("root/children");
    });

    it("handles API error", async () => {
      mockFetch.mockResolvedValueOnce(textResponse("Unauthorized", 401));

      await expect(
        oneDriveAdapter.listFolders("bad-token"),
      ).rejects.toThrow("OneDrive listFolders failed (401): Unauthorized");
    });
  });

  // ─── getChanges — initial sync (null cursor) ───────────────────────────

  describe("getChanges — initial sync (null cursor)", () => {
    it("lists all supported files and returns delta link as cursor", async () => {
      // First call: children listing
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: "file-1",
              name: "report.pdf",
              file: { mimeType: "application/pdf" },
              lastModifiedDateTime: "2026-03-01T10:00:00Z",
              size: 1024,
            },
            {
              id: "file-2",
              name: "notes.txt",
              file: { mimeType: "text/plain" },
              lastModifiedDateTime: "2026-03-02T10:00:00Z",
              size: 256,
            },
            {
              // Folder — should be skipped (no file property)
              id: "folder-1",
              name: "Subfolder",
              lastModifiedDateTime: "2026-03-01T10:00:00Z",
            },
            {
              // Unsupported file type
              id: "file-3",
              name: "image.png",
              file: { mimeType: "image/png" },
              lastModifiedDateTime: "2026-03-01T10:00:00Z",
              size: 5000,
            },
          ],
          // No nextLink means single page
        }),
      );

      // Second call: delta endpoint for getting the delta link
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/drive/items/folder-123/delta?token=abc",
          value: [],
        }),
      );

      const result = await oneDriveAdapter.getChanges("access-tok", "folder-123", null);

      expect(result.changes).toHaveLength(2);
      expect(result.changes[0]).toEqual({
        type: "added",
        file: {
          id: "file-1",
          name: "report.pdf",
          mimeType: "application/pdf",
          modifiedAt: "2026-03-01T10:00:00Z",
          size: 1024,
        },
      });
      expect(result.changes[1]).toEqual({
        type: "added",
        file: {
          id: "file-2",
          name: "notes.txt",
          mimeType: "text/plain",
          modifiedAt: "2026-03-02T10:00:00Z",
          size: 256,
        },
      });
      expect(result.newCursor).toBe(
        "https://graph.microsoft.com/v1.0/me/drive/items/folder-123/delta?token=abc",
      );
    });

    it("filters to supported file types only (uses extension fallback)", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              // No mimeType but has .docx extension — should be included
              id: "file-docx",
              name: "contract.docx",
              file: {},
              lastModifiedDateTime: "2026-03-01T10:00:00Z",
              size: 2048,
            },
            {
              // .md extension — should be included
              id: "file-md",
              name: "README.md",
              file: { mimeType: "" },
              lastModifiedDateTime: "2026-03-01T10:00:00Z",
            },
            {
              // .xlsx — not supported
              id: "file-xlsx",
              name: "budget.xlsx",
              file: { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
              lastModifiedDateTime: "2026-03-01T10:00:00Z",
            },
          ],
        }),
      );

      // Delta link call
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?token=xyz",
          value: [],
        }),
      );

      const result = await oneDriveAdapter.getChanges("access-tok", "folder-1", null);

      expect(result.changes).toHaveLength(2);
      expect(result.changes.map((c) => c.file.name)).toEqual(["contract.docx", "README.md"]);
    });

    it("paginates through multiple pages of children", async () => {
      // Page 1
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/drive/items/folder-1/children?skip=1",
          value: [
            {
              id: "file-1",
              name: "page1.pdf",
              file: { mimeType: "application/pdf" },
              lastModifiedDateTime: "2026-03-01T10:00:00Z",
              size: 100,
            },
          ],
        }),
      );

      // Page 2
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: "file-2",
              name: "page2.txt",
              file: { mimeType: "text/plain" },
              lastModifiedDateTime: "2026-03-02T10:00:00Z",
              size: 200,
            },
          ],
        }),
      );

      // Delta link call
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?token=page",
          value: [],
        }),
      );

      const result = await oneDriveAdapter.getChanges("access-tok", "folder-1", null);

      expect(result.changes).toHaveLength(2);
      // Verify the second call used the nextLink
      expect(mockFetch.mock.calls[1][0]).toBe(
        "https://graph.microsoft.com/v1.0/me/drive/items/folder-1/children?skip=1",
      );
    });
  });

  // ─── getChanges — delta sync (with cursor) ─────────────────────────────

  describe("getChanges — delta sync (with cursor)", () => {
    it("uses delta link, handles additions/modifications/deletions", async () => {
      const deltaUrl = "https://graph.microsoft.com/v1.0/delta?token=prev-cursor";

      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?token=new-cursor",
          value: [
            {
              // Modified file in target folder
              id: "file-1",
              name: "updated.pdf",
              file: { mimeType: "application/pdf" },
              lastModifiedDateTime: "2026-03-15T10:00:00Z",
              size: 2048,
              parentReference: { id: "target-folder" },
            },
            {
              // Deleted file
              id: "file-2",
              name: "removed.txt",
              deleted: { state: "deleted" },
              lastModifiedDateTime: "2026-03-15T11:00:00Z",
            },
            {
              // File in a different folder — should be excluded
              id: "file-3",
              name: "other.pdf",
              file: { mimeType: "application/pdf" },
              lastModifiedDateTime: "2026-03-15T10:00:00Z",
              parentReference: { id: "different-folder" },
            },
          ],
        }),
      );

      const result = await oneDriveAdapter.getChanges("access-tok", "target-folder", deltaUrl);

      expect(result.changes).toHaveLength(2);
      expect(result.changes[0]).toEqual({
        type: "modified",
        file: {
          id: "file-1",
          name: "updated.pdf",
          mimeType: "application/pdf",
          modifiedAt: "2026-03-15T10:00:00Z",
          size: 2048,
        },
      });
      expect(result.changes[1]).toEqual({
        type: "deleted",
        file: {
          id: "file-2",
          name: "removed.txt",
          mimeType: "",
          modifiedAt: "2026-03-15T11:00:00Z",
        },
      });
      expect(result.newCursor).toBe("https://graph.microsoft.com/v1.0/delta?token=new-cursor");

      // Verify it called the delta URL
      expect(mockFetch.mock.calls[0][0]).toBe(deltaUrl);
    });

    it("handles 410 expired delta link by falling back to full sync", async () => {
      const expiredDeltaUrl = "https://graph.microsoft.com/v1.0/delta?token=expired";

      // First call: 410 Gone
      mockFetch.mockResolvedValueOnce(textResponse("Gone", 410));

      // Now it falls back to initialSync:
      // Children listing
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: "file-1",
              name: "doc.pdf",
              file: { mimeType: "application/pdf" },
              lastModifiedDateTime: "2026-03-01T10:00:00Z",
              size: 500,
            },
          ],
        }),
      );

      // Delta link request
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?token=fresh",
          value: [],
        }),
      );

      const result = await oneDriveAdapter.getChanges("access-tok", "folder-1", expiredDeltaUrl);

      // Should have done a full sync
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].type).toBe("added"); // Initial sync uses "added"
      expect(result.newCursor).toBe("https://graph.microsoft.com/v1.0/delta?token=fresh");
    });

    it("filters unsupported file types in delta results", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?token=next",
          value: [
            {
              id: "file-good",
              name: "report.docx",
              file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
              lastModifiedDateTime: "2026-03-15T10:00:00Z",
              parentReference: { id: "folder-1" },
            },
            {
              // Unsupported type
              id: "file-bad",
              name: "video.mp4",
              file: { mimeType: "video/mp4" },
              lastModifiedDateTime: "2026-03-15T10:00:00Z",
              parentReference: { id: "folder-1" },
            },
          ],
        }),
      );

      const result = await oneDriveAdapter.getChanges("access-tok", "folder-1", "https://delta-link");

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].file.name).toBe("report.docx");
    });

    it("paginates through delta results", async () => {
      // Page 1 with nextLink
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/delta?token=page2",
          value: [
            {
              id: "file-1",
              name: "first.pdf",
              file: { mimeType: "application/pdf" },
              lastModifiedDateTime: "2026-03-15T10:00:00Z",
              parentReference: { id: "folder-1" },
            },
          ],
        }),
      );

      // Page 2 with deltaLink (final page)
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?token=final",
          value: [
            {
              id: "file-2",
              name: "second.txt",
              file: { mimeType: "text/plain" },
              lastModifiedDateTime: "2026-03-15T11:00:00Z",
              parentReference: { id: "folder-1" },
            },
          ],
        }),
      );

      const result = await oneDriveAdapter.getChanges("access-tok", "folder-1", "https://delta-link");

      expect(result.changes).toHaveLength(2);
      expect(result.newCursor).toBe("https://graph.microsoft.com/v1.0/delta?token=final");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ─── downloadFile ───────────────────────────────────────────────────────

  describe("downloadFile", () => {
    it("fetches metadata then content, returns buffer", async () => {
      const fileContent = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF header

      // Metadata call
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          name: "report.pdf",
          file: { mimeType: "application/pdf" },
        }),
      );

      // Content download
      mockFetch.mockResolvedValueOnce(binaryResponse(fileContent, "application/pdf"));

      const result = await oneDriveAdapter.downloadFile("access-tok", "file-id-123");

      expect(result.name).toBe("report.pdf");
      expect(result.mimeType).toBe("application/pdf");
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
      expect(result.buffer).toEqual(Buffer.from(fileContent));

      // Verify metadata URL
      const [metaUrl] = mockFetch.mock.calls[0];
      expect(metaUrl).toContain("me/drive/items/file-id-123");
      expect(metaUrl).toContain("$select=name,file");

      // Verify content URL
      const [contentUrl, contentOpts] = mockFetch.mock.calls[1];
      expect(contentUrl).toContain("me/drive/items/file-id-123/content");
      expect(contentOpts.redirect).toBe("follow");
    });

    it("defaults mimeType to application/octet-stream when file.mimeType is absent", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ name: "data.bin", file: {} }),
      );
      mockFetch.mockResolvedValueOnce(
        binaryResponse(new Uint8Array([1, 2, 3]), "application/octet-stream"),
      );

      const result = await oneDriveAdapter.downloadFile("access-tok", "file-id");
      expect(result.mimeType).toBe("application/octet-stream");
    });

    it("handles metadata fetch failure", async () => {
      mockFetch.mockResolvedValueOnce(textResponse("Not Found", 404));

      await expect(
        oneDriveAdapter.downloadFile("access-tok", "bad-file-id"),
      ).rejects.toThrow("OneDrive file metadata failed (404)");
    });

    it("handles content download failure", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ name: "report.pdf", file: { mimeType: "application/pdf" } }),
      );
      mockFetch.mockResolvedValueOnce(textResponse("Internal Server Error", 500));

      await expect(
        oneDriveAdapter.downloadFile("access-tok", "file-id"),
      ).rejects.toThrow("OneDrive download failed (500): report.pdf");
    });
  });

  // ─── isSupportedFile (tested via getChanges filtering) ──────────────────

  describe("isSupportedFile (via getChanges filtering)", () => {
    // Helper: run an initial sync with a single file and return whether it was included
    async function isFileIncluded(
      name: string,
      mimeType: string | undefined,
    ): Promise<boolean> {
      mockFetch.mockReset();

      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: "test-file",
              name,
              file: mimeType !== undefined ? { mimeType } : {},
              lastModifiedDateTime: "2026-03-01T10:00:00Z",
              size: 100,
            },
          ],
        }),
      );

      // Delta link call
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          "@odata.deltaLink": "https://delta",
          value: [],
        }),
      );

      const result = await oneDriveAdapter.getChanges("tok", "folder", null);
      return result.changes.length > 0;
    }

    it("includes files with supported MIME types", async () => {
      expect(await isFileIncluded("doc.pdf", "application/pdf")).toBe(true);
      expect(await isFileIncluded("doc.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
      expect(await isFileIncluded("notes.txt", "text/plain")).toBe(true);
      expect(await isFileIncluded("readme.md", "text/markdown")).toBe(true);
    });

    it("excludes files with unsupported MIME types and extensions", async () => {
      expect(await isFileIncluded("image.png", "image/png")).toBe(false);
      expect(await isFileIncluded("video.mp4", "video/mp4")).toBe(false);
      expect(await isFileIncluded("sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(false);
    });

    it("falls back to extension when MIME type is empty or missing", async () => {
      expect(await isFileIncluded("report.pdf", "")).toBe(true);
      expect(await isFileIncluded("contract.docx", "")).toBe(true);
      expect(await isFileIncluded("notes.txt", "")).toBe(true);
      expect(await isFileIncluded("readme.md", "")).toBe(true);
      expect(await isFileIncluded("report.pdf", undefined)).toBe(true);
    });

    it("excludes files with no MIME type and unsupported extension", async () => {
      expect(await isFileIncluded("image.png", "")).toBe(false);
      expect(await isFileIncluded("archive.zip", "")).toBe(false);
      expect(await isFileIncluded("no-extension", "")).toBe(false);
    });
  });
});
