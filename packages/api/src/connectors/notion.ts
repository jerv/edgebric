/**
 * Notion connector — implements CloudConnectorAdapter.
 *
 * Uses raw fetch() against Notion API (no @notionhq/client SDK).
 * Notion uses a blocks-based content model, so pages are converted to markdown.
 *
 * Key differences from file-based connectors (Google Drive, OneDrive):
 * - "Folders" = Notion databases and top-level pages
 * - "Files" = Notion pages (downloaded as markdown)
 * - Delta sync uses last_edited_time filter instead of change tokens
 * - Content is assembled from the Blocks API and converted to markdown
 *
 * OAuth: Standard OAuth 2.0 (authorization code grant).
 * Scopes are implicit — Notion grants access to pages/databases the user selects during auth.
 */
import { registerConnector } from "./registry.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import { logger } from "../lib/logger.js";
import type { CloudConnectorAdapter, ConnectorSyncResult, OAuthTokens } from "./types.js";
import type { CloudFolder } from "@edgebric/types";

const AUTH_URL = "https://api.notion.com/v1/oauth/authorize";
const TOKEN_URL = "https://api.notion.com/v1/oauth/token";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

/**
 * Resolve Notion OAuth credentials.
 * Notion uses "OAuth client ID" = the integration's client ID,
 * and "OAuth client secret" for the token exchange.
 * Priority: org-level custom credentials > env vars.
 * Notion has no shipped defaults — admin must configure their own integration.
 */
export function getNotionCredentials(): { clientId: string; clientSecret: string; isCustom: boolean } {
  const integrationCfg = getIntegrationConfig();
  if (integrationCfg.notionClientId && integrationCfg.notionClientSecret) {
    return {
      clientId: integrationCfg.notionClientId,
      clientSecret: integrationCfg.notionClientSecret,
      isCustom: true,
    };
  }
  throw new Error("Notion OAuth credentials not configured. An admin must set up a Notion integration.");
}

function getClientId(): string {
  return getNotionCredentials().clientId;
}

function getClientSecret(): string {
  return getNotionCredentials().clientSecret;
}

/** Standard Notion API headers. */
function notionHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

// ─── Block-to-Markdown Conversion ──────────────────────────────────────────

interface NotionRichText {
  type: string;
  plain_text: string;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    code?: boolean;
  };
  href?: string | null;
}

interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  [key: string]: unknown;
}

/** Convert Notion rich text array to markdown string. */
export function richTextToMarkdown(richTexts: NotionRichText[]): string {
  return richTexts
    .map((rt) => {
      let text = rt.plain_text;
      if (!text) return "";

      const ann = rt.annotations;
      if (ann?.code) text = `\`${text}\``;
      if (ann?.bold) text = `**${text}**`;
      if (ann?.italic) text = `*${text}*`;
      if (ann?.strikethrough) text = `~~${text}~~`;
      if (rt.href) text = `[${text}](${rt.href})`;

      return text;
    })
    .join("");
}

/** Convert a single Notion block to markdown. */
function blockToMarkdown(block: NotionBlock): string {
  const type = block.type;
  const data = block[type] as Record<string, unknown> | undefined;
  if (!data) return "";

  const richText = (data.rich_text ?? []) as NotionRichText[];
  const text = richTextToMarkdown(richText);

  switch (type) {
    case "paragraph":
      return text ? `${text}\n` : "\n";
    case "heading_1":
      return `# ${text}\n`;
    case "heading_2":
      return `## ${text}\n`;
    case "heading_3":
      return `### ${text}\n`;
    case "bulleted_list_item":
      return `- ${text}\n`;
    case "numbered_list_item":
      return `1. ${text}\n`;
    case "to_do": {
      const checked = (data.checked as boolean) ? "x" : " ";
      return `- [${checked}] ${text}\n`;
    }
    case "toggle":
      return `- ${text}\n`;
    case "quote":
      return `> ${text}\n`;
    case "callout":
      return `> ${text}\n`;
    case "code": {
      const lang = (data.language as string) ?? "";
      return `\`\`\`${lang}\n${text}\n\`\`\`\n`;
    }
    case "divider":
      return "---\n";
    case "table_row": {
      const cells = (data.cells ?? []) as NotionRichText[][];
      return `| ${cells.map((c) => richTextToMarkdown(c)).join(" | ")} |\n`;
    }
    case "image": {
      const imageData = data as Record<string, unknown>;
      const caption = richTextToMarkdown((imageData.caption ?? []) as NotionRichText[]);
      const url =
        (imageData.type === "external"
          ? (imageData.external as Record<string, string>)?.url
          : (imageData.file as Record<string, string>)?.url) ?? "";
      return caption ? `![${caption}](${url})\n` : `![image](${url})\n`;
    }
    case "bookmark": {
      const bookmarkUrl = (data.url as string) ?? "";
      const caption = richTextToMarkdown((data.caption ?? []) as NotionRichText[]);
      return caption ? `[${caption}](${bookmarkUrl})\n` : `${bookmarkUrl}\n`;
    }
    case "embed": {
      const embedUrl = (data.url as string) ?? "";
      return `${embedUrl}\n`;
    }
    case "child_page": {
      const title = (data.title as string) ?? "Untitled";
      return `## ${title}\n`;
    }
    case "child_database": {
      const dbTitle = (data.title as string) ?? "Untitled Database";
      return `## ${dbTitle}\n`;
    }
    default:
      // Unsupported block types are silently skipped
      return text ? `${text}\n` : "";
  }
}

