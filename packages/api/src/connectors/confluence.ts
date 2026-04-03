/**
 * Confluence Cloud connector — implements CloudConnectorAdapter.
 *
 * Uses raw fetch() against Atlassian REST APIs (no SDK).
 * Scopes: read:confluence-content.all read:confluence-space.summary offline_access read:me
 *
 * OAuth flow: Atlassian 3LO (three-legged OAuth 2.0).
 * This authorizes Edgebric to access the user's Confluence Cloud instance,
 * not to authenticate them.
 *
 * Content model: Confluence stores pages as Atlassian Document Format (ADF)
 * or XHTML. We fetch the "storage" representation (XHTML) and convert to
 * markdown for ingestion. Attachments (PDFs, DOCX) on pages are synced as
 * separate files.
 */
import { config } from "../config.js";
import { registerConnector } from "./registry.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import { logger } from "../lib/logger.js";
import type { CloudConnectorAdapter, ConnectorSyncResult, OAuthTokens } from "./types.js";
import type { CloudFolder } from "@edgebric/types";

const SCOPES = "read:confluence-content.all read:confluence-space.summary offline_access read:me";
const AUTH_URL = "https://auth.atlassian.com/authorize";
const TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const ACCESSIBLE_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources";
const ME_URL = "https://api.atlassian.com/me";

/** File types we can ingest from Confluence attachments. */
const SUPPORTED_ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);

/**
 * Resolve Confluence OAuth credentials.
 * Priority: org-level custom credentials > env vars > shipped defaults.
 * Returns `isCustom: true` when org provided their own (affects redirect URI).
 */
export function getConfluenceCredentials(): { clientId: string; clientSecret: string; isCustom: boolean } {
  const integrationCfg = getIntegrationConfig();
  if (integrationCfg.confluenceClientId && integrationCfg.confluenceClientSecret) {
    return {
      clientId: integrationCfg.confluenceClientId,
      clientSecret: integrationCfg.confluenceClientSecret,
      isCustom: true,
    };
  }
  const clientId = config.cloud.confluence.clientId;
  const clientSecret = config.cloud.confluence.clientSecret;
  if (!clientId || !clientSecret) throw new Error("Confluence OAuth credentials not configured");
  return { clientId, clientSecret, isCustom: false };
}

function getClientId(): string {
  return getConfluenceCredentials().clientId;
}

function getClientSecret(): string {
  return getConfluenceCredentials().clientSecret;
}

/** Get the Confluence Cloud REST API base URL for a given cloud ID. */
function apiBase(cloudId: string): string {
  return `https://api.atlassian.com/ex/confluence/${cloudId}`;
}

/**
 * Fetch the first accessible Confluence cloud site for this token.
 * Most users have a single site; we pick the first one.
 */
async function getCloudId(accessToken: string): Promise<string> {
  const resp = await fetch(ACCESSIBLE_RESOURCES_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`Confluence accessible-resources failed (${resp.status})`);
  }
  const sites = await resp.json() as Array<{ id: string; name: string; url: string }>;
  const confluenceSite = sites.find((s) => s.url.includes("atlassian.net"));
  if (!confluenceSite && sites.length === 0) {
    throw new Error("No accessible Confluence sites found");
  }
  return (confluenceSite ?? sites[0]!).id;
}

/**
 * Convert Confluence storage format (XHTML) to plain markdown.
 * This is a lightweight conversion — handles common elements.
 */
export function storageToMarkdown(html: string): string {
  let md = html;

  // Remove CDATA sections
  md = md.replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1");

  // Headers
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  // Bold / italic / code
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // Links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  md = md.replace(/<\/?[ou]l[^>]*>/gi, "\n");

  // Paragraphs and line breaks
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n");

  // Code blocks (ac:structured-macro for code)
  md = md.replace(/<ac:plain-text-body>([\s\S]*?)<\/ac:plain-text-body>/gi, "\n```\n$1\n```\n");

  // Tables — simple conversion
  md = md.replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, "| $1 ");
  md = md.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, "| $1 ");
  md = md.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, "$1|\n");
  md = md.replace(/<\/?table[^>]*>/gi, "\n");
  md = md.replace(/<\/?thead[^>]*>/gi, "");
  md = md.replace(/<\/?tbody[^>]*>/gi, "");

  // Strip remaining HTML tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  md = md.replace(/&amp;/g, "&");
  md = md.replace(/&lt;/g, "<");
  md = md.replace(/&gt;/g, ">");
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, " ");

  // Clean up extra whitespace
  md = md.replace(/\n{3,}/g, "\n\n");
  md = md.trim();

  return md;
}

