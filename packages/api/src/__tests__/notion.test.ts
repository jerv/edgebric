/**
 * Unit tests for the Notion connector (packages/api/src/connectors/notion.ts).
 *
 * Tests the connector adapter directly (not via HTTP routes).
 * All fetch() calls to Notion API are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock config before any connector import ─────────────────────────────────

vi.mock("../config.js", () => ({
  config: {
    cloud: {},
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

// Mock integrationConfigStore — returns Notion credentials
vi.mock("../services/integrationConfigStore.js", () => ({
  getIntegrationConfig: vi.fn(() => ({
    notionClientId: "test-notion-client-id",
    notionClientSecret: "test-notion-secret",
  })),
}));

// Mock registerConnector so importing the module doesn't require the full registry
vi.mock("../connectors/registry.js", () => ({
  registerConnector: vi.fn(),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { notionAdapter, getNotionCredentials, richTextToMarkdown, extractPageTitle, pageToMarkdown } from "../connectors/notion.js";
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

beforeEach(() => {
  mockFetch = vi.fn();
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Notion connector", () => {
  // ─── getNotionCredentials ─────────────────────────────────────────────────

  describe("getNotionCredentials", () => {
    it("returns org-level custom credentials", () => {
      vi.mocked(getIntegrationConfig).mockReturnValue({
        notionClientId: "custom-id",
        notionClientSecret: "custom-secret",
      });
      const creds = getNotionCredentials();
      expect(creds.clientId).toBe("custom-id");
      expect(creds.clientSecret).toBe("custom-secret");
      expect(creds.isCustom).toBe(true);
    });

    it("throws when credentials are not configured", () => {
      vi.mocked(getIntegrationConfig).mockReturnValue({});
      expect(() => getNotionCredentials()).toThrow("Notion OAuth credentials not configured");
    });

    it("throws when only one credential field is set", () => {
      vi.mocked(getIntegrationConfig).mockReturnValue({
        notionClientId: "id-only",
      });
      expect(() => getNotionCredentials()).toThrow("Notion OAuth credentials not configured");
    });
  });

  // ─── richTextToMarkdown ───────────────────────────────────────────────────

  describe("richTextToMarkdown", () => {
    it("converts plain text", () => {
      const result = richTextToMarkdown([{ type: "text", plain_text: "Hello world" }]);
      expect(result).toBe("Hello world");
    });

    it("converts bold text", () => {
      const result = richTextToMarkdown([
        { type: "text", plain_text: "bold", annotations: { bold: true } },
      ]);
      expect(result).toBe("**bold**");
    });

    it("converts italic text", () => {
      const result = richTextToMarkdown([
        { type: "text", plain_text: "italic", annotations: { italic: true } },
      ]);
      expect(result).toBe("*italic*");
    });

    it("converts code text", () => {
      const result = richTextToMarkdown([
        { type: "text", plain_text: "code", annotations: { code: true } },
      ]);
      expect(result).toBe("`code`");
    });

    it("converts strikethrough text", () => {
      const result = richTextToMarkdown([
        { type: "text", plain_text: "deleted", annotations: { strikethrough: true } },
      ]);
      expect(result).toBe("~~deleted~~");
    });

    it("converts links", () => {
      const result = richTextToMarkdown([
        { type: "text", plain_text: "click here", href: "https://example.com" },
      ]);
      expect(result).toBe("[click here](https://example.com)");
    });

    it("handles combined annotations", () => {
      const result = richTextToMarkdown([
        { type: "text", plain_text: "bold italic", annotations: { bold: true, italic: true } },
      ]);
      expect(result).toBe("***bold italic***");
    });

    it("concatenates multiple rich text segments", () => {
      const result = richTextToMarkdown([
        { type: "text", plain_text: "Hello " },
        { type: "text", plain_text: "world", annotations: { bold: true } },
      ]);
      expect(result).toBe("Hello **world**");
    });

    it("handles empty array", () => {
      expect(richTextToMarkdown([])).toBe("");
    });
  });

  // ─── extractPageTitle ─────────────────────────────────────────────────────

  describe("extractPageTitle", () => {
    it("extracts title from title-type property", () => {
      const props = {
        Name: {
          type: "title",
          title: [{ type: "text", plain_text: "My Page" }],
        },
      };
      expect(extractPageTitle(props)).toBe("My Page");
    });

    it("returns 'Untitled' when no title property", () => {
      expect(extractPageTitle({})).toBe("Untitled");
    });

    it("returns 'Untitled' when title array is empty", () => {
      const props = { Name: { type: "title", title: [] } };
      expect(extractPageTitle(props)).toBe("Untitled");
    });

    it("concatenates multi-segment titles", () => {
      const props = {
        Title: {
          type: "title",
          title: [
            { type: "text", plain_text: "Part 1 " },
            { type: "text", plain_text: "Part 2" },
          ],
        },
      };
      expect(extractPageTitle(props)).toBe("Part 1 Part 2");
    });
  });

  // ─── getAuthUrl ──────────────────────────────────────────────────────────

  describe("getAuthUrl", () => {
    it("generates correct Notion OAuth URL", () => {
      vi.mocked(getIntegrationConfig).mockReturnValue({
        notionClientId: "test-notion-client-id",
        notionClientSecret: "test-notion-secret",
      });

      const url = notionAdapter.getAuthUrl("state-abc", "http://localhost:3001/callback");
      const parsed = new URL(url);

      expect(parsed.origin).toBe("https://api.notion.com");
      expect(parsed.pathname).toBe("/v1/oauth/authorize");
      expect(parsed.searchParams.get("client_id")).toBe("test-notion-client-id");
      expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:3001/callback");
      expect(parsed.searchParams.get("response_type")).toBe("code");
      expect(parsed.searchParams.get("state")).toBe("state-abc");
      expect(parsed.searchParams.get("owner")).toBe("user");
    });
  });

  // ─── exchangeCode ───────────────────────────────────────────────────────

  describe("exchangeCode", () => {
    it("exchanges code using Basic auth and returns tokens", async () => {
      vi.mocked(getIntegrationConfig).mockReturnValue({
        notionClientId: "test-notion-client-id",
        notionClientSecret: "test-notion-secret",
      });

      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          access_token: "ntn_test_token",
          workspace_name: "My Workspace",
          workspace_id: "ws-123",
          owner: {
            user: {
              name: "Test User",
              person: { email: "user@example.com" },
            },
          },
        }),
      );

      const tokens = await notionAdapter.exchangeCode("auth-code-123", "http://localhost:3001/callback");

      expect(tokens.accessToken).toBe("ntn_test_token");
      expect(tokens.refreshToken).toBeUndefined();
      expect(tokens.expiresAt).toBeUndefined();
      expect(tokens.accountEmail).toBe("user@example.com");

      // Verify Basic auth header
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://api.notion.com/v1/oauth/token");
      expect(opts.method).toBe("POST");
      const expectedAuth = Buffer.from("test-notion-client-id:test-notion-secret").toString("base64");
      expect(opts.headers.Authorization).toBe(`Basic ${expectedAuth}`);

      // Verify request body
      const body = JSON.parse(opts.body);
      expect(body.grant_type).toBe("authorization_code");
      expect(body.code).toBe("auth-code-123");
      expect(body.redirect_uri).toBe("http://localhost:3001/callback");
    });

    it("handles missing owner/email gracefully", async () => {
      vi.mocked(getIntegrationConfig).mockReturnValue({
        notionClientId: "test-notion-client-id",
        notionClientSecret: "test-notion-secret",
      });

      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          access_token: "ntn_test_token",
          workspace_name: "My Workspace",
        }),
      );

      const tokens = await notionAdapter.exchangeCode("code", "http://localhost:3001/cb");
      expect(tokens.accessToken).toBe("ntn_test_token");
      expect(tokens.accountEmail).toBeUndefined();
    });

    it("handles token exchange failure", async () => {
      vi.mocked(getIntegrationConfig).mockReturnValue({
        notionClientId: "test-notion-client-id",
        notionClientSecret: "test-notion-secret",
      });

      mockFetch.mockResolvedValueOnce(textResponse("invalid_grant", 400));

      await expect(
        notionAdapter.exchangeCode("bad-code", "http://localhost:3001/callback"),
      ).rejects.toThrow("Notion token exchange failed (400): invalid_grant");
    });
  });

  // ─── refreshAccessToken ─────────────────────────────────────────────────

  describe("refreshAccessToken", () => {
    it("throws because Notion tokens don't expire", async () => {
      await expect(
        notionAdapter.refreshAccessToken("any-token"),
      ).rejects.toThrow("Notion tokens do not expire");
    });
  });

  // ─── listFolders ────────────────────────────────────────────────────────

  describe("listFolders", () => {
    it("lists databases and workspace-level pages", async () => {
      // First call: search databases
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: "db-1",
              title: [{ plain_text: "Project Tasks" }],
              icon: { type: "emoji", emoji: "📋" },
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
      );

      // Second call: search pages
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: "page-1",
              parent: { type: "workspace" },
              properties: {
                title: { type: "title", title: [{ plain_text: "Meeting Notes" }] },
              },
              icon: { type: "emoji", emoji: "📝" },
            },
            {
              // Page inside a database — should be excluded
              id: "page-2",
              parent: { type: "database_id" },
              properties: {
                Name: { type: "title", title: [{ plain_text: "Task 1" }] },
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
      );

      const folders = await notionAdapter.listFolders("access-tok");

      expect(folders).toHaveLength(2);
      expect(folders[0]).toEqual({
        id: "db-1",
        name: "📋 Project Tasks",
        hasChildren: true,
      });
      expect(folders[1]).toEqual({
        id: "page-1",
        name: "📝 Meeting Notes",
        hasChildren: true,
      });

      // Verify search calls used correct filter
      const dbCall = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(dbCall.filter).toEqual({ property: "object", value: "database" });
      const pageCall = JSON.parse(mockFetch.mock.calls[1]![1].body);
      expect(pageCall.filter).toEqual({ property: "object", value: "page" });
    });

    it("handles API error", async () => {
      mockFetch.mockResolvedValueOnce(textResponse("Unauthorized", 401));

      await expect(
        notionAdapter.listFolders("bad-token"),
      ).rejects.toThrow("Notion search databases failed (401): Unauthorized");
    });

    it("paginates through databases", async () => {
      // Page 1 of databases
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: "db-1", title: [{ plain_text: "DB 1" }] }],
          has_more: true,
          next_cursor: "cursor-2",
        }),
      );

      // Page 2 of databases
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: "db-2", title: [{ plain_text: "DB 2" }] }],
          has_more: false,
          next_cursor: null,
        }),
      );

      // Pages search
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ results: [], has_more: false, next_cursor: null }),
      );

      const folders = await notionAdapter.listFolders("tok");

      expect(folders).toHaveLength(2);
      expect(folders[0]!.name).toBe("DB 1");
      expect(folders[1]!.name).toBe("DB 2");

      // Verify pagination cursor was sent
      const secondCall = JSON.parse(mockFetch.mock.calls[1]![1].body);
      expect(secondCall.start_cursor).toBe("cursor-2");
    });
  });

  // ─── getChanges — database initial sync ─────────────────────────────────

  describe("getChanges — database initial sync (null cursor)", () => {
    it("queries database and returns pages as added changes", async () => {
      // detectItemType: database check succeeds
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "db-1" }));

      // Database query
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: "page-1",
              properties: {
                Name: { type: "title", title: [{ plain_text: "First Page" }] },
              },
              last_edited_time: "2026-03-15T10:00:00Z",
              archived: false,
            },
            {
              id: "page-2",
              properties: {
                Name: { type: "title", title: [{ plain_text: "Second Page" }] },
              },
              last_edited_time: "2026-03-16T10:00:00Z",
              archived: false,
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
      );

      const result = await notionAdapter.getChanges("access-tok", "db-1", null);

      expect(result.changes).toHaveLength(2);
      expect(result.changes[0]).toEqual({
        type: "added",
        file: {
          id: "page-1",
          name: "First Page",
          mimeType: "text/markdown",
          modifiedAt: "2026-03-15T10:00:00Z",
        },
      });
      expect(result.changes[1]!.type).toBe("added");
      expect(result.newCursor).toBeDefined();
    });

    it("reports archived pages as deleted", async () => {
      // detectItemType: database
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "db-1" }));

      // Query with archived page
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: "page-archived",
              properties: {
                Name: { type: "title", title: [{ plain_text: "Archived Page" }] },
              },
              last_edited_time: "2026-03-15T10:00:00Z",
              archived: true,
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
      );

      const result = await notionAdapter.getChanges("access-tok", "db-1", null);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]!.type).toBe("deleted");
    });
  });

  // ─── getChanges — database delta sync ───────────────────────────────────

  describe("getChanges — database delta sync (with cursor)", () => {
    it("filters by last_edited_time and marks changes as modified", async () => {
      const lastSync = "2026-03-15T00:00:00Z";

      // detectItemType: database
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: "db-1" }));

      // Query with filter
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: "page-modified",
              properties: {
                Name: { type: "title", title: [{ plain_text: "Updated Page" }] },
              },
              last_edited_time: "2026-03-16T10:00:00Z",
              archived: false,
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
      );

      const result = await notionAdapter.getChanges("access-tok", "db-1", lastSync);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]!.type).toBe("modified");
      expect(result.changes[0]!.file.name).toBe("Updated Page");

      // Verify the filter was sent
      const queryBody = JSON.parse(mockFetch.mock.calls[1]![1].body);
      expect(queryBody.filter).toEqual({
        timestamp: "last_edited_time",
        last_edited_time: { on_or_after: lastSync },
      });
    });
  });

  // ─── getChanges — page sync ─────────────────────────────────────────────

  describe("getChanges — page sync", () => {
    it("syncs a single page and its child pages", async () => {
      // detectItemType: database check fails -> page
      mockFetch.mockResolvedValueOnce(textResponse("Not Found", 404));

      // Fetch page metadata
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: "page-root",
          properties: {
            title: { type: "title", title: [{ plain_text: "Root Page" }] },
          },
          last_edited_time: "2026-03-15T10:00:00Z",
          archived: false,
        }),
      );

      // Fetch page blocks (to find child pages)
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            { id: "block-1", type: "paragraph", has_children: false },
            { id: "child-page-1", type: "child_page", has_children: true },
          ],
          has_more: false,
          next_cursor: null,
        }),
      );

      // Fetch child page metadata
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: "child-page-1",
          properties: {
            title: { type: "title", title: [{ plain_text: "Child Page" }] },
          },
          last_edited_time: "2026-03-14T10:00:00Z",
          archived: false,
        }),
      );

      const result = await notionAdapter.getChanges("access-tok", "page-root", null);

      expect(result.changes).toHaveLength(2);
      expect(result.changes[0]!.file.name).toBe("Root Page");
      expect(result.changes[0]!.type).toBe("added");
      expect(result.changes[1]!.file.name).toBe("Child Page");
      expect(result.changes[1]!.type).toBe("added");
    });

    it("skips unchanged pages during delta sync", async () => {
      const lastSync = "2026-03-15T12:00:00Z";

      // detectItemType: page
      mockFetch.mockResolvedValueOnce(textResponse("Not Found", 404));

      // Fetch page metadata (not modified since last sync)
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: "page-root",
          properties: {
            title: { type: "title", title: [{ plain_text: "Root Page" }] },
          },
          last_edited_time: "2026-03-14T10:00:00Z",
          archived: false,
        }),
      );

      // Fetch blocks
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [],
          has_more: false,
          next_cursor: null,
        }),
      );

      const result = await notionAdapter.getChanges("access-tok", "page-root", lastSync);

      expect(result.changes).toHaveLength(0);
    });
  });

  // ─── downloadFile ──────────────────────────────────────────────────────

  describe("downloadFile", () => {
    it("fetches page metadata and converts blocks to markdown", async () => {
      // Page metadata
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: "page-1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Test Document" }] },
          },
        }),
      );

      // Page blocks
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: "block-1",
              type: "heading_1",
              has_children: false,
              heading_1: {
                rich_text: [{ type: "text", plain_text: "Introduction" }],
              },
            },
            {
              id: "block-2",
              type: "paragraph",
              has_children: false,
              paragraph: {
                rich_text: [{ type: "text", plain_text: "This is a test paragraph." }],
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
      );

      const result = await notionAdapter.downloadFile("access-tok", "page-1");

      expect(result.name).toBe("Test Document.md");
      expect(result.mimeType).toBe("text/markdown");
      expect(Buffer.isBuffer(result.buffer)).toBe(true);

      const content = result.buffer.toString("utf-8");
      expect(content).toContain("# Test Document");
      expect(content).toContain("# Introduction");
      expect(content).toContain("This is a test paragraph.");
    });

    it("sanitizes filenames with special characters", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: "page-1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Test/Doc: \"Version\" 2.0" }] },
          },
        }),
      );

      mockFetch.mockResolvedValueOnce(
        jsonResponse({ results: [], has_more: false, next_cursor: null }),
      );

      const result = await notionAdapter.downloadFile("access-tok", "page-1");
      expect(result.name).not.toContain("/");
      expect(result.name).not.toContain(":");
      expect(result.name).not.toContain("\"");
      expect(result.name.endsWith(".md")).toBe(true);
    });

    it("handles page metadata fetch failure", async () => {
      mockFetch.mockResolvedValueOnce(textResponse("Not Found", 404));

      await expect(
        notionAdapter.downloadFile("access-tok", "bad-page-id"),
      ).rejects.toThrow("Notion page metadata failed (404)");
    });
  });

  // ─── pageToMarkdown ───────────────────────────────────────────────────────

  describe("pageToMarkdown", () => {
    it("converts various block types to markdown", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: "b1", type: "heading_2", has_children: false,
              heading_2: { rich_text: [{ type: "text", plain_text: "Subheading" }] },
            },
            {
              id: "b2", type: "bulleted_list_item", has_children: false,
              bulleted_list_item: { rich_text: [{ type: "text", plain_text: "Item 1" }] },
            },
            {
              id: "b3", type: "to_do", has_children: false,
              to_do: { rich_text: [{ type: "text", plain_text: "Task" }], checked: true },
            },
            {
              id: "b4", type: "code", has_children: false,
              code: { rich_text: [{ type: "text", plain_text: "console.log('hi')" }], language: "javascript" },
            },
            {
              id: "b5", type: "quote", has_children: false,
              quote: { rich_text: [{ type: "text", plain_text: "A quote" }] },
            },
            {
              id: "b6", type: "divider", has_children: false,
              divider: {},
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
      );

      const md = await pageToMarkdown("tok", "page-id");

      expect(md).toContain("## Subheading");
      expect(md).toContain("- Item 1");
      expect(md).toContain("- [x] Task");
      expect(md).toContain("```javascript");
      expect(md).toContain("console.log('hi')");
      expect(md).toContain("> A quote");
      expect(md).toContain("---");
    });

    it("recursively fetches child blocks", async () => {
      // Parent blocks
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: "toggle-1", type: "toggle", has_children: true,
              toggle: { rich_text: [{ type: "text", plain_text: "Click to expand" }] },
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
      );

      // Child blocks of the toggle
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: "child-1", type: "paragraph", has_children: false,
              paragraph: { rich_text: [{ type: "text", plain_text: "Hidden content" }] },
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
      );

      const md = await pageToMarkdown("tok", "page-id");

      expect(md).toContain("Click to expand");
      expect(md).toContain("Hidden content");
    });

    it("handles blocks API failure", async () => {
      mockFetch.mockResolvedValueOnce(textResponse("Server Error", 500));

      await expect(pageToMarkdown("tok", "page-id")).rejects.toThrow(
        "Notion blocks API failed (500)",
      );
    });
  });
});
