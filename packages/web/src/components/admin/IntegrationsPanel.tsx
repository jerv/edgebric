import { useState } from "react";
import {
  ArrowLeft,
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

// ─── Brand Logos (inline SVG) ────────────────────────────────────────────────

function GoogleDriveLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5l5.4 9.35z" fill="#0066DA"/>
      <path d="M43.65 25.15L29.9 1.35c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5l16.15-28z" fill="#00AC47"/>
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 57.7c.8-1.4 1.2-2.95 1.2-4.5H59.8l6.1 11.8 7.65 11.8z" fill="#EA4335"/>
      <path d="M43.65 25.15L57.4 1.35a9.39 9.39 0 0 0-4.5-1.35H34.4c-1.6 0-3.15.45-4.5 1.35l13.75 23.8z" fill="#00832D"/>
      <path d="M59.8 53.15h-32.3L13.75 76.95c1.35.8 2.9 1.25 4.5 1.25h22.5c1.6 0 3.15-.45 4.5-1.25l14.55-23.8z" fill="#2684FC"/>
      <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25.15l16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5L73.4 26.5z" fill="#FFBA00"/>
    </svg>
  );
}

function OneDriveLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M14.22 9.59c.46-.79 1.17-1.4 2.03-1.73a3.98 3.98 0 0 1 2.66-.05A5.49 5.49 0 0 0 9.4 6.1a4.46 4.46 0 0 1 4.82 3.49z" fill="#0364B8"/>
      <path d="M14.22 9.59A4.46 4.46 0 0 0 9.4 6.1a4.47 4.47 0 0 0-3.99 2.47A3.97 3.97 0 0 0 1 12.48a3.97 3.97 0 0 0 3.97 3.97h8.46l.79-6.86z" fill="#0078D4"/>
      <path d="M18.91 7.81a3.98 3.98 0 0 0-2.66.05 3.98 3.98 0 0 0-2.03 1.73l.79 6.86h5.96A3.01 3.01 0 0 0 24 13.44a3.01 3.01 0 0 0-3.01-3.01 2.96 2.96 0 0 0-.76.1l-.14-.04a3.98 3.98 0 0 0-1.18-2.68z" fill="#1490DF"/>
      <path d="M13.43 16.45H4.97A3.97 3.97 0 0 0 8.94 20.42h10.03A3.01 3.01 0 0 0 22 17.41a3.01 3.01 0 0 0-1.03-2.27l-7.54 1.31z" fill="#28A8EA"/>
    </svg>
  );
}

function DropboxLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 2l6 3.75L6 9.5 0 5.75zm12 0l6 3.75-6 3.75-6-3.75zM0 13.25L6 9.5l6 3.75L6 17zm18-3.75l6 3.75-6 3.75-6-3.75zM6 18.25l6-3.75 6 3.75-6 3.75z" fill="#0061FF"/>
    </svg>
  );
}

function NotionLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.46 2.33l10.17-.75c1.25-.1 1.57.03 2.36.58l3.25 2.27c.53.38.7.48.7 1.02v14.8c0 .82-.3 1.37-1.35 1.45l-12.17.72c-.78.05-1.16-.08-1.57-.58L3.03 18.1c-.45-.6-.64-.99-.64-1.65V3.82c0-.83.3-1.38 1.07-1.49zm10.57 2.25c.08.43 0 .84 0 .84l-6.87.42v11.26c0 .6-.26.89-.84.93-.6.04-.83-.32-.83-.32l-1.78-2.36c-.24-.33-.37-.72-.37-1.16V5.41c0-.7.27-1.08.85-1.12l9.84-.71zm-.17 1.64l-5.93.36v9.81l4.26-.26c.47-.03.84-.28.84-.85V6.6c0-.2-.07-.34-.17-.38z" className="fill-slate-900 dark:fill-gray-100"/>
    </svg>
  );
}

function ConfluenceLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.26 16.8c-.28.46-.6 1-.8 1.36a.62.62 0 0 0 .2.84l3.37 2.1a.62.62 0 0 0 .85-.19c.17-.3.42-.73.72-1.24 2.07-3.5 4.13-3.07 7.88-1.5l3.44 1.44a.62.62 0 0 0 .82-.33l1.66-3.72a.62.62 0 0 0-.31-.8c-.92-.4-2.76-1.18-3.47-1.48-5.2-2.22-9.64-2.61-14.36 3.52z" fill="#2684FF"/>
      <path d="M22.74 7.2c.28-.46.6-1 .8-1.36a.62.62 0 0 0-.2-.84l-3.37-2.1a.62.62 0 0 0-.85.19c-.17.3-.42.73-.72 1.24-2.07 3.5-4.13 3.07-7.88 1.5L7.08 4.39a.62.62 0 0 0-.82.33L4.6 8.44a.62.62 0 0 0 .31.8c.92.4 2.76 1.18 3.47 1.48 5.2 2.22 9.64 2.61 14.36-3.52z" fill="#2684FF"/>
    </svg>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  google_drive: "Google Drive",
  onedrive: "OneDrive / SharePoint",
  dropbox: "Dropbox",
  notion: "Notion",
  confluence: "Confluence",
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

function ProviderLogo({ provider, className }: { provider: string; className?: string }) {
  const size = className ?? "w-5 h-5";
  switch (provider) {
    case "google_drive": return <GoogleDriveLogo className={size} />;
    case "onedrive": return <OneDriveLogo className={size} />;
    case "dropbox": return <DropboxLogo className={size} />;
    case "notion": return <NotionLogo className={size} />;
    case "confluence": return <ConfluenceLogo className={size} />;
    default: return <div className={cn(size, "rounded bg-slate-200 dark:bg-gray-700")} />;
  }
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
                      <ProviderLogo provider={conn.provider} className="w-5 h-5 flex-shrink-0" />
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
              <div className="space-y-2">
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
                        <ProviderLogo provider={provider.id} className="w-5 h-5" />
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
