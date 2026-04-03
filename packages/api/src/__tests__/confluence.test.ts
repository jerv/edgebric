/**
 * Unit tests for the Confluence connector (packages/api/src/connectors/confluence.ts).
 *
 * These test the connector adapter directly (not via HTTP routes).
 * All fetch() calls to Atlassian APIs are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock config before any connector import ─────────────────────────────────

vi.mock("../config.js", () => ({
  config: {
    cloud: {
      confluence: {
        clientId: "test-confluence-client-id",
        clientSecret: "test-confluence-client-secret",
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

// Mock integrationConfigStore — returns empty config by default
vi.mock("../services/integrationConfigStore.js", () => ({
  getIntegrationConfig: vi.fn(() => ({})),
}));

// Mock registerConnector so importing the module doesn't require the full registry
vi.mock("../connectors/registry.js", () => ({
  registerConnector: vi.fn(),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import {
  confluenceAdapter,
  getConfluenceCredentials,
  storageToMarkdown,
  formatCqlDate,
} from "../connectors/confluence.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";

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

describe("Confluence connector", () => {
  // ─── getAuthUrl ──────────────────────────────────────────────────────────

  describe("getAuthUrl", () => {
    it("generates correct Atlassian OAuth URL with required params", () => {
      const url = confluenceAdapter.getAuthUrl("state-abc", "http://localhost:3000/callback");
      const parsed = new URL(url);

      expect(parsed.origin).toBe("https://auth.atlassian.com");
      expect(parsed.pathname).toBe("/authorize");
      expect(parsed.searchParams.get("audience")).toBe("api.atlassian.com");
      expect(parsed.searchParams.get("client_id")).toBe("test-confluence-client-id");
      expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:3000/callback");
      expect(parsed.searchParams.get("response_type")).toBe("code");
      expect(parsed.searchParams.get("scope")).toBe(
        "read:confluence-content.all read:confluence-space.summary offline_access read:me",
      );
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
          scope: "read:confluence-content.all offline_access",
        }),
      );
      // Second call: /me for user info
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ email: "user@example.com" }),
      );

      const tokens = await confluenceAdapter.exchangeCode("auth-code-123", "http://localhost:3000/callback");

      expect(tokens.accessToken).toBe("new-access-token");
      expect(tokens.refreshToken).toBe("new-refresh-token");
      expect(tokens.expiresAt).toBeDefined();
      expect(tokens.accountEmail).toBe("user@example.com");

      // Verify token exchange request
      const [tokenUrl, tokenOpts] = mockFetch.mock.calls[0]!;
      expect(tokenUrl).toBe("https://auth.atlassian.com/oauth/token");
      expect(tokenOpts.method).toBe("POST");
      const body = JSON.parse(tokenOpts.body);
      expect(body.code).toBe("auth-code-123");
      expect(body.client_id).toBe("test-confluence-client-id");
      expect(body.client_secret).toBe("test-confluence-client-secret");
      expect(body.redirect_uri).toBe("http://localhost:3000/callback");
      expect(body.grant_type).toBe("authorization_code");

      // Verify /me request
      const [meUrl, meOpts] = mockFetch.mock.calls[1]!;
      expect(meUrl).toBe("https://api.atlassian.com/me");
      expect(meOpts.headers.Authorization).toBe("Bearer new-access-token");
    });

    it("handles token exchange failure", async () => {
      mockFetch.mockResolvedValueOnce(textResponse("invalid_grant", 400));

      await expect(
        confluenceAdapter.exchangeCode("bad-code", "http://localhost:3000/callback"),
      ).rejects.toThrow("Confluence token exchange failed (400): invalid_grant");
    });

    it("succeeds even if user info fetch fails", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ access_token: "tok", refresh_token: "ref", expires_in: 3600 }),
      );
      mockFetch.mockRejectedValueOnce(new Error("network error"));

      const tokens = await confluenceAdapter.exchangeCode("code", "http://localhost:3000/cb");
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

      const result = await confluenceAdapter.refreshAccessToken("old-refresh-token");

      expect(result.accessToken).toBe("refreshed-token");
      expect(result.expiresAt).toBeDefined();
      const expiresAt = new Date(result.expiresAt!).getTime();
      const twoHoursFromNow = Date.now() + 7200 * 1000;
      expect(Math.abs(expiresAt - twoHoursFromNow)).toBeLessThan(5000);

      // Verify request body (JSON, not URL-encoded)
      const [, opts] = mockFetch.mock.calls[0]!;
      const body = JSON.parse(opts.body);
      expect(body.refresh_token).toBe("old-refresh-token");
      expect(body.client_id).toBe("test-confluence-client-id");
      expect(body.client_secret).toBe("test-confluence-client-secret");
      expect(body.grant_type).toBe("refresh_token");
    });

    it("returns token without expiresAt when expires_in is absent", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ access_token: "refreshed-token" }),
      );

      const result = await confluenceAdapter.refreshAccessToken("old-refresh-token");
      expect(result.accessToken).toBe("refreshed-token");
      expect(result.expiresAt).toBeUndefined();
    });

    it("handles refresh failure", async () => {
      mockFetch.mockResolvedValueOnce(textResponse("invalid_grant", 401));

      await expect(
        confluenceAdapter.refreshAccessToken("expired-refresh-token"),
      ).rejects.toThrow("Confluence token refresh failed (401): invalid_grant");
    });
  });

  // ─── listFolders (spaces) ──────────────────────────────────────────────

  describe("listFolders", () => {
    it("lists Confluence spaces and returns composite IDs", async () => {
      // First call: accessible-resources
      mockFetch.mockResolvedValueOnce(
        jsonResponse([
          { id: "cloud-123", name: "My Site", url: "https://mysite.atlassian.net" },
        ]),
      );

      // Second call: list spaces
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            { id: "1", key: "ENG", name: "Engineering" },
            { id: "2", key: "HR", name: "Human Resources" },
          ],
          _links: {},
        }),
      );

      const folders = await confluenceAdapter.listFolders("access-tok");

      expect(folders).toEqual([
        { id: "cloud-123::ENG", name: "Engineering", hasChildren: false },
        { id: "cloud-123::HR", name: "Human Resources", hasChildren: false },
      ]);

      // Verify accessible-resources call
      expect(mockFetch.mock.calls[0]![0]).toBe(
        "https://api.atlassian.com/oauth/token/accessible-resources",
      );

      // Verify spaces call
      const spacesUrl = mockFetch.mock.calls[1]![0] as string;
      expect(spacesUrl).toContain("/ex/confluence/cloud-123/wiki/api/v2/spaces");
    });

    it("paginates through multiple pages of spaces", async () => {
      // accessible-resources
      mockFetch.mockResolvedValueOnce(
        jsonResponse([{ id: "cloud-1", name: "Site", url: "https://site.atlassian.net" }]),
      );

      // Page 1
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: "1", key: "DEV", name: "Dev" }],
          _links: { next: "/wiki/api/v2/spaces?cursor=abc" },
        }),
      );

      // Page 2
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: "2", key: "OPS", name: "Ops" }],
          _links: {},
        }),
      );

      const folders = await confluenceAdapter.listFolders("access-tok");

      expect(folders).toHaveLength(2);
      expect(folders[0]!.name).toBe("Dev");
      expect(folders[1]!.name).toBe("Ops");
    });

    it("handles no accessible sites", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      await expect(
        confluenceAdapter.listFolders("access-tok"),
      ).rejects.toThrow("No accessible Confluence sites found");
    });

    it("handles spaces API error", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse([{ id: "cloud-1", name: "Site", url: "https://site.atlassian.net" }]),
      );
      mockFetch.mockResolvedValueOnce(textResponse("Unauthorized", 401));

      await expect(
        confluenceAdapter.listFolders("bad-token"),
      ).rejects.toThrow("Confluence listSpaces failed (401)");
    });
  });

  // ─── getChanges — initial sync (null cursor) ───────────────────────────

  describe("getChanges — initial sync (null cursor)", () => {
    it("lists all pages in the space and returns them as markdown files", async () => {
      // CQL search for pages
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: "page-1",
              title: "Getting Started",
              type: "page",
              version: { when: "2026-03-01T10:00:00Z" },
            },
            {
              id: "page-2",
              title: "API Reference",
              type: "page",
              version: { when: "2026-03-02T10:00:00Z" },
            },
          ],
          size: 2,
          _links: {},
        }),
      );

      // Attachments for page-1
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: "att-1",
              title: "guide.pdf",
              extensions: { mediaType: "application/pdf", fileSize: 1024 },
              version: { when: "2026-03-01T10:00:00Z" },
              _links: { download: "/download/attachments/page-1/guide.pdf" },
            },
            {
              // Unsupported type — should be skipped
              id: "att-2",
              title: "logo.png",
              extensions: { mediaType: "image/png", fileSize: 500 },
              version: { when: "2026-03-01T10:00:00Z" },
              _links: { download: "/download/attachments/page-1/logo.png" },
            },
          ],
        }),
      );

      // Attachments for page-2 (none)
      mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));

      const result = await confluenceAdapter.getChanges("access-tok", "cloud-123::ENG", null);

      // 2 pages + 1 supported attachment = 3 changes
      expect(result.changes).toHaveLength(3);

      // Page changes
      expect(result.changes[0]).toEqual({
        type: "added",
        file: {
          id: "cloud-123::page:page-1",
          name: "Getting Started.md",
          mimeType: "text/markdown",
          modifiedAt: "2026-03-01T10:00:00Z",
        },
      });
      expect(result.changes[1]).toEqual({
        type: "added",
        file: {
          id: "cloud-123::page:page-2",
          name: "API Reference.md",
          mimeType: "text/markdown",
          modifiedAt: "2026-03-02T10:00:00Z",
        },
      });

      // Attachment change
      expect(result.changes[2]!.file.name).toBe("guide.pdf");
      expect(result.changes[2]!.file.mimeType).toBe("application/pdf");
      expect(result.changes[2]!.file.id).toContain("cloud-123::attachment:");

      // Cursor should be an ISO timestamp
      expect(result.newCursor).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("paginates through CQL search results", async () => {
      // Page 1
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            { id: "page-1", title: "Page 1", type: "page", version: { when: "2026-03-01T10:00:00Z" } },
          ],
          size: 1,
          _links: { next: "/wiki/rest/api/content/search?cql=...&start=1" },
        }),
      );
      // Attachments for page-1
      mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));

      // Page 2
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            { id: "page-2", title: "Page 2", type: "page", version: { when: "2026-03-02T10:00:00Z" } },
          ],
          size: 1,
          _links: {},
        }),
      );
      // Attachments for page-2
      mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));

      const result = await confluenceAdapter.getChanges("access-tok", "cloud-123::ENG", null);

      expect(result.changes).toHaveLength(2);
      expect(result.changes[0]!.file.name).toBe("Page 1.md");
      expect(result.changes[1]!.file.name).toBe("Page 2.md");
    });

    it("handles empty space (no pages)", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ results: [], size: 0, _links: {} }),
      );

      const result = await confluenceAdapter.getChanges("access-tok", "cloud-123::EMPTY", null);

      expect(result.changes).toHaveLength(0);
      expect(result.newCursor).toBeDefined();
    });
  });

  // ─── getChanges — delta sync (with cursor) ─────────────────────────────

  describe("getChanges — delta sync (with cursor)", () => {
    it("uses CQL with lastModified filter for delta sync", async () => {
      const cursor = "2026-03-01T10:00:00.000Z";

      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            { id: "page-5", title: "Updated Page", type: "page", version: { when: "2026-03-15T10:00:00Z" } },
          ],
          size: 1,
          _links: {},
        }),
      );
      // Attachments for page-5
      mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));

      const result = await confluenceAdapter.getChanges("access-tok", "cloud-123::ENG", cursor);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toEqual({
        type: "modified",
        file: {
          id: "cloud-123::page:page-5",
          name: "Updated Page.md",
          mimeType: "text/markdown",
          modifiedAt: "2026-03-15T10:00:00Z",
        },
      });

      // Verify CQL includes lastModified filter
      const cqlUrl = mockFetch.mock.calls[0]![0] as string;
      expect(cqlUrl).toContain("lastModified");
      expect(cqlUrl).toContain("2026-03-01");

      // New cursor should be updated
      expect(result.newCursor).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ─── downloadFile — pages ──────────────────────────────────────────────

  describe("downloadFile — pages", () => {
    it("downloads a Confluence page as markdown", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: "page-1",
          title: "My Page",
          body: {
            storage: {
              value: "<h1>Hello</h1><p>World <strong>bold</strong></p>",
            },
          },
          version: { when: "2026-03-01T10:00:00Z" },
        }),
      );

      const result = await confluenceAdapter.downloadFile("access-tok", "cloud-123::page:page-1");

      expect(result.name).toBe("My Page.md");
      expect(result.mimeType).toBe("text/markdown");
      expect(Buffer.isBuffer(result.buffer)).toBe(true);

      const content = result.buffer.toString("utf8");
      expect(content).toContain("# My Page");
      expect(content).toContain("**bold**");

      // Verify the API call
      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toContain("/ex/confluence/cloud-123/wiki/rest/api/content/page-1");
      expect(url).toContain("expand=body.storage");
    });

    it("handles page download failure", async () => {
      mockFetch.mockResolvedValueOnce(textResponse("Not Found", 404));

      await expect(
        confluenceAdapter.downloadFile("access-tok", "cloud-123::page:bad-id"),
      ).rejects.toThrow("Confluence page download failed (404)");
    });

    it("handles page with empty body", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: "page-empty",
          title: "Empty Page",
          body: { storage: { value: "" } },
        }),
      );

      const result = await confluenceAdapter.downloadFile("access-tok", "cloud-123::page:page-empty");
      const content = result.buffer.toString("utf8");
      expect(content).toContain("# Empty Page");
    });
  });

  // ─── downloadFile — attachments ────────────────────────────────────────

  describe("downloadFile — attachments", () => {
    it("downloads an attachment binary", async () => {
      const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF header
      const downloadPath = "/download/attachments/123/report.pdf";
      const encodedPath = Buffer.from(downloadPath).toString("base64url");

      mockFetch.mockResolvedValueOnce(binaryResponse(pdfData, "application/pdf"));

      const result = await confluenceAdapter.downloadFile(
        "access-tok",
        `cloud-123::attachment:att-1:${encodedPath}`,
      );

      expect(result.name).toBe("report.pdf");
      expect(result.mimeType).toBe("application/pdf");
      expect(result.buffer).toEqual(Buffer.from(pdfData));

      // Verify the URL
      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toContain("/ex/confluence/cloud-123/wiki/download/attachments/123/report.pdf");
    });

    it("handles attachment download failure", async () => {
      const downloadPath = "/download/attachments/123/missing.pdf";
      const encodedPath = Buffer.from(downloadPath).toString("base64url");

      mockFetch.mockResolvedValueOnce(textResponse("Not Found", 404));

      await expect(
        confluenceAdapter.downloadFile("access-tok", `cloud-123::attachment:att-1:${encodedPath}`),
      ).rejects.toThrow("Confluence attachment download failed (404)");
    });
  });

  // ─── downloadFile — invalid ID format ─────────────────────────────────

  describe("downloadFile — invalid format", () => {
    it("throws on unknown file ID format", async () => {
      await expect(
        confluenceAdapter.downloadFile("access-tok", "cloud-123::unknown:123"),
      ).rejects.toThrow("Unknown Confluence file ID format");
    });
  });

  // ─── getConfluenceCredentials ──────────────────────────────────────────

  describe("getConfluenceCredentials", () => {
    it("returns env-var credentials when integrationConfig is empty", () => {
      vi.mocked(getIntegrationConfig).mockReturnValue({});
      const creds = getConfluenceCredentials();
      expect(creds.clientId).toBe("test-confluence-client-id");
      expect(creds.clientSecret).toBe("test-confluence-client-secret");
      expect(creds.isCustom).toBe(false);
    });

    it("prefers org-level custom credentials over env vars", () => {
      vi.mocked(getIntegrationConfig).mockReturnValue({
        confluenceClientId: "custom-id",
        confluenceClientSecret: "custom-secret",
      });
      const creds = getConfluenceCredentials();
      expect(creds.clientId).toBe("custom-id");
      expect(creds.clientSecret).toBe("custom-secret");
      expect(creds.isCustom).toBe(true);
    });

    it("falls back to env vars when only one custom field is set", () => {
      vi.mocked(getIntegrationConfig).mockReturnValue({
        confluenceClientId: "custom-id",
        // clientSecret missing
      });
      const creds = getConfluenceCredentials();
      expect(creds.clientId).toBe("test-confluence-client-id");
      expect(creds.isCustom).toBe(false);
    });
  });

  // ─── storageToMarkdown ─────────────────────────────────────────────────

  describe("storageToMarkdown", () => {
    it("converts headers", () => {
      expect(storageToMarkdown("<h1>Title</h1>")).toBe("# Title");
      expect(storageToMarkdown("<h2>Subtitle</h2>")).toBe("## Subtitle");
      expect(storageToMarkdown("<h3>Section</h3>")).toBe("### Section");
    });

    it("converts bold and italic", () => {
      expect(storageToMarkdown("<strong>bold</strong>")).toBe("**bold**");
      expect(storageToMarkdown("<b>bold</b>")).toBe("**bold**");
      expect(storageToMarkdown("<em>italic</em>")).toBe("*italic*");
      expect(storageToMarkdown("<i>italic</i>")).toBe("*italic*");
    });

    it("converts inline code", () => {
      expect(storageToMarkdown("<code>foo()</code>")).toBe("`foo()`");
    });

    it("converts links", () => {
      expect(storageToMarkdown('<a href="https://example.com">Link</a>')).toBe(
        "[Link](https://example.com)",
      );
    });

    it("converts lists", () => {
      const html = "<ul><li>Item 1</li><li>Item 2</li></ul>";
      const md = storageToMarkdown(html);
      expect(md).toContain("- Item 1");
      expect(md).toContain("- Item 2");
    });

    it("converts paragraphs", () => {
      const html = "<p>First paragraph</p><p>Second paragraph</p>";
      const md = storageToMarkdown(html);
      expect(md).toContain("First paragraph");
      expect(md).toContain("Second paragraph");
    });

    it("strips remaining HTML tags", () => {
      const html = '<div class="custom"><span>Text</span></div>';
      expect(storageToMarkdown(html)).toBe("Text");
    });

    it("decodes HTML entities", () => {
      // &nbsp; becomes a regular space, trailing space is trimmed
      expect(storageToMarkdown("&amp; &lt; &gt; &quot; &#39; &nbsp;")).toBe("& < > \" '");
    });

    it("handles code blocks via ac:plain-text-body", () => {
      const html = "<ac:structured-macro><ac:plain-text-body>const x = 1;</ac:plain-text-body></ac:structured-macro>";
      const md = storageToMarkdown(html);
      expect(md).toContain("```");
      expect(md).toContain("const x = 1;");
    });

    it("handles empty input", () => {
      expect(storageToMarkdown("")).toBe("");
    });
  });

  // ─── formatCqlDate ─────────────────────────────────────────────────────

  describe("formatCqlDate", () => {
    it("formats ISO date to CQL format", () => {
      expect(formatCqlDate("2026-03-15T14:30:00.000Z")).toBe("2026-03-15 14:30");
    });

    it("pads single-digit months and days", () => {
      expect(formatCqlDate("2026-01-05T09:05:00.000Z")).toBe("2026-01-05 09:05");
    });
  });
});
