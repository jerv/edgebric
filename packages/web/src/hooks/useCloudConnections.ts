/**
 * React Query hooks for cloud storage connections.
 * Used by IntegrationsPanel for connection management and sync operations.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CloudConnection, CloudSyncFile, CloudFolder, CloudProviderInfo } from "@edgebric/types";

const CONNECTIONS_KEY = ["admin", "cloud-connections"] as const;
const PROVIDERS_KEY = ["admin", "cloud-providers"] as const;

interface ProvidersResponse {
  providers: (CloudProviderInfo & { enabled: boolean })[];
}

interface ConnectionsResponse {
  connections: CloudConnection[];
}

interface ConnectionDetailResponse {
  connection: CloudConnection;
  syncing: boolean;
}

interface SyncFilesResponse {
  files: CloudSyncFile[];
}

interface FoldersResponse {
  folders: CloudFolder[];
}

/** Fetch available cloud providers. */
export function useCloudProviders() {
  return useQuery<ProvidersResponse>({
    queryKey: PROVIDERS_KEY,
    queryFn: async () => {
      const r = await fetch("/api/admin/cloud-connections/providers", { credentials: "same-origin" });
      if (!r.ok) throw new Error("Failed to load providers");
      return r.json() as Promise<ProvidersResponse>;
    },
    staleTime: 60_000,
  });
}

/** Fetch all cloud connections for the current org. */
export function useCloudConnections() {
  return useQuery<ConnectionsResponse>({
    queryKey: CONNECTIONS_KEY,
    queryFn: async () => {
      const r = await fetch("/api/admin/cloud-connections", { credentials: "same-origin" });
      if (!r.ok) throw new Error("Failed to load connections");
      return r.json() as Promise<ConnectionsResponse>;
    },
    refetchInterval: 30_000,
  });
}

/** Fetch a single connection's detail + syncing status. */
export function useCloudConnection(id: string | null) {
  return useQuery<ConnectionDetailResponse>({
    queryKey: [...CONNECTIONS_KEY, id],
    queryFn: async () => {
      const r = await fetch(`/api/admin/cloud-connections/${id}`, { credentials: "same-origin" });
      if (!r.ok) throw new Error("Failed to load connection");
      return r.json() as Promise<ConnectionDetailResponse>;
    },
    enabled: !!id,
    refetchInterval: 10_000,
  });
}

/** Fetch sync files for a connection. */
export function useCloudSyncFiles(connectionId: string | null) {
  return useQuery<SyncFilesResponse>({
    queryKey: [...CONNECTIONS_KEY, connectionId, "files"],
    queryFn: async () => {
      const r = await fetch(`/api/admin/cloud-connections/${connectionId}/files`, { credentials: "same-origin" });
      if (!r.ok) throw new Error("Failed to load sync files");
      return r.json() as Promise<SyncFilesResponse>;
    },
    enabled: !!connectionId,
    refetchInterval: 15_000,
  });
}

/** Fetch folders for the folder picker. */
export function useCloudFolders(connectionId: string | null, parentId?: string) {
  return useQuery<FoldersResponse>({
    queryKey: [...CONNECTIONS_KEY, connectionId, "folders", parentId ?? "root"],
    queryFn: async () => {
      const params = parentId ? `?parentId=${encodeURIComponent(parentId)}` : "";
      const r = await fetch(`/api/admin/cloud-connections/${connectionId}/folders${params}`, { credentials: "same-origin" });
      if (!r.ok) throw new Error("Failed to load folders");
      return r.json() as Promise<FoldersResponse>;
    },
    enabled: !!connectionId,
  });
}

/** Start OAuth flow — returns the auth URL to redirect to. */
export function useConnectProvider() {
  return useMutation({
    mutationFn: async (provider: string) => {
      const r = await fetch("/api/admin/cloud-connections/oauth/authorize", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: "Failed to start OAuth" }));
        throw new Error((body as { error?: string }).error ?? "Failed to start OAuth");
      }
      return r.json() as Promise<{ authUrl: string }>;
    },
  });
}

/** Update a connection's settings. */
export function useUpdateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: {
      id: string;
      displayName?: string;
      folderId?: string;
      folderName?: string;
      syncIntervalMin?: number;
      status?: "active" | "paused";
    }) => {
      const r = await fetch(`/api/admin/cloud-connections/${id}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: "Failed to update" }));
        throw new Error((body as { error?: string }).error ?? "Failed to update");
      }
      return r.json() as Promise<{ connection: CloudConnection }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...CONNECTIONS_KEY] });
    },
  });
}

/** Delete a connection. */
export function useDeleteConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/cloud-connections/${id}`, {
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

/** Trigger a manual sync. */
export function useSyncConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/admin/cloud-connections/${id}/sync`, {
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
      void queryClient.invalidateQueries({ queryKey: [...CONNECTIONS_KEY] });
    },
  });
}
