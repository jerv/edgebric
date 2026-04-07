// ─── Cloud Storage Integrations ──────────────────────────────────────────────

export type CloudProvider = "google_drive" | "onedrive" | "dropbox" | "notion" | "confluence";
export type CloudConnectionStatus = "active" | "disconnected";
export type CloudFolderSyncStatus = "active" | "paused" | "error";
export type CloudSyncFileStatus = "pending" | "synced" | "error" | "deleted";

/** OAuth credentials for a cloud provider (one per user per provider). */
export interface CloudConnection {
  id: string;
  provider: CloudProvider;
  displayName: string;
  orgId: string;
  accountEmail?: string | undefined;
  status: CloudConnectionStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** A folder synced from a cloud connection into a data source. */
export interface CloudFolderSync {
  id: string;
  connectionId: string;
  dataSourceId: string;
  folderId: string;
  folderName: string;
  syncIntervalMin: number;
  status: CloudFolderSyncStatus;
  lastSyncAt?: string | undefined;
  lastError?: string | undefined;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Computed: number of tracked sync files. */
  syncedFileCount?: number | undefined;
  /** Computed: provider from the parent connection. */
  provider?: CloudProvider | undefined;
  /** Computed: account email from the parent connection. */
  accountEmail?: string | undefined;
}

export interface CloudSyncFile {
  id: string;
  folderSyncId: string;
  externalFileId: string;
  externalName: string;
  externalModified?: string | undefined;
  documentId?: string | undefined;
  status: CloudSyncFileStatus;
  lastError?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface CloudFolder {
  id: string;
  name: string;
  path?: string | undefined;
  hasChildren: boolean;
}

/** Provider metadata for the frontend (icon, name, capabilities). */
export interface CloudProviderInfo {
  id: CloudProvider;
  name: string;
  description: string;
  enabled: boolean;
}

/** Available providers with their current support status. */
export const CLOUD_PROVIDERS: CloudProviderInfo[] = [
  { id: "google_drive", name: "Google Drive", description: "Sync files from Google Drive folders", enabled: true },
  { id: "onedrive", name: "OneDrive", description: "Sync files from Microsoft OneDrive", enabled: true },
  { id: "dropbox", name: "Dropbox", description: "Sync files from Dropbox folders", enabled: false },
  { id: "notion", name: "Notion", description: "Sync pages from Notion workspaces", enabled: false },
  { id: "confluence", name: "Confluence", description: "Sync pages from Confluence spaces", enabled: false },
];
