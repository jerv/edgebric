/**
 * Cloud Drive sync section for the data source detail page.
 *
 * Shows synced folders and lets users add new Google Drive folder syncs.
 * If the user hasn't connected Google Drive yet, prompts them to authorize.
 */
import { useState } from "react";
import {
  Loader2,
  ChevronRight,
  Trash2,
  RefreshCw,
  Pause,
  Play,
  ExternalLink,
  FolderOpen,
  AlertTriangle,
} from "lucide-react";
// cn imported from utils if needed for conditional classnames
import {
  useCloudProviders,
  useCloudConnections,
  useCloudFolders,
  useConnectProvider,
  useFolderSyncs,
  useCreateFolderSync,
  useDeleteFolderSync,
  useSyncFolderSync,
  useUpdateFolderSync,
} from "@/hooks/useCloudConnections";
import { ProviderLogo } from "@/components/shared/ProviderLogos";
import type { CloudFolder, CloudFolderSync } from "@edgebric/types";

// ─── Folder Picker Dialog ────────────────────────────────────────────────────

function FolderPickerDialog({ connectionId, onSelect, onClose }: {
  connectionId: string;
  onSelect: (folder: CloudFolder) => void;
  onClose: () => void;
}) {
  const [parentStack, setParentStack] = useState<{ id: string; name: string }[]>([]);
  const currentParentId = parentStack.length > 0 ? parentStack[parentStack.length - 1]!.id : undefined;
  const { data, isLoading } = useCloudFolders(connectionId, currentParentId);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-950 rounded-2xl shadow-xl p-5 max-w-md w-full mx-4 max-h-[70vh] flex flex-col">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100 mb-1">Select a folder to sync</h3>
        <p className="text-xs text-slate-500 dark:text-gray-400 mb-3">
          Files in this folder will be synced into this data source.
        </p>

        {parentStack.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400 mb-2 flex-wrap">
            <button
              onClick={() => setParentStack([])}
              className="hover:text-slate-900 dark:hover:text-gray-100 transition-colors"
            >
              Root
            </button>
            {parentStack.map((item, idx) => (
              <span key={item.id} className="flex items-center gap-1">
                <ChevronRight className="w-3 h-3" />
                <button
                  onClick={() => setParentStack(parentStack.slice(0, idx + 1))}
                  className="hover:text-slate-900 dark:hover:text-gray-100 transition-colors"
                >
                  {item.name}
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto border border-slate-200 dark:border-gray-800 rounded-xl">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400 dark:text-gray-500" />
            </div>
          ) : !data?.folders.length ? (
            <div className="text-center py-8 text-xs text-slate-400 dark:text-gray-500">
              No folders found
            </div>
          ) : (
            data.folders.map((folder) => (
              <div
                key={folder.id}
                className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 dark:border-gray-800 last:border-b-0 hover:bg-slate-50 dark:hover:bg-gray-900"
              >
                <FolderOpen className="w-4 h-4 text-slate-400 dark:text-gray-500 flex-shrink-0" />
                <span className="text-sm text-slate-700 dark:text-gray-300 flex-1 truncate">{folder.name}</span>
                <button
                  onClick={() => onSelect(folder)}
                  className="text-xs px-2 py-1 rounded bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-slate-800 dark:hover:bg-gray-200 transition-colors flex-shrink-0"
                >
                  Select
                </button>
                {folder.hasChildren && (
                  <button
                    onClick={() => setParentStack([...parentStack, { id: folder.id, name: folder.name }])}
                    className="text-xs px-2 py-1 rounded border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
                  >
                    Open
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end mt-3">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Folder Sync Row ─────────────────────────────────────────────────────────

function FolderSyncRow({ sync }: { sync: CloudFolderSync }) {
  const deleteMutation = useDeleteFolderSync();
  const syncMutation = useSyncFolderSync();
  const updateMutation = useUpdateFolderSync();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isPaused = sync.status === "paused";
  const isError = sync.status === "error";

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-gray-800">
      <ProviderLogo provider="google_drive" className="w-4 h-4 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-900 dark:text-gray-100 truncate">
            {sync.folderName}
          </span>
          {isPaused && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-500">
              Paused
            </span>
          )}
          {isError && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400">
              Error
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-gray-400 mt-0.5 flex-wrap">
          {sync.accountEmail && <span className="truncate">{sync.accountEmail}</span>}
          {sync.syncedFileCount !== undefined && sync.syncedFileCount > 0 && (
            <>
              <span className="text-slate-300 dark:text-gray-600">&middot;</span>
              <span>{sync.syncedFileCount} files</span>
            </>
          )}
          {sync.lastSyncAt && (
            <>
              <span className="text-slate-300 dark:text-gray-600">&middot;</span>
              <span>Synced {new Date(sync.lastSyncAt).toLocaleString()}</span>
            </>
          )}
        </div>
        {isError && sync.lastError && (
          <p className="text-xs text-red-500 dark:text-red-400 mt-1 truncate">{sync.lastError}</p>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={() => updateMutation.mutate({ id: sync.id, status: isPaused ? "active" : "paused" })}
          className="p-2 rounded-lg text-slate-400 dark:text-gray-500 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          title={isPaused ? "Resume" : "Pause"}
        >
          {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => syncMutation.mutate(sync.id)}
          disabled={syncMutation.isPending}
          className="p-2 rounded-lg text-slate-400 dark:text-gray-500 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          title="Sync now"
        >
          {syncMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
        </button>
        {confirmDelete ? (
          <span className="flex items-center gap-1 text-xs">
            <button
              onClick={() => deleteMutation.mutate(sync.id)}
              className="text-red-600 dark:text-red-400 hover:underline py-1 px-2"
            >
              Remove
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-slate-400 dark:text-gray-500 hover:underline py-1 px-2"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="p-2 rounded-lg text-slate-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
            title="Remove sync"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Section ────────────────────────────────────────────────────────────

export function CloudDriveSyncSection({ dataSourceId }: { dataSourceId: string }) {
  const { data: providersData } = useCloudProviders();
  const { data: connectionsData } = useCloudConnections();
  const { data: folderSyncsData } = useFolderSyncs(dataSourceId);
  const connectMutation = useConnectProvider();
  const createSyncMutation = useCreateFolderSync();

  const [pickerConnectionId, setPickerConnectionId] = useState<string | null>(null);

  const providers = providersData?.providers ?? [];
  const connections = connectionsData?.connections ?? [];
  const folderSyncs = folderSyncsData?.folderSyncs ?? [];

  // Only show if at least one provider is enabled
  const enabledProviders = providers.filter((p) => p.enabled);
  if (enabledProviders.length === 0) return null;

  const hasConnection = connections.length > 0;

  function handleConnectDrive() {
    // Use the first enabled provider (Google Drive)
    const provider = enabledProviders[0];
    if (!provider) return;
    connectMutation.mutate(
      { provider: provider.id, returnTo: `/library?ds=${dataSourceId}` },
      {
        onSuccess: (data) => {
          window.open(data.authUrl, "_blank");
        },
      },
    );
  }

  function handleFolderSelected(folder: CloudFolder) {
    if (!pickerConnectionId) return;
    createSyncMutation.mutate(
      {
        connectionId: pickerConnectionId,
        dataSourceId,
        folderId: folder.id,
        folderName: folder.name,
      },
      {
        onSuccess: () => setPickerConnectionId(null),
      },
    );
  }

  return (
    <div className="space-y-2">
      {/* Existing folder syncs */}
      {folderSyncs.map((sync) => (
        <FolderSyncRow key={sync.id} sync={sync} />
      ))}

      {/* Add sync button */}
      {hasConnection ? (
        <button
          onClick={() => {
            // If user has one connection, go straight to folder picker
            // If multiple, could show a picker — for now use first
            const conn = connections[0];
            if (conn) setPickerConnectionId(conn.id);
          }}
          className="flex items-center gap-2 w-full px-4 py-3 rounded-xl border border-dashed border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 hover:bg-slate-50 dark:hover:bg-gray-900 transition-colors text-left"
        >
          <ProviderLogo provider="google_drive" className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm text-slate-600 dark:text-gray-400">
            Sync a Google Drive folder
          </span>
        </button>
      ) : (
        <button
          onClick={handleConnectDrive}
          disabled={connectMutation.isPending}
          className="flex items-center gap-2 w-full px-4 py-3 rounded-xl border border-dashed border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 hover:bg-slate-50 dark:hover:bg-gray-900 transition-colors text-left"
        >
          <ProviderLogo provider="google_drive" className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm text-slate-600 dark:text-gray-400">
            {connectMutation.isPending ? "Connecting..." : "Connect Google Drive to sync files"}
          </span>
          {connectMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 ml-auto" />}
          {!connectMutation.isPending && <ExternalLink className="w-3.5 h-3.5 text-slate-300 dark:text-gray-600 ml-auto" />}
        </button>
      )}

      {connectMutation.isError && (
        <div className="flex items-start gap-2 text-xs rounded-xl px-3 py-2 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{connectMutation.error.message}</span>
        </div>
      )}

      {/* Folder picker dialog */}
      {pickerConnectionId && (
        <FolderPickerDialog
          connectionId={pickerConnectionId}
          onSelect={handleFolderSelected}
          onClose={() => setPickerConnectionId(null)}
        />
      )}
    </div>
  );
}