const confluenceAdapter: CloudConnectorAdapter = {
  provider: "confluence",

  getAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      audience: "api.atlassian.com",
      client_id: getClientId(),
      scope: SCOPES,
      redirect_uri: redirectUri,
      state,
      response_type: "code",
      prompt: "consent",
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Confluence token exchange failed (${resp.status}): ${body}`);
    }

    const data = await resp.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    // Get the connected account's email
    let accountEmail: string | undefined;
    try {
      const meResp = await fetch(ME_URL, {
        headers: { Authorization: `Bearer ${data.access_token}`, Accept: "application/json" },
      });
      if (meResp.ok) {
        const meInfo = await meResp.json() as { email?: string };
        accountEmail = meInfo.email;
      }
    } catch {
      logger.warn("Failed to fetch Atlassian user info for connected account");
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : undefined,
      accountEmail,
      scopes: data.scope,
    };
  },

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt?: string }> {
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: getClientId(),
        client_secret: getClientSecret(),
        refresh_token: refreshToken,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Confluence token refresh failed (${resp.status}): ${body}`);
    }

    const data = await resp.json() as { access_token: string; expires_in?: number };

    if (data.expires_in) {
      return {
        accessToken: data.access_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      };
    }
    return { accessToken: data.access_token };
  },

  async listFolders(accessToken: string, _parentId?: string): Promise<CloudFolder[]> {
    // In Confluence, "folders" are spaces. We list all spaces the user can access.
    // parentId is not used — spaces are flat (no hierarchy for folder picker).
    const cloudId = await getCloudId(accessToken);
    const spaces: CloudFolder[] = [];
    let nextUrl: string | undefined = `${apiBase(cloudId)}/wiki/api/v2/spaces?limit=50&sort=name`;

    while (nextUrl) {
      const resp = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Confluence listSpaces failed (${resp.status}): ${body}`);
      }

      const data = await resp.json() as {
        results: Array<{ id: string; key: string; name: string }>;
        _links?: { next?: string };
      };

      for (const space of data.results) {
        spaces.push({
          id: `${cloudId}::${space.key}`,
          name: space.name,
          hasChildren: false,
        });
      }

      nextUrl = data._links?.next
        ? `https://api.atlassian.com${data._links.next}`
        : undefined;
    }

    return spaces;
  },

  async getChanges(accessToken: string, folderId: string, cursor: string | null): Promise<ConnectorSyncResult> {
    // folderId format: "cloudId::spaceKey"
    const [cloudId, spaceKey] = parseSpaceId(folderId);

    if (!cursor) {
      return initialSync(accessToken, cloudId, spaceKey);
    }
    return deltaSync(accessToken, cloudId, spaceKey, cursor);
  },

  async downloadFile(accessToken: string, fileId: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
    // fileId format: "cloudId::page:pageId" or "cloudId::attachment:attachmentId:downloadUrl"
    const parts = fileId.split("::");
    const cloudId = parts[0]!;
    const type = parts[1]!;

    if (type.startsWith("page:")) {
      const pageId = type.slice(5);
      return downloadPage(accessToken, cloudId, pageId);
    }

    if (type.startsWith("attachment:")) {
      // attachment:attachmentId:base64EncodedDownloadPath
      const rest = type.slice(11);
      const sepIdx = rest.indexOf(":");
      const downloadPath = rest.slice(sepIdx + 1);
      const decodedPath = Buffer.from(downloadPath, "base64url").toString("utf8");
      return downloadAttachment(accessToken, cloudId, decodedPath);
    }

    throw new Error(`Unknown Confluence file ID format: ${fileId}`);
  },
};

