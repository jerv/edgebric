// ─── Cloud Storage Integrations ──────────────────────────────────────────────

export type CloudProvider = "google_drive" | "onedrive" | "dropbox" | "notion" | "confluence";
export type CloudConnectionStatus = "active" | "paused" | "error" | "disconnected";
export type CloudSyncFileStatus = "pending" | "synced" | "error" | "deleted";

export interface CloudConnection {
  id: string;
  provider: CloudProvider;
  displayName: string;
  dataSourceId: string;
  orgId: string;
  accountEmail?: string | undefined;
  folderId?: string | undefined;
  folderName?: string | undefined;
  syncIntervalMin: number;
  status: CloudConnectionStatus;
  lastSyncAt?: string | undefined;
  lastError?: string | undefined;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Computed: number of documents in the linked data source. */
  documentCount?: number | undefined;
  /** Computed: number of tracked sync files. */
  syncedFileCount?: number | undefined;
}

export interface CloudSyncFile {
  id: string;
  connectionId: string;
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
  { id: "onedrive", name: "OneDrive / SharePoint", description: "Sync files from Microsoft OneDrive or SharePoint", enabled: false },
  { id: "dropbox", name: "Dropbox", description: "Sync files from Dropbox folders", enabled: false },
  { id: "notion", name: "Notion", description: "Sync pages from Notion workspaces", enabled: false },
  { id: "confluence", name: "Confluence", description: "Sync pages from Confluence spaces", enabled: false },
];
