import { useState } from "react";
import {
  ArrowLeft,
  Plus,
  RefreshCw,
  Trash2,
  Loader2,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Pause,
  Play,
  AlertTriangle,
  FileText,
  Cloud,
} from "lucide-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  useCloudProviders,
  useCloudConnections,
  useCloudConnection,
  useCloudSyncFiles,
  useCloudFolders,
  useConnectProvider,
  useUpdateConnection,
  useDeleteConnection,
  useSyncConnection,
} from "@/hooks/useCloudConnections";
import type { CloudConnection, CloudFolder, CloudProvider } from "@edgebric/types";

// ─── Provider Icons ──────────────────────────────────────────────────────────

const PROVIDER_ICONS: Record<string, string> = {
  google_drive: "Google Drive",
  onedrive: "OneDrive",
  dropbox: "Dropbox",
  notion: "Notion",
  confluence: "Confluence",
};

function providerLabel(provider: string): string {
  return PROVIDER_ICONS[provider] ?? provider;
}

// ─── Status Badge ────────────────────────────────────────────────────────────

function ConnectionStatusBadge({ status }: { status: CloudConnection["status"] }) {
  const config: Record<string, { bg: string; dot: string; label: string }> = {
    active: { bg: "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400", dot: "bg-green-500", label: "Active" },
    paused: { bg: "bg-slate-50 dark:bg-gray-900 text-slate-600 dark:text-gray-400", dot: "bg-slate-400 dark:bg-gray-500", label: "Paused" },
    error: { bg: "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400", dot: "bg-red-500", label: "Error" },
    disconnected: { bg: "bg-slate-50 dark:bg-gray-900 text-slate-500 dark:text-gray-500", dot: "bg-slate-300 dark:bg-gray-600", label: "Disconnected" },
  };
  const c = config[status] ?? config.error!;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium", c.bg)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", c.dot)} />
      {c.label}
    </span>
  );
}

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
          Choose which folder's files will be synced to Edgebric.
        </p>

        {/* Breadcrumb */}
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

        {/* Folder list */}
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
                className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 dark:border-gray-800 last:border-b-0 hover:bg-slate-50 dark:hover:bg-gray-900 transition-colors group"
              >
                <FolderOpen className="w-4 h-4 text-slate-400 dark:text-gray-500 flex-shrink-0" />
                <span className="flex-1 text-sm text-slate-700 dark:text-gray-300 truncate">{folder.name}</span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onSelect(folder)}
                    className="text-xs px-2 py-1 rounded-lg bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-slate-700 dark:hover:bg-gray-300 transition-colors"
                  >
                    Select
                  </button>
                  {folder.hasChildren && (
                    <button
                      onClick={() => setParentStack([...parentStack, { id: folder.id, name: folder.name }])}
                      className="text-xs px-2 py-1 rounded-lg border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      Open
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end mt-3">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirmation Dialog ──────────────────────────────────────────────

function DeleteConnectionDialog({ connection, onConfirm, onClose, pending }: {
  connection: CloudConnection;
  onConfirm: () => void;
  onClose: () => void;
  pending: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-950 rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100 mb-2">
          Disconnect {providerLabel(connection.provider)}?
        </h3>
        <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed mb-1">
          This will remove the connection to <span className="font-medium">{connection.displayName}</span>.
        </p>
        <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed mb-5">
          Previously synced documents will be archived but remain available for existing conversations.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {pending && <Loader2 className="w-3 h-3 animate-spin" />}
            Disconnect
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Connection Detail View ──────────────────────────────────────────────────

function ConnectionDetail({ connectionId, onBack }: {
  connectionId: string;
  onBack: () => void;
}) {
  const { data, isLoading } = useCloudConnection(connectionId);
  const { data: filesData } = useCloudSyncFiles(connectionId);
  const syncMutation = useSyncConnection();
  const updateMutation = useUpdateConnection();
  const deleteMutation = useDeleteConnection();
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showFiles, setShowFiles] = useState(false);

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400 dark:text-gray-500" />
      </div>
    );
  }

  const { connection: conn, syncing } = data;
  const files = filesData?.files ?? [];
  const syncedCount = files.filter((f) => f.status === "synced").length;
  const errorCount = files.filter((f) => f.status === "error").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-slate-500 dark:text-gray-400" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-slate-900 dark:text-gray-100 truncate">
            {conn.displayName}
          </h2>
          <p className="text-xs text-slate-500 dark:text-gray-400">
            {providerLabel(conn.provider)}
            {conn.accountEmail && ` \u00B7 ${conn.accountEmail}`}
          </p>
        </div>
        <ConnectionStatusBadge status={conn.status} />
      </div>

      {/* Error banner */}
      {conn.lastError && (
        <div className="flex items-start gap-2 text-xs rounded-xl px-3 py-2 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{conn.lastError}</span>
        </div>
      )}

      {/* Sync status card */}
      <div className="border border-slate-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-900 dark:text-gray-100">Sync</h3>
          <div className="flex items-center gap-2">
            {conn.status === "active" ? (
              <button
                onClick={() => updateMutation.mutate({ id: conn.id, status: "paused" })}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
              >
                <Pause className="w-3 h-3" />
                Pause
              </button>
            ) : conn.status === "paused" ? (
              <button
                onClick={() => updateMutation.mutate({ id: conn.id, status: "active" })}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
              >
                <Play className="w-3 h-3" />
                Resume
              </button>
            ) : null}
            <button
              onClick={() => syncMutation.mutate(conn.id)}
              disabled={syncing || syncMutation.isPending || !conn.folderId}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-slate-700 dark:hover:bg-gray-300 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("w-3 h-3", (syncing || syncMutation.isPending) && "animate-spin")} />
              {syncing || syncMutation.isPending ? "Syncing..." : "Sync Now"}
            </button>
          </div>
        </div>

        {syncMutation.isSuccess && (
          <div className="text-xs text-green-600 dark:text-green-400">
            Sync complete: {syncMutation.data.added} added, {syncMutation.data.modified} updated, {syncMutation.data.deleted} removed
            {syncMutation.data.errors > 0 && `, ${syncMutation.data.errors} errors`}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-gray-100">{syncedCount}</div>
            <div className="text-xs text-slate-500 dark:text-gray-400">Files synced</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-gray-100">{errorCount}</div>
            <div className="text-xs text-slate-500 dark:text-gray-400">Errors</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-gray-100">{conn.syncIntervalMin}m</div>
            <div className="text-xs text-slate-500 dark:text-gray-400">Interval</div>
          </div>
        </div>

        {conn.lastSyncAt && (
          <p className="text-xs text-slate-400 dark:text-gray-500">
            Last synced {new Date(conn.lastSyncAt).toLocaleString()}
          </p>
        )}
      </div>

      {/* Folder selection */}
      <div className="border border-slate-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-medium text-slate-900 dark:text-gray-100">Synced Folder</h3>
        {conn.folderName ? (
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-slate-400 dark:text-gray-500" />
            <span className="text-sm text-slate-700 dark:text-gray-300 flex-1">{conn.folderName}</span>
            <button
              onClick={() => setShowFolderPicker(true)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
            >
              Change
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowFolderPicker(true)}
            className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-dashed border-slate-300 dark:border-gray-700 text-slate-500 dark:text-gray-400 hover:border-slate-400 dark:hover:border-gray-600 hover:text-slate-700 dark:hover:text-gray-300 transition-colors w-full justify-center"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Choose a folder to sync
          </button>
        )}
      </div>

      {/* Sync interval */}
      <div className="border border-slate-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-medium text-slate-900 dark:text-gray-100">Sync Interval</h3>
        <div className="flex items-center gap-3">
          <select
            value={conn.syncIntervalMin}
            onChange={(e) => updateMutation.mutate({ id: conn.id, syncIntervalMin: parseInt(e.target.value, 10) })}
            className="text-sm border border-slate-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600"
          >
            <option value="5">Every 5 minutes</option>
            <option value="15">Every 15 minutes</option>
            <option value="30">Every 30 minutes</option>
            <option value="60">Every hour</option>
            <option value="360">Every 6 hours</option>
            <option value="1440">Once a day</option>
          </select>
          <span className="text-xs text-slate-400 dark:text-gray-500">
            How often Edgebric checks for new or updated files
          </span>
        </div>
      </div>

      {/* Synced files list */}
      {files.length > 0 && (
        <div className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowFiles(!showFiles)}
            className="flex items-center gap-2 w-full px-4 py-3 text-sm font-medium text-slate-900 dark:text-gray-100 hover:bg-slate-50 dark:hover:bg-gray-900 transition-colors"
          >
            {showFiles ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Synced Files ({files.length})
          </button>
          {showFiles && (
            <div className="border-t border-slate-200 dark:border-gray-800 max-h-64 overflow-y-auto">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 dark:border-gray-800 last:border-b-0"
                >
                  <FileText className="w-3.5 h-3.5 text-slate-400 dark:text-gray-500 flex-shrink-0" />
                  <span className="text-xs text-slate-700 dark:text-gray-300 flex-1 truncate">{file.externalName}</span>
                  <span className={cn(
                    "text-xs",
                    file.status === "synced" && "text-green-600 dark:text-green-400",
                    file.status === "error" && "text-red-600 dark:text-red-400",
                    file.status === "pending" && "text-amber-600 dark:text-amber-400",
                  )}>
                    {file.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Danger zone */}
      <div className="border border-red-200 dark:border-red-900 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-red-700 dark:text-red-400">Disconnect</h3>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              Remove this connection and revoke access
            </p>
          </div>
          <button
            onClick={() => setShowDelete(true)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Disconnect
          </button>
        </div>
      </div>

      {/* Dialogs */}
      {showFolderPicker && (
        <FolderPickerDialog
          connectionId={conn.id}
          onSelect={(folder) => {
            updateMutation.mutate({ id: conn.id, folderId: folder.id, folderName: folder.name });
            setShowFolderPicker(false);
          }}
          onClose={() => setShowFolderPicker(false)}
        />
      )}
      {showDelete && (
        <DeleteConnectionDialog
          connection={conn}
          pending={deleteMutation.isPending}
          onConfirm={() => {
            deleteMutation.mutate(conn.id, {
              onSuccess: () => onBack(),
            });
          }}
          onClose={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export function IntegrationsPanel() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { connectionId?: string };
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    search.connectionId ?? null,
  );

  const { data: providersData, isLoading: providersLoading } = useCloudProviders();
  const { data: connectionsData, isLoading: connectionsLoading } = useCloudConnections();
  const connectMutation = useConnectProvider();

  const providers = providersData?.providers ?? [];
  const connections = connectionsData?.connections ?? [];
  const enabledProviders = providers.filter((p) => p.enabled);

  function handleConnect(provider: CloudProvider) {
    connectMutation.mutate(provider, {
      onSuccess: (data) => {
        // Redirect to provider's OAuth consent screen
        window.location.href = data.authUrl;
      },
    });
  }

  // Show connection detail view
  if (selectedConnectionId) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">
          <ConnectionDetail
            connectionId={selectedConnectionId}
            onBack={() => setSelectedConnectionId(null)}
          />
        </div>
      </div>
    );
  }

  const isLoading = providersLoading || connectionsLoading;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => void navigate({ to: "/" })}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-slate-500 dark:text-gray-400" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-gray-100">Integrations</h1>
            <p className="text-xs text-slate-500 dark:text-gray-400">
              Connect cloud storage to automatically sync files into Edgebric
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400 dark:text-gray-500" />
          </div>
        ) : (
          <>
            {/* Active connections */}
            {connections.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-medium text-slate-900 dark:text-gray-100">Connected</h2>
                <div className="space-y-2">
                  {connections.map((conn) => (
                    <button
                      key={conn.id}
                      onClick={() => setSelectedConnectionId(conn.id)}
                      className="flex items-center gap-3 w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 hover:bg-slate-50 dark:hover:bg-gray-900 transition-colors text-left"
                    >
                      <Cloud className="w-5 h-5 text-slate-400 dark:text-gray-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-900 dark:text-gray-100 truncate">
                            {conn.displayName}
                          </span>
                          <ConnectionStatusBadge status={conn.status} />
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                          <span>{providerLabel(conn.provider)}</span>
                          {conn.folderName && (
                            <>
                              <span className="text-slate-300 dark:text-gray-600">&middot;</span>
                              <span className="truncate">{conn.folderName}</span>
                            </>
                          )}
                          {conn.syncedFileCount !== undefined && conn.syncedFileCount > 0 && (
                            <>
                              <span className="text-slate-300 dark:text-gray-600">&middot;</span>
                              <span>{conn.syncedFileCount} files</span>
                            </>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 dark:text-gray-600" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Available providers */}
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-slate-900 dark:text-gray-100">
                {connections.length > 0 ? "Add another connection" : "Connect a service"}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {providers.map((provider) => {
                  const isConnecting = connectMutation.isPending && connectMutation.variables === provider.id;
                  return (
                    <button
                      key={provider.id}
                      onClick={() => provider.enabled ? handleConnect(provider.id) : undefined}
                      disabled={!provider.enabled || connectMutation.isPending}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors",
                        provider.enabled
                          ? "border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 hover:bg-slate-50 dark:hover:bg-gray-900"
                          : "border-slate-100 dark:border-gray-900 opacity-50 cursor-not-allowed",
                      )}
                    >
                      <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                        <Cloud className="w-4 h-4 text-slate-500 dark:text-gray-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-900 dark:text-gray-100">{provider.name}</span>
                          {!provider.enabled && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-500">
                              Coming soon
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-gray-400 truncate">{provider.description}</p>
                      </div>
                      {provider.enabled && (
                        isConnecting ? (
                          <Loader2 className="w-4 h-4 animate-spin text-slate-400 dark:text-gray-500" />
                        ) : (
                          <ExternalLink className="w-4 h-4 text-slate-300 dark:text-gray-600" />
                        )
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Info */}
            {enabledProviders.length > 0 && (
              <div className="text-xs text-slate-400 dark:text-gray-500 leading-relaxed">
                Connecting a service opens their authorization page in your browser.
                Edgebric only requests read-only access to the folders you choose.
                Files are encrypted and stored locally — they never leave your network.
              </div>
            )}

            {connectMutation.isError && (
              <div className="flex items-start gap-2 text-xs rounded-xl px-3 py-2 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>{connectMutation.error.message}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
