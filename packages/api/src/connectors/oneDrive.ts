/**
 * OneDrive / SharePoint connector — implements CloudConnectorAdapter.
 *
 * Uses raw fetch() against Microsoft Graph API (no @microsoft/microsoft-graph-client SDK).
 * Scopes: Files.Read.All offline_access User.Read (read-only file access + offline refresh + identity).
 *
 * OAuth flow: separate from OIDC login. This authorizes Edgebric to
 * access the admin's OneDrive/SharePoint, not to authenticate them.
 */
import { config } from "../config.js";
import { registerConnector } from "./registry.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import { logger } from "../lib/logger.js";
import type { CloudConnectorAdapter, ConnectorSyncResult, OAuthTokens } from "./types.js";
import type { CloudFolder } from "@edgebric/types";

const SCOPES = "Files.Read.All offline_access User.Read";
const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_API = "https://graph.microsoft.com/v1.0";

/** File types we can ingest. Everything else is skipped. */
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);

/** File extensions we support (OneDrive often provides these more reliably than MIME types). */
const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md"]);

/**
 * Resolve OneDrive OAuth credentials.
 * Priority: org-level custom credentials > env vars > shipped defaults.
 * Returns `isCustom: true` when org provided their own (affects redirect URI).
 */
export function getOnedriveCredentials(): { clientId: string; clientSecret: string; isCustom: boolean } {
  const integrationCfg = getIntegrationConfig();
  if (integrationCfg.onedriveClientId && integrationCfg.onedriveClientSecret) {
    return {
      clientId: integrationCfg.onedriveClientId,
      clientSecret: integrationCfg.onedriveClientSecret,
      isCustom: true,
    };
  }
  const clientId = config.cloud.onedrive.clientId;
  const clientSecret = config.cloud.onedrive.clientSecret;
  if (!clientId || !clientSecret) throw new Error("OneDrive OAuth credentials not configured");
  return { clientId, clientSecret, isCustom: false };
}

function getClientId(): string {
  return getOnedriveCredentials().clientId;
}

function getClientSecret(): string {
  return getOnedriveCredentials().clientSecret;
}

/** Check if a file is supported by MIME type or extension. */
function isSupportedFile(mimeType: string | undefined, name: string): boolean {
  if (mimeType && SUPPORTED_MIME_TYPES.has(mimeType)) return true;
  const ext = name.lastIndexOf(".") >= 0 ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  return SUPPORTED_EXTENSIONS.has(ext);
}