/**
 * Fetch all blocks for a page and convert to markdown.
 * Recursively fetches child blocks up to 3 levels deep.
 */
export async function pageToMarkdown(
  accessToken: string,
  pageId: string,
  depth = 0,
): Promise<string> {
  const maxDepth = 3;
  const parts: string[] = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("start_cursor", cursor);

    const resp = await fetch(
      `${NOTION_API}/blocks/${pageId}/children?${params.toString()}`,
      { headers: notionHeaders(accessToken) },
    );

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Notion blocks API failed (${resp.status}): ${body}`);
    }

    const data = (await resp.json()) as {
      results: NotionBlock[];
      has_more: boolean;
      next_cursor: string | null;
    };

    for (const block of data.results) {
      const md = blockToMarkdown(block);
      if (md) parts.push(md);

      // Recursively fetch children (indented content, toggles, etc.)
      if (block.has_children && depth < maxDepth) {
        const childMd = await pageToMarkdown(accessToken, block.id, depth + 1);
        if (childMd) {
          // Indent child content for nested blocks
          const indented = childMd
            .split("\n")
            .map((line) => (line ? `  ${line}` : ""))
            .join("\n");
          parts.push(indented);
        }
      }
    }

    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return parts.join("\n");
}

/** Extract plain text title from a Notion page's properties. */
function extractPageTitle(properties: Record<string, unknown>): string {
  // Notion page titles can be in a property called "title", "Name", or the first title-type property
  for (const value of Object.values(properties)) {
    const prop = value as Record<string, unknown>;
    if (prop.type === "title") {
      const titleArr = (prop.title ?? []) as NotionRichText[];
      const title = titleArr.map((t) => t.plain_text).join("");
      if (title) return title;
    }
  }
  return "Untitled";
}

// ─── Connector Adapter ─────────────────────────────────────────────────────

const notionAdapter: CloudConnectorAdapter = {
  provider: "notion",

  getAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: getClientId(),
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      owner: "user",
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    // Notion uses Basic auth for token exchange (client_id:client_secret base64-encoded)
    const credentials = Buffer.from(`${getClientId()}:${getClientSecret()}`).toString("base64");

    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Notion token exchange failed (${resp.status}): ${body}`);
    }

    const data = (await resp.json()) as {
      access_token: string;
      workspace_name?: string;
      workspace_id?: string;
      owner?: { user?: { name?: string; person?: { email?: string } } };
    };

    // Extract account email from the owner field
    const accountEmail = data.owner?.user?.person?.email;

    return {
      accessToken: data.access_token,
      // Notion tokens don't expire and don't have refresh tokens
      refreshToken: undefined,
      expiresAt: undefined,
      accountEmail,
      scopes: undefined,
    };
  },

  async refreshAccessToken(_refreshToken: string): Promise<{ accessToken: string; expiresAt?: string }> {
    // Notion access tokens don't expire — they're valid until the integration is revoked.
    // This method should never be called, but we handle it gracefully.
    throw new Error("Notion tokens do not expire and cannot be refreshed");
  },

  async listFolders(accessToken: string, _parentId?: string): Promise<CloudFolder[]> {
    // For Notion, "folders" are databases and top-level pages.
    // We search for all databases and pages the integration has access to.
    const folders: CloudFolder[] = [];

    // List databases
    let cursor: string | undefined;
    do {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;

      const resp = await fetch(`${NOTION_API}/search`, {
        method: "POST",
        headers: notionHeaders(accessToken),
        body: JSON.stringify({
          ...body,
          filter: { property: "object", value: "database" },
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Notion search databases failed (${resp.status}): ${text}`);
      }

      const data = (await resp.json()) as {
        results: Array<{
          id: string;
          title?: NotionRichText[];
          icon?: { type: string; emoji?: string };
        }>;
        has_more: boolean;
        next_cursor: string | null;
      };

      for (const db of data.results) {
        const title = db.title?.map((t) => t.plain_text).join("") || "Untitled Database";
        const icon = db.icon?.emoji ? `${db.icon.emoji} ` : "";
        folders.push({
          id: db.id,
          name: `${icon}${title}`,
          hasChildren: true,
        });
      }

      cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
    } while (cursor);

    // Also list top-level pages (not inside a database)
    cursor = undefined;
    do {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;

      const resp = await fetch(`${NOTION_API}/search`, {
        method: "POST",
        headers: notionHeaders(accessToken),
        body: JSON.stringify({
          ...body,
          filter: { property: "object", value: "page" },
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Notion search pages failed (${resp.status}): ${text}`);
      }

      const data = (await resp.json()) as {
        results: Array<{
          id: string;
          parent: { type: string };
          properties: Record<string, unknown>;
          icon?: { type: string; emoji?: string };
        }>;
        has_more: boolean;
        next_cursor: string | null;
      };

      for (const page of data.results) {
        // Only include workspace-level pages (not pages inside databases)
        if (page.parent.type === "workspace") {
          const title = extractPageTitle(page.properties);
          const icon = page.icon?.emoji ? `${page.icon.emoji} ` : "";
          folders.push({
            id: page.id,
            name: `${icon}${title}`,
            hasChildren: true,
          });
        }
      }

      cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
    } while (cursor);

    return folders;
  },

  async getChanges(accessToken: string, folderId: string, cursor: string | null): Promise<ConnectorSyncResult> {
    // Determine if folderId is a database or a page
    const itemType = await detectItemType(accessToken, folderId);

    if (itemType === "database") {
      return syncDatabase(accessToken, folderId, cursor);
    }
    // It's a page — sync the page itself and its child pages
    return syncPage(accessToken, folderId, cursor);
  },

  async downloadFile(accessToken: string, fileId: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
    // Get page metadata for the title
    const resp = await fetch(`${NOTION_API}/pages/${fileId}`, {
      headers: notionHeaders(accessToken),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Notion page metadata failed (${resp.status}): ${body}`);
    }

    const page = (await resp.json()) as {
      id: string;
      properties: Record<string, unknown>;
    };

    const title = extractPageTitle(page.properties);
    const safeName = title.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 200);

    // Convert page blocks to markdown
    const markdown = await pageToMarkdown(accessToken, fileId);
    const content = `# ${title}\n\n${markdown}`;

    return {
      buffer: Buffer.from(content, "utf-8"),
      mimeType: "text/markdown",
      name: `${safeName}.md`,
    };
  },
};

// ─── Sync Helpers ──────────────────────────────────────────────────────────

/** Detect whether an ID is a database or page. */
async function detectItemType(accessToken: string, id: string): Promise<"database" | "page"> {
  // Try database first (cheaper — just metadata)
  const dbResp = await fetch(`${NOTION_API}/databases/${id}`, {
    headers: notionHeaders(accessToken),
  });
  if (dbResp.ok) return "database";

  // Not a database — must be a page
  return "page";
}

/**
 * Sync pages from a Notion database.
 * Uses last_edited_time filter for delta sync.
 * Cursor format: ISO timestamp of the last sync.
 */
async function syncDatabase(
  accessToken: string,
  databaseId: string,
  cursor: string | null,
): Promise<ConnectorSyncResult> {
  const changes: ConnectorSyncResult["changes"] = [];
  let pageCursor: string | undefined;

  // Build filter: if we have a cursor (last sync time), only get pages edited since then
  const filter = cursor
    ? { timestamp: "last_edited_time", last_edited_time: { on_or_after: cursor } }
    : undefined;

  do {
    const body: Record<string, unknown> = {
      page_size: 100,
      sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
    };
    if (filter) body.filter = filter;
    if (pageCursor) body.start_cursor = pageCursor;

    const resp = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
      method: "POST",
      headers: notionHeaders(accessToken),
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Notion database query failed (${resp.status}): ${text}`);
    }

    const data = (await resp.json()) as {
      results: Array<{
        id: string;
        properties: Record<string, unknown>;
        last_edited_time: string;
        archived: boolean;
      }>;
      has_more: boolean;
      next_cursor: string | null;
    };

    for (const page of data.results) {
      if (page.archived) {
        changes.push({
          type: "deleted",
          file: {
            id: page.id,
            name: extractPageTitle(page.properties),
            mimeType: "text/markdown",
            modifiedAt: page.last_edited_time,
          },
        });
        continue;
      }

      changes.push({
        type: cursor ? "modified" : "added",
        file: {
          id: page.id,
          name: extractPageTitle(page.properties),
          mimeType: "text/markdown",
          modifiedAt: page.last_edited_time,
        },
      });
    }

    pageCursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (pageCursor);

  // New cursor = current time (for next delta sync)
  const newCursor = new Date().toISOString();

  return { changes, newCursor };
}

/**
 * Sync a single page and its child pages.
 * For delta sync, checks last_edited_time of child pages.
 */
async function syncPage(
  accessToken: string,
  pageId: string,
  cursor: string | null,
): Promise<ConnectorSyncResult> {
  const changes: ConnectorSyncResult["changes"] = [];

  // Get the page itself
  const pageResp = await fetch(`${NOTION_API}/pages/${pageId}`, {
    headers: notionHeaders(accessToken),
  });

  if (!pageResp.ok) {
    const body = await pageResp.text();
    throw new Error(`Notion page fetch failed (${pageResp.status}): ${body}`);
  }

  const page = (await pageResp.json()) as {
    id: string;
    properties: Record<string, unknown>;
    last_edited_time: string;
    archived: boolean;
  };

  // Check if the page itself was modified since last sync
  if (!cursor || page.last_edited_time >= cursor) {
    if (page.archived) {
      changes.push({
        type: "deleted",
        file: {
          id: page.id,
          name: extractPageTitle(page.properties),
          mimeType: "text/markdown",
          modifiedAt: page.last_edited_time,
        },
      });
    } else {
      changes.push({
        type: cursor ? "modified" : "added",
        file: {
          id: page.id,
          name: extractPageTitle(page.properties),
          mimeType: "text/markdown",
          modifiedAt: page.last_edited_time,
        },
      });
    }
  }

  // Also find child pages via blocks API
  let blockCursor: string | null = null;
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (blockCursor) params.set("start_cursor", blockCursor);

    const resp = await fetch(
      `${NOTION_API}/blocks/${pageId}/children?${params.toString()}`,
      { headers: notionHeaders(accessToken) },
    );

    if (!resp.ok) break; // Non-fatal — we still synced the parent page

    const data = (await resp.json()) as {
      results: Array<{ id: string; type: string; has_children: boolean }>;
      has_more: boolean;
      next_cursor: string | null;
    };

    for (const block of data.results) {
      if (block.type !== "child_page") continue;

      // Fetch child page metadata to check last_edited_time
      try {
        const childResp = await fetch(`${NOTION_API}/pages/${block.id}`, {
          headers: notionHeaders(accessToken),
        });
        if (!childResp.ok) continue;

        const child = (await childResp.json()) as {
          id: string;
          properties: Record<string, unknown>;
          last_edited_time: string;
          archived: boolean;
        };

        if (!cursor || child.last_edited_time >= cursor) {
          if (child.archived) {
            changes.push({
              type: "deleted",
              file: {
                id: child.id,
                name: extractPageTitle(child.properties),
                mimeType: "text/markdown",
                modifiedAt: child.last_edited_time,
              },
            });
          } else {
            changes.push({
              type: cursor ? "modified" : "added",
              file: {
                id: child.id,
                name: extractPageTitle(child.properties),
                mimeType: "text/markdown",
                modifiedAt: child.last_edited_time,
              },
            });
          }
        }
      } catch {
        logger.warn({ blockId: block.id }, "Failed to fetch child page metadata");
      }
    }

    blockCursor = data.has_more ? data.next_cursor : null;
  } while (blockCursor);

  const newCursor = new Date().toISOString();
  return { changes, newCursor };
}

// Register on import
registerConnector(notionAdapter);

export { notionAdapter, extractPageTitle };