/** Parse a composite space ID "cloudId::spaceKey" into parts. */
function parseSpaceId(folderId: string): [string, string] {
  const sep = folderId.indexOf("::");
  if (sep === -1) throw new Error(`Invalid Confluence space ID: ${folderId}`);
  return [folderId.slice(0, sep), folderId.slice(sep + 2)];
}

/**
 * Initial full sync — list all pages in the space, plus attachments on those pages.
 * Uses CQL to find all content in the space.
 */
async function initialSync(
  accessToken: string,
  cloudId: string,
  spaceKey: string,
): Promise<ConnectorSyncResult> {
  const changes: ConnectorSyncResult["changes"] = [];
  const base = apiBase(cloudId);

  // Fetch all pages in the space via CQL
  let start = 0;
  const limit = 50;
  let hasMore = true;

  while (hasMore) {
    const cql = `space="${spaceKey}" AND type=page`;
    const params = new URLSearchParams({
      cql,
      limit: String(limit),
      start: String(start),
    });

    const resp = await fetch(`${base}/wiki/rest/api/content/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });

    if (!resp.ok) {
      throw new Error(`Confluence CQL search failed (${resp.status})`);
    }

    const data = await resp.json() as {
      results: Array<{
        id: string;
        title: string;
        type: string;
        _links?: { webui?: string };
        version?: { when?: string };
      }>;
      size: number;
      _links?: { next?: string };
    };

    for (const page of data.results) {
      const modifiedAt = page.version?.when ?? new Date().toISOString();
      changes.push({
        type: "added",
        file: {
          id: `${cloudId}::page:${page.id}`,
          name: `${page.title}.md`,
          mimeType: "text/markdown",
          modifiedAt,
        },
      });
    }

    // Fetch attachments for each page
    for (const page of data.results) {
      const attachments = await listPageAttachments(accessToken, base, page.id);
      for (const att of attachments) {
        changes.push({ type: "added", file: att });
      }
    }

    hasMore = !!data._links?.next;
    start += data.size;
  }

  // Cursor = ISO timestamp of the sync for delta CQL queries
  const newCursor = new Date().toISOString();

  return { changes, newCursor };
}

/**
 * Delta sync — use CQL with lastModified filter to find pages changed since the cursor.
 */
async function deltaSync(
  accessToken: string,
  cloudId: string,
  spaceKey: string,
  cursor: string,
): Promise<ConnectorSyncResult> {
  const changes: ConnectorSyncResult["changes"] = [];
  const base = apiBase(cloudId);

  // CQL date format: "yyyy-MM-dd HH:mm"
  const sinceDate = formatCqlDate(cursor);

  let start = 0;
  const limit = 50;
  let hasMore = true;

  while (hasMore) {
    const cql = `space="${spaceKey}" AND type=page AND lastModified>="${sinceDate}"`;
    const params = new URLSearchParams({
      cql,
      limit: String(limit),
      start: String(start),
    });

    const resp = await fetch(`${base}/wiki/rest/api/content/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });

    if (!resp.ok) {
      throw new Error(`Confluence delta CQL search failed (${resp.status})`);
    }

    const data = await resp.json() as {
      results: Array<{
        id: string;
        title: string;
        type: string;
        version?: { when?: string };
      }>;
      size: number;
      _links?: { next?: string };
    };

    for (const page of data.results) {
      const modifiedAt = page.version?.when ?? new Date().toISOString();
      changes.push({
        type: "modified",
        file: {
          id: `${cloudId}::page:${page.id}`,
          name: `${page.title}.md`,
          mimeType: "text/markdown",
          modifiedAt,
        },
      });
    }

    // Check attachments on modified pages too
    for (const page of data.results) {
      const attachments = await listPageAttachments(accessToken, base, page.id);
      for (const att of attachments) {
        changes.push({ type: "modified", file: att });
      }
    }

    hasMore = !!data._links?.next;
    start += data.size;
  }

  const newCursor = new Date().toISOString();
  return { changes, newCursor };
}