const oneDriveAdapter: CloudConnectorAdapter = {
  provider: "onedrive",

  getAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: getClientId(),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      state,
      prompt: "consent", // Force refresh token issuance
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: getClientId(),
        client_secret: getClientSecret(),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`OneDrive token exchange failed (${resp.status}): ${body}`);
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
      const userResp = await fetch(`${GRAPH_API}/me`, {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (userResp.ok) {
        const userInfo = await userResp.json() as { mail?: string; userPrincipalName?: string };
        accountEmail = userInfo.mail || userInfo.userPrincipalName;
      }
    } catch {
      logger.warn("Failed to fetch Microsoft userinfo for connected account");
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
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: getClientId(),
        client_secret: getClientSecret(),
        grant_type: "refresh_token",
        scope: SCOPES,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`OneDrive token refresh failed (${resp.status}): ${body}`);
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

  async listFolders(accessToken: string, parentId?: string): Promise<CloudFolder[]> {
    // OneDrive uses "root" for the top-level or an item ID for subfolders
    const endpoint = parentId
      ? `${GRAPH_API}/me/drive/items/${encodeURIComponent(parentId)}/children`
      : `${GRAPH_API}/me/drive/root/children`;

    // Filter to folders only
    const params = new URLSearchParams({
      $filter: "folder ne null",
      $select: "id,name,folder",
      $orderby: "name",
      $top: "100",
    });

    const resp = await fetch(`${endpoint}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`OneDrive listFolders failed (${resp.status}): ${body}`);
    }

    const data = await resp.json() as {
      value: Array<{ id: string; name: string; folder?: { childCount: number } }>;
    };

    return data.value.map((f) => ({
      id: f.id,
      name: f.name,
      hasChildren: (f.folder?.childCount ?? 0) > 0,
    }));
  },

  async getChanges(accessToken: string, folderId: string, cursor: string | null): Promise<ConnectorSyncResult> {
    if (!cursor) {
      // Initial sync — full listing of the folder
      return initialSync(accessToken, folderId);
    }

    // Delta sync — use the stored delta link
    return deltaSync(accessToken, folderId, cursor);
  },

  async downloadFile(accessToken: string, fileId: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
    // Get file metadata first
    const metaResp = await fetch(
      `${GRAPH_API}/me/drive/items/${encodeURIComponent(fileId)}?$select=name,file`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!metaResp.ok) {
      throw new Error(`OneDrive file metadata failed (${metaResp.status})`);
    }

    const meta = await metaResp.json() as {
      name: string;
      file?: { mimeType?: string };
    };

    // Download file content
    const downloadResp = await fetch(
      `${GRAPH_API}/me/drive/items/${encodeURIComponent(fileId)}/content`,
      { headers: { Authorization: `Bearer ${accessToken}` }, redirect: "follow" },
    );

    if (!downloadResp.ok) {
      throw new Error(`OneDrive download failed (${downloadResp.status}): ${meta.name}`);
    }

    const arrayBuffer = await downloadResp.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: meta.file?.mimeType ?? "application/octet-stream",
      name: meta.name,
    };
  },
};

/**
 * Initial full sync — list all supported files in the folder and get a
 * delta link for subsequent incremental syncs.
 */
async function initialSync(accessToken: string, folderId: string): Promise<ConnectorSyncResult> {
  const changes: ConnectorSyncResult["changes"] = [];
  let nextLink: string | undefined;

  // List all files in the folder (non-recursive, matching Google Drive behavior)
  let url = `${GRAPH_API}/me/drive/items/${encodeURIComponent(folderId)}/children?$select=id,name,file,lastModifiedDateTime,size&$top=200`;

  do {
    const resp = await fetch(nextLink ?? url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      throw new Error(`OneDrive file listing failed (${resp.status})`);
    }

    const data = await resp.json() as {
      "@odata.nextLink"?: string;
      value: Array<{
        id: string;
        name: string;
        file?: { mimeType?: string };
        lastModifiedDateTime: string;
        size?: number;
      }>;
    };

    for (const item of data.value) {
      // Skip folders (no file property means it's a folder or other non-file item)
      if (!item.file) continue;

      const mimeType = item.file.mimeType ?? "";
      if (!isSupportedFile(mimeType, item.name)) continue;

      changes.push({
        type: "added",
        file: {
          id: item.id,
          name: item.name,
          mimeType,
          modifiedAt: item.lastModifiedDateTime,
          size: item.size,
        },
      });
    }

    nextLink = data["@odata.nextLink"];
  } while (nextLink);

  // Get the initial delta link for future incremental syncs.
  // We request a delta on the folder and page through all results to get the deltaLink.
  const deltaLink = await getDeltaLink(accessToken, folderId);

  return {
    changes,
    newCursor: deltaLink,
  };
}

/**
 * Delta sync — use Microsoft Graph's delta API to get only what changed
 * since the last sync. The cursor is the full deltaLink URL from the previous sync.
 */
async function deltaSync(accessToken: string, folderId: string, cursor: string): Promise<ConnectorSyncResult> {
  const changes: ConnectorSyncResult["changes"] = [];
  let url: string | undefined = cursor;
  let newDeltaLink: string = cursor;

  while (url) {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      // If the delta link expired, fall back to a full re-sync
      if (resp.status === 410) {
        logger.warn({ folderId }, "OneDrive delta link expired, falling back to full sync");
        return initialSync(accessToken, folderId);
      }
      throw new Error(`OneDrive delta API failed (${resp.status})`);
    }

    const data = await resp.json() as {
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
      value: Array<{
        id: string;
        name: string;
        file?: { mimeType?: string };
        lastModifiedDateTime?: string;
        size?: number;
        deleted?: { state: string };
        parentReference?: { id?: string };
      }>;
    };

    for (const item of data.value) {
      // Handle deletions
      if (item.deleted) {
        changes.push({
          type: "deleted",
          file: {
            id: item.id,
            name: item.name ?? "",
            mimeType: "",
            modifiedAt: item.lastModifiedDateTime ?? new Date().toISOString(),
          },
        });
        continue;
      }

      // Filter to items in the target folder (delta returns all descendants)
      if (item.parentReference?.id && item.parentReference.id !== folderId) continue;

      // Skip non-file items
      if (!item.file) continue;

      const mimeType = item.file.mimeType ?? "";
      if (!isSupportedFile(mimeType, item.name)) continue;

      // Report all non-deleted changes as "modified" (sync engine tracks add vs update)
      changes.push({
        type: "modified",
        file: {
          id: item.id,
          name: item.name,
          mimeType,
          modifiedAt: item.lastModifiedDateTime ?? new Date().toISOString(),
          size: item.size,
        },
      });
    }

    if (data["@odata.deltaLink"]) {
      newDeltaLink = data["@odata.deltaLink"];
    }
    url = data["@odata.nextLink"];
  }

  return {
    changes,
    newCursor: newDeltaLink,
  };
}

/**
 * Request a delta on the folder and page through all current items to obtain
 * the deltaLink (cursor) for future incremental syncs. We discard the items
 * themselves since initialSync already listed them.
 */
async function getDeltaLink(accessToken: string, folderId: string): Promise<string> {
  let url: string | undefined =
    `${GRAPH_API}/me/drive/items/${encodeURIComponent(folderId)}/delta?$select=id`;

  while (url) {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      throw new Error(`OneDrive delta link request failed (${resp.status})`);
    }

    const data = await resp.json() as {
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };

    if (data["@odata.deltaLink"]) {
      return data["@odata.deltaLink"];
    }

    url = data["@odata.nextLink"];
  }

  // Should never happen — Graph API always returns a deltaLink on the last page
  throw new Error("OneDrive delta API did not return a deltaLink");
}

// Register on import
registerConnector(oneDriveAdapter);

export { oneDriveAdapter };
