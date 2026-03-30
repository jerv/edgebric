/**
 * Cloud connector adapter interface.
 *
 * Each cloud storage provider (Google Drive, OneDrive, Dropbox, etc.)
 * implements this interface to provide a uniform sync contract.
 */
import type { CloudProvider, CloudFolder } from "@edgebric/types";

export interface ConnectorFileInfo {
  /** Provider-specific unique file ID. */
  id: string;
  /** Filename from the provider. */
  name: string;
  /** MIME type of the file. */
  mimeType: string;
  /** ISO timestamp of last modification. */
  modifiedAt: string;
  /** File size in bytes (if available). */
  size?: number | undefined;
}

export interface ConnectorChange {
  type: "added" | "modified" | "deleted";
  file: ConnectorFileInfo;
}

export interface ConnectorSyncResult {
  /** List of changes since last sync. */
  changes: ConnectorChange[];
  /** Opaque cursor token for the next delta call. */
  newCursor: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string | undefined;
  expiresAt?: string | undefined;
  accountEmail?: string | undefined;
  scopes?: string | undefined;
}

export interface CloudConnectorAdapter {
  readonly provider: CloudProvider;

  /** Build the OAuth authorization URL. */
  getAuthUrl(state: string, redirectUri: string): string;

  /** Exchange an authorization code for tokens. */
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;

  /** Refresh an expired access token. Returns new access token + optional new expiry. */
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt?: string | undefined }>;

  /** List folders the connected account can see (for folder picker UI). */
  listFolders(accessToken: string, parentId?: string): Promise<CloudFolder[]>;

  /** Get changes since the last cursor. Pass null cursor for initial full sync. */
  getChanges(accessToken: string, folderId: string, cursor: string | null): Promise<ConnectorSyncResult>;

  /** Download a file's content. */
  downloadFile(accessToken: string, fileId: string): Promise<{ buffer: Buffer; mimeType: string; name: string }>;
}