/** List supported attachments on a Confluence page. */
async function listPageAttachments(
  accessToken: string,
  baseUrl: string,
  pageId: string,
): Promise<Array<{ id: string; name: string; mimeType: string; modifiedAt: string; size?: number }>> {
  const attachments: Array<{ id: string; name: string; mimeType: string; modifiedAt: string; size?: number }> = [];

  const resp = await fetch(
    `${baseUrl}/wiki/rest/api/content/${pageId}/child/attachment?limit=100`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
  );

  if (!resp.ok) {
    // Non-critical: log and skip
    logger.warn({ pageId, status: resp.status }, "Failed to list Confluence page attachments");
    return [];
  }

  const data = await resp.json() as {
    results: Array<{
      id: string;
      title: string;
      metadata?: { mediaType?: string };
      extensions?: { mediaType?: string; fileSize?: number };
      version?: { when?: string };
      _links?: { download?: string };
    }>;
  };

  // Extract cloudId from baseUrl
  const cloudIdMatch = baseUrl.match(/\/ex\/confluence\/([^/]+)/);
  const cloudId = cloudIdMatch?.[1] ?? "";

  for (const att of data.results) {
    const mimeType = att.extensions?.mediaType ?? att.metadata?.mediaType ?? "";
    if (!SUPPORTED_ATTACHMENT_MIMES.has(mimeType)) continue;

    const downloadPath = att._links?.download;
    if (!downloadPath) continue;

    const encodedPath = Buffer.from(downloadPath).toString("base64url");
    const entry: { id: string; name: string; mimeType: string; modifiedAt: string; size?: number } = {
      id: `${cloudId}::attachment:${att.id}:${encodedPath}`,
      name: att.title,
      mimeType,
      modifiedAt: att.version?.when ?? new Date().toISOString(),
    };
    if (att.extensions?.fileSize !== undefined) {
      entry.size = att.extensions.fileSize;
    }
    attachments.push(entry);
  }

  return attachments;
}

/** Download a Confluence page as markdown. */
async function downloadPage(
  accessToken: string,
  cloudId: string,
  pageId: string,
): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
  const base = apiBase(cloudId);
  const resp = await fetch(
    `${base}/wiki/rest/api/content/${pageId}?expand=body.storage,version`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
  );

  if (!resp.ok) {
    throw new Error(`Confluence page download failed (${resp.status}): page ${pageId}`);
  }

  const data = await resp.json() as {
    id: string;
    title: string;
    body?: { storage?: { value?: string } };
    version?: { when?: string };
  };

  const storageHtml = data.body?.storage?.value ?? "";
  const markdown = storageToMarkdown(storageHtml);
  const content = `# ${data.title}\n\n${markdown}`;

  return {
    buffer: Buffer.from(content, "utf8"),
    mimeType: "text/markdown",
    name: `${data.title}.md`,
  };
}

/** Download a Confluence attachment binary. */
async function downloadAttachment(
  accessToken: string,
  cloudId: string,
  downloadPath: string,
): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
  const base = apiBase(cloudId);
  const url = `${base}/wiki${downloadPath}`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "follow",
  });

  if (!resp.ok) {
    throw new Error(`Confluence attachment download failed (${resp.status}): ${downloadPath}`);
  }

  const contentType = resp.headers.get("content-type") ?? "application/octet-stream";
  const arrayBuffer = await resp.arrayBuffer();

  // Extract filename from the path
  const pathParts = downloadPath.split("/");
  const name = decodeURIComponent(pathParts[pathParts.length - 1] ?? "attachment");

  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: contentType.split(";")[0]!.trim(),
    name,
  };
}

/** Format an ISO date string to CQL date format: "yyyy-MM-dd HH:mm". */
export function formatCqlDate(isoString: string): string {
  const d = new Date(isoString);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

// Register on import
registerConnector(confluenceAdapter);

export { confluenceAdapter };
