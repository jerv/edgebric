/**
 * Google Drive connector — implements CloudConnectorAdapter.
 *
 * Uses raw fetch() against Google APIs (no googleapis SDK).
 * Scopes: drive.readonly + email (read-only file access + account identity).
 *
 * OAuth flow: separate from OIDC login. This authorizes Edgebric to
 * access the admin's Google Drive, not to authenticate them.
 */
import { config } from "../config.js";
import { registerConnector } from "./registry.js";
import { logger } from "../lib/logger.js";
import type { CloudConnectorAdapter, ConnectorSyncResult, OAuthTokens } from "./types.js";
import type { CloudFolder } from "@edgebric/types";

const SCOPES = "https://www.googleapis.com/auth/drive.readonly email";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/** File types we can ingest. Everything else is skipped. */
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  // Google Docs are exported as PDF
  "application/vnd.google-apps.document",
]);

/** Google Workspace types that need export instead of direct download. */
const EXPORT_MIME_TYPES: Record<string, string> = {
  "application/vnd.google-apps.document": "application/pdf",
};

function getClientId(): string {
  const id = config.cloud.google.clientId;
  if (!id) throw new Error("GOOGLE_DRIVE_CLIENT_ID not configured");
  return id;
}

function getClientSecret(): string {
  const secret = config.cloud.google.clientSecret;
  if (!secret) throw new Error("GOOGLE_DRIVE_CLIENT_SECRET not configured");
  return secret;
}

const googleDriveAdapter: CloudConnectorAdapter = {
  provider: "google_drive",

  getAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: getClientId(),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      state,
      access_type: "offline",
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
      throw new Error(`Google token exchange failed (${resp.status}): ${body}`);
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
      const userResp = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (userResp.ok) {
        const userInfo = await userResp.json() as { email?: string };
        accountEmail = userInfo.email;
      }
    } catch {
      logger.warn("Failed to fetch Google userinfo for connected account");
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
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Google token refresh failed (${resp.status}): ${body}`);
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
    const parent = parentId || "root";
    const q = `mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;
    const params = new URLSearchParams({
      q,
      fields: "files(id,name)",
      orderBy: "name",
      pageSize: "100",
    });

    const resp = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Google Drive listFolders failed (${resp.status}): ${body}`);
    }

    const data = await resp.json() as { files: Array<{ id: string; name: string }> };

    return data.files.map((f) => ({
      id: f.id,
      name: f.name,
      hasChildren: true, // Google Drive doesn't tell us upfront; UI lazy-loads children
    }));
  },

  async getChanges(accessToken: string, folderId: string, cursor: string | null): Promise<ConnectorSyncResult> {
    if (!cursor) {
      // Initial sync — full listing of the folder
      return initialSync(accessToken, folderId);
    }

    // Delta sync — use Changes API
    return deltaSync(accessToken, folderId, cursor);
  },

  async downloadFile(accessToken: string, fileId: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
    // First get file metadata to check if it needs export
    const metaResp = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=name,mimeType`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!metaResp.ok) {
      throw new Error(`Google Drive file metadata failed (${metaResp.status})`);
    }

    const meta = await metaResp.json() as { name: string; mimeType: string };
    const exportMime = EXPORT_MIME_TYPES[meta.mimeType];

    let downloadResp: Response;
    let finalMime: string;
    let finalName: string;

    if (exportMime) {
      // Google Workspace file — export to PDF
      const params = new URLSearchParams({ mimeType: exportMime });
      downloadResp = await fetch(
        `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?${params.toString()}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      finalMime = exportMime;
      // Append .pdf extension for Google Docs
      finalName = meta.name.endsWith(".pdf") ? meta.name : `${meta.name}.pdf`;
    } else {
      // Regular file — direct download
      downloadResp = await fetch(
        `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      finalMime = meta.mimeType;
      finalName = meta.name;
    }

    if (!downloadResp.ok) {
      throw new Error(`Google Drive download failed (${downloadResp.status}): ${finalName}`);
    }

    const arrayBuffer = await downloadResp.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: finalMime,
      name: finalName,
    };
  },
};

