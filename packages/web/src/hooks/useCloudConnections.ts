/**
 * React Query hooks for cloud storage connections and folder syncs.
 *
 * Connections = OAuth credentials (managed from org settings).
 * Folder syncs = links a cloud folder to a data source (managed from data source UI).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CloudConnection, CloudFolderSync, CloudSyncFile, CloudFolder, CloudProviderInfo } from "@edgebric/types";

const CONNECTIONS_KEY = ["cloud-connections"] as const;
const PROVIDERS_KEY = ["cloud-providers"] as const;
const FOLDER_SYNCS_KEY = ["cloud-folder-syncs"] as const;

// ─── Connection hooks (org settings) ────────────────────────────────────────

interface ProvidersResponse {
  providers: (CloudProviderInfo & { enabled: boolean })[];
}

interface ConnectionsResponse {
  connections: CloudConnection[];
}

/** Fetch available cloud providers. */
export function useCloudProviders() {
  return useQuery<ProvidersResponse>({
    queryKey: PROVIDERS_KEY,
    queryFn: async () => {
      const r = await fetch("/api/cloud-connections/providers", { credentials: "same-origin" });
      if (!r.ok) throw new Error("Failed to load providers");
      return r.json() as Promise<ProvidersResponse>;
    },
    staleTime: 60_000,
  });
}

/** Fetch all cloud connections for the current org/user. */
export function useCloudConnections() {
  return useQuery<ConnectionsResponse>({
    queryKey: CONNECTIONS_KEY,
    queryFn: async () => {
      const r = await fetch("/api/cloud-connections", { credentials: "same-origin" });
      if (!r.ok) throw new Error("Failed to load connections");
      return r.json() as Promise<ConnectionsResponse>;
    },
    refetchInterval: 30_000,
  });
}

/** Start OAuth flow — returns the auth URL to redirect to. */
export function useConnectProvider() {
  return useMutation({
    mutationFn: async ({ provider, returnTo }: { provider: string; returnTo?: string }) => {
      const r = await fetch("/api/cloud-connections/oauth/authorize", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, returnTo }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: "Failed to start OAuth" }));
        throw new Error((body as { error?: string }).error ?? "Failed to start OAuth");
      }
      return r.json() as Promise<{ authUrl: string }>;
    },
  });
}

/** Delete a connection. */
export function useDeleteConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/cloud-connections/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: "Failed to delete" }));
        throw new Error((body as { error?: string }).error ?? "Failed to delete");
      }
      return r.json() as Promise<{ deleted: boolean }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...CONNECTIONS_KEY] });
    },
  });
}

/** Fetch folders for a connection's folder picker. */
export function useCloudFolders(connectionId: string | null, parentId?: string) {
  return useQuery<{ folders: CloudFolder[] }>({
    queryKey: [...CONNECTIONS_KEY, connectionId, "folders", parentId ?? "root"],
    queryFn: async () => {
      const params = parentId ? `?parentId=${encodeURIComponent(parentId)}` : "";
      const r = await fetch(`/api/cloud-connections/${connectionId}/folders${params}`, { credentials: "same-origin" });
      if (!r.ok) throw new Error("Failed to load folders");
      return r.json() as Promise<{ folders: CloudFolder[] }>;
    },
    enabled: !!connectionId,
  });
}

// ─── Folder sync hooks (data source UI) ─────────────────────────────────────

/** Fetch folder syncs for a data source. */
export function useFolderSyncs(dataSourceId: string | null) {
  return useQuery<{ folderSyncs: CloudFolderSync[] }>({
    queryKey: [...FOLDER_SYNCS_KEY, dataSourceId],
    queryFn: async () => {
      const r = await fetch(`/api/cloud-connections/folder-syncs/by-data-source/${dataSourceId}`, { credentials: "same-origin" });
      if (!r.ok) throw new Error("Failed to load folder syncs");
      return r.json() as Promise<{ folderSyncs: CloudFolderSync[] }>;
    },
    enabled: !!dataSourceId,
    refetchInterval: 15_000,
  });
}

/** Create a folder sync (link a cloud folder to a data source). */
export function useCreateFolderSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      connectionId: string;
      dataSourceId: string;
      folderId: string;
      folderName: string;
      syncIntervalMin?: number;
    }) => {
      const r = await fetch("/api/cloud-connections/folder-syncs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: "Failed to create folder sync" }));
        throw new Error((body as { error?: string }).error ?? "Failed to create folder sync");
      }
      return r.json() as Promise<{ folderSync: CloudFolderSync }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...FOLDER_SYNCS_KEY] });
    },
  });
}

/** Update a folder sync's settings. */
export function useUpdateFolderSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: {
      id: string;
      syncIntervalMin?: number;
      status?: "active" | "paused";
    }) => {
      const r = await fetch(`/api/cloud-connections/folder-syncs/${id}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: "Failed to update" }));
        throw new Error((body as { error?: string }).error ?? "Failed to update");
      }
      return r.json() as Promise<{ folderSync: CloudFolderSync }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...FOLDER_SYNCS_KEY] });
    },
  });
}

/** Delete a folder sync. */
export function useDeleteFolderSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/cloud-connections/folder-syncs/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: "Failed to delete" }));
        throw new Error((body as { error?: string }).error ?? "Failed to delete");
      }
      return r.json() as Promise<{ deleted: boolean }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...FOLDER_SYNCS_KEY] });
    },
  });
}

/** Trigger a manual sync on a folder sync. */
export function useSyncFolderSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/cloud-connections/folder-syncs/${id}/sync`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: "Sync failed" }));
        throw new Error((body as { error?: string }).error ?? "Sync failed");
      }
      return r.json() as Promise<{ synced: boolean; added: number; modified: number; deleted: number; errors: number }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...FOLDER_SYNCS_KEY] });
    },
  });
}

/** Fetch sync files for a folder sync. */
export function useFolderSyncFiles(folderSyncId: string | null) {
  return useQuery<{ files: CloudSyncFile[] }>({
    queryKey: [...FOLDER_SYNCS_KEY, folderSyncId, "files"],
    queryFn: async () => {
      const r = await fetch(`/api/cloud-connections/folder-syncs/${folderSyncId}/files`, { credentials: "same-origin" });
      if (!r.ok) throw new Error("Failed to load sync files");
      return r.json() as Promise<{ files: CloudSyncFile[] }>;
    },
    enabled: !!folderSyncId,
    refetchInterval: 15_000,
  });
}