/**
 * Initial full sync — list all supported files in the folder and get a
 * starting page token for subsequent delta syncs.
 */
async function initialSync(accessToken: string, folderId: string): Promise<ConnectorSyncResult> {
  const changes: ConnectorSyncResult["changes"] = [];
  let pageToken: string | undefined;

  // List all files in the folder
  do {
    const q = `'${folderId}' in parents and trashed=false`;
    const params = new URLSearchParams({
      q,
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size)",
      pageSize: "100",
      ...(pageToken && { pageToken }),
    });

    const resp = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      throw new Error(`Google Drive file listing failed (${resp.status})`);
    }

    const data = await resp.json() as {
      nextPageToken?: string;
      files: Array<{
        id: string;
        name: string;
        mimeType: string;
        modifiedTime: string;
        size?: string;
      }>;
    };

    for (const file of data.files) {
      if (!SUPPORTED_MIME_TYPES.has(file.mimeType)) continue;

      changes.push({
        type: "added",
        file: {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          modifiedAt: file.modifiedTime,
          size: file.size ? parseInt(file.size, 10) : undefined,
        },
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  // Get the starting page token for future delta syncs
  const tokenResp = await fetch(`${DRIVE_API}/changes/startPageToken`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!tokenResp.ok) {
    throw new Error(`Google Drive startPageToken failed (${tokenResp.status})`);
  }

  const tokenData = await tokenResp.json() as { startPageToken: string };

  return {
    changes,
    newCursor: tokenData.startPageToken,
  };
}

/**
 * Delta sync — use the Changes API to get only what changed since the last sync.
 * Filters to changes within the target folder.
 */
async function deltaSync(accessToken: string, folderId: string, cursor: string): Promise<ConnectorSyncResult> {
  const changes: ConnectorSyncResult["changes"] = [];
  let pageToken: string | null = cursor;
  let newStartPageToken: string = cursor;

  while (pageToken) {
    const params = new URLSearchParams({
      pageToken,
      spaces: "drive",
      fields: "nextPageToken,newStartPageToken,changes(removed,fileId,file(id,name,mimeType,modifiedTime,size,parents,trashed))",
      pageSize: "100",
    });

    const resp = await fetch(`${DRIVE_API}/changes?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      throw new Error(`Google Drive changes API failed (${resp.status})`);
    }

    const data = await resp.json() as {
      nextPageToken?: string;
      newStartPageToken?: string;
      changes: Array<{
        removed?: boolean;
        fileId: string;
        file?: {
          id: string;
          name: string;
          mimeType: string;
          modifiedTime: string;
          size?: string;
          parents?: string[];
          trashed?: boolean;
        };
      }>;
    };

    for (const change of data.changes) {
      // Filter to changes in our target folder
      if (change.file?.parents && !change.file.parents.includes(folderId)) continue;

      if (change.removed || change.file?.trashed) {
        changes.push({
          type: "deleted",
          file: {
            id: change.fileId,
            name: change.file?.name ?? "",
            mimeType: change.file?.mimeType ?? "",
            modifiedAt: change.file?.modifiedTime ?? new Date().toISOString(),
          },
        });
        continue;
      }

      if (!change.file) continue;
      if (!SUPPORTED_MIME_TYPES.has(change.file.mimeType)) continue;

      // Determine if this is an add or modify based on whether we've seen it before
      // (The sync engine handles this — we report all non-deleted changes as "modified"
      // since the sync file store tracks initial adds vs updates)
      changes.push({
        type: "modified",
        file: {
          id: change.file.id,
          name: change.file.name,
          mimeType: change.file.mimeType,
          modifiedAt: change.file.modifiedTime,
          size: change.file.size ? parseInt(change.file.size, 10) : undefined,
        },
      });
    }

    if (data.newStartPageToken) {
      newStartPageToken = data.newStartPageToken;
    }
    pageToken = data.nextPageToken ?? null;
  }

  return {
    changes,
    newCursor: newStartPageToken,
  };
}

// Register on import
registerConnector(googleDriveAdapter);

export { googleDriveAdapter };
