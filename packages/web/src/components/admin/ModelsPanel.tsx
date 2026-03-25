import { useState } from "react";
import {
  CheckCircle,
  Circle,
  Loader2,
  Cpu,
  Download,
  Trash2,
  Power,
  PowerOff,
  HardDrive,
  MemoryStick,
  X,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { adminLabel } from "@/lib/models";
import {
  useModels,
  usePullModel,
  useLoadModel,
  useUnloadModel,
  useDeleteModel,
  useSwitchModel,
} from "@/hooks/useModels";
import type { InstalledModel, ModelCatalogEntry, RAMFitResult } from "@edgebric/types";
import { getRecommendedModelTag, EMBEDDING_MODEL_TAG, checkModelRAMFit } from "@edgebric/types";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(0)} MB`;
}

function formatGB(gb: number): string {
  return `${gb.toFixed(1)} GB`;
}

function ResourceBar({ used, total, label, icon: Icon }: {
  used: number;
  total: number;
  label: string;
  icon: typeof MemoryStick;
}) {
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  const barColor = percent > 90 ? "bg-red-500 dark:bg-red-400" : percent > 70 ? "bg-amber-500 dark:bg-amber-400" : "bg-emerald-500 dark:bg-emerald-400";

  return (
    <div className="flex items-center gap-3">
      <Icon className="w-4 h-4 text-slate-400 dark:text-gray-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-slate-600 dark:text-gray-400">{label}</span>
          <span className="text-slate-500 dark:text-gray-500 font-mono">
            {formatBytes(used)} / {formatBytes(total)}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 dark:bg-gray-800 overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${Math.min(percent, 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

function ModelCard({ model, isActive, onLoad, onUnload, onDelete, onSetDefault, loading, ramFit }: {
  model: InstalledModel;
  isActive: boolean;
  onLoad: () => void;
  onUnload: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  loading: boolean;
  ramFit?: RAMFitResult;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isLoaded = model.status === "loaded";
  const isEmbedding = model.tag === EMBEDDING_MODEL_TAG;
  const label = adminLabel(model.tag);
  const catalogEntry = model.catalogEntry;

  return (
    <div className={cn(
      "rounded-2xl border px-5 py-4 transition-colors",
      isActive
        ? "border-slate-900 dark:border-gray-100 bg-slate-900 dark:bg-gray-100"
        : "border-slate-200 dark:border-gray-800",
    )}>
      <div className="flex items-center gap-3">
        {isLoaded ? (
          <CheckCircle className={cn("w-4 h-4 flex-shrink-0", isActive ? "text-white dark:text-gray-900" : "text-emerald-500")} />
        ) : (
          <Circle className="w-4 h-4 flex-shrink-0 text-slate-300 dark:text-gray-600" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("font-medium text-sm", isActive ? "text-white dark:text-gray-900" : "text-slate-900 dark:text-gray-100")}>
              {label}
            </span>
            {isActive && (
              <span className="text-xs bg-white/20 dark:bg-gray-900/20 text-white dark:text-gray-900 px-2 py-0.5 rounded-full font-medium">
                Active
              </span>
            )}
            {isLoaded && !isActive && (
              <span className="text-xs bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full font-medium">
                Loaded
              </span>
            )}
            {!catalogEntry && !isEmbedding && (
              <span className="text-xs bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full font-medium">
                Community
              </span>
            )}
          </div>

          <div className={cn("flex items-center gap-3 text-xs mt-1", isActive ? "text-white/60 dark:text-gray-900/60" : "text-slate-500 dark:text-gray-400")}>
            <span>{formatBytes(model.sizeBytes)} on disk</span>
            {isLoaded && model.ramUsageBytes && (
              <span>{formatBytes(model.ramUsageBytes)} RAM</span>
            )}
            {catalogEntry && <span>{catalogEntry.origin}</span>}
          </div>
          {!isLoaded && ramFit && ramFit.level !== "ok" && (
            <RAMWarningBanner fit={ramFit} />
          )}
        </div>

        {/* Actions */}
        {!isEmbedding && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {isLoaded ? (
              <>
                {!isActive && (
                  <button
                    onClick={onSetDefault}
                    disabled={loading}
                    className={cn(
                      "text-xs px-2.5 py-1 rounded-lg transition-colors",
                      "text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800",
                    )}
                  >
                    Set default
                  </button>
                )}
                {!isActive && (
                  <button
                    onClick={onUnload}
                    disabled={loading}
                    className="p-1.5 rounded-lg text-slate-400 dark:text-gray-500 hover:bg-slate-100 dark:hover:bg-gray-800 hover:text-slate-600 dark:hover:text-gray-400 transition-colors"
                    title="Unload from RAM"
                  >
                    <PowerOff className="w-3.5 h-3.5" />
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={onLoad}
                  disabled={loading}
                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
                >
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
                  Load
                </button>
                {confirmDelete ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { onDelete(); setConfirmDelete(false); }}
                      className="text-xs px-2 py-1 rounded-lg bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="p-1 rounded-lg text-slate-400 dark:text-gray-500 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    disabled={loading}
                    className="p-1.5 rounded-lg text-slate-400 dark:text-gray-500 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                    title="Delete model"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RAMWarningBanner({ fit }: { fit: RAMFitResult }) {
  if (fit.level === "ok") return null;

  const isExceeds = fit.level === "exceeds";
  return (
    <div className={cn(
      "flex items-start gap-2 text-xs rounded-xl px-3 py-2 mt-2",
      isExceeds
        ? "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"
        : "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800",
    )}>
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <span>{fit.message}</span>
    </div>
  );
}

function CatalogCard({ entry, onInstall, installing, recommended, ramFit }: {
  entry: ModelCatalogEntry;
  onInstall: () => void;
  installing: boolean;
  recommended: boolean;
  ramFit: RAMFitResult;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 dark:border-gray-800 px-5 py-4">
      <div className="flex items-center gap-3">
        <Cpu className="w-4 h-4 text-slate-300 dark:text-gray-600 flex-shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-slate-900 dark:text-gray-100">
              {entry.name} · {entry.paramCount}
            </span>
            {recommended && (
              <span className="text-xs bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" />
                Recommended
              </span>
            )}
            {ramFit.level === "exceeds" && (
              <span className="text-xs bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 px-2 py-0.5 rounded-full font-medium">
                Too large
              </span>
            )}
            {ramFit.level === "tight" && (
              <span className="text-xs bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full font-medium">
                Low RAM
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">{entry.description}</p>
          <div className="flex items-center gap-3 text-xs text-slate-400 dark:text-gray-500 mt-1">
            <span>{formatGB(entry.downloadSizeGB)} download</span>
            <span>{formatGB(entry.ramUsageGB)} RAM</span>
            <span>{entry.origin}</span>
          </div>
          <RAMWarningBanner fit={ramFit} />
        </div>

        <button
          onClick={onInstall}
          disabled={installing}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
        >
          {installing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
          Install
        </button>
      </div>
    </div>
  );
}

export function ModelsPanel() {
  const { data, isLoading, isError } = useModels();
  const { pull, cancel, pulling, pullTag, progress } = usePullModel();
  const loadMutation = useLoadModel();
  const unloadMutation = useUnloadModel();
  const deleteMutation = useDeleteModel();
  const switchMutation = useSwitchModel();
  const [customTag, setCustomTag] = useState("");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400 dark:text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading models...
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400 dark:text-gray-500 text-sm">
        Could not reach the AI engine. Make sure Edgebric is fully running.
      </div>
    );
  }

  const { models, catalog, activeModel, system } = data;
  const anyMutating = loadMutation.isPending || unloadMutation.isPending || deleteMutation.isPending || switchMutation.isPending;

  // Split models by status
  const loadedModels = models.filter((m) => m.status === "loaded" && m.tag !== EMBEDDING_MODEL_TAG);
  const installedModels = models.filter((m) => m.status === "installed" && m.tag !== EMBEDDING_MODEL_TAG);

  // Catalog entries not yet installed
  const installedTags = new Set(models.map((m) => m.tag));
  const availableCatalog = catalog.filter((c) => !installedTags.has(c.tag));

  // Hardware recommendation
  const ramGB = system.ramTotalBytes / (1024 ** 3);
  const recommendedTag = getRecommendedModelTag(ramGB);

  const handleCustomInstall = () => {
    const tag = customTag.trim();
    if (!tag) return;
    void pull(tag);
    setCustomTag("");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-gray-100">AI Models</h1>
          <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
            Manage AI models for chat and analysis. Load models into memory for instant responses.
          </p>
        </div>

        {/* System Resources */}
        <div className="space-y-3 rounded-2xl border border-slate-200 dark:border-gray-800 px-5 py-4">
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-gray-500">System Resources</h2>
          <ResourceBar
            icon={MemoryStick}
            label="Memory (RAM)"
            used={system.ramTotalBytes - system.ramAvailableBytes}
            total={system.ramTotalBytes}
          />
          <ResourceBar
            icon={HardDrive}
            label="Disk"
            used={system.diskTotalBytes - system.diskFreeBytes}
            total={system.diskTotalBytes}
          />
        </div>

        {/* Download Progress */}
        {pulling && progress && (
          <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-5 py-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  Downloading {pullTag}
                </span>
              </div>
              <button
                onClick={() => void cancel()}
                className="text-xs px-2 py-1 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors"
              >
                Cancel
              </button>
            </div>
            <div className="h-2 rounded-full bg-amber-200 dark:bg-amber-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-500 dark:bg-amber-400 transition-all"
                style={{ width: `${progress.percent ?? 0}%` }}
              />
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1.5">
              {progress.status}
              {progress.percent !== undefined && ` — ${progress.percent}%`}
            </p>
          </div>
        )}

        {/* Loaded Models */}
        {loadedModels.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-gray-500">
              Loaded in Memory ({loadedModels.length})
            </h2>
            {loadedModels.map((model) => (
              <ModelCard
                key={model.tag}
                model={model}
                isActive={model.tag === activeModel}
                onLoad={() => loadMutation.mutate(model.tag)}
                onUnload={() => unloadMutation.mutate(model.tag)}
                onDelete={() => deleteMutation.mutate(model.tag)}
                onSetDefault={() => switchMutation.mutate(model.tag)}
                loading={anyMutating}
              />
            ))}
          </div>
        )}

        {/* Installed Models */}
        {installedModels.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-gray-500">
              Installed ({installedModels.length})
            </h2>
            {installedModels.map((model) => {
              const ramGB = model.catalogEntry?.ramUsageGB ?? model.sizeBytes / (1024 ** 3) * 1.2;
              return (
                <ModelCard
                  key={model.tag}
                  model={model}
                  isActive={model.tag === activeModel}
                  onLoad={() => loadMutation.mutate(model.tag)}
                  onUnload={() => unloadMutation.mutate(model.tag)}
                  onDelete={() => deleteMutation.mutate(model.tag)}
                  onSetDefault={() => switchMutation.mutate(model.tag)}
                  loading={anyMutating}
                  ramFit={checkModelRAMFit(ramGB, system.ramTotalBytes)}
                />
              );
            })}
          </div>
        )}

        {/* Available from Catalog */}
        {availableCatalog.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-gray-500">
              Available Models
            </h2>
            {availableCatalog.map((entry) => (
              <CatalogCard
                key={entry.tag}
                entry={entry}
                onInstall={() => void pull(entry.tag)}
                installing={pulling && pullTag === entry.tag}
                recommended={entry.tag === recommendedTag}
                ramFit={checkModelRAMFit(entry.ramUsageGB, system.ramTotalBytes)}
              />
            ))}
          </div>
        )}

        {/* Custom Model */}
        <div className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-gray-500">
            Custom Model
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCustomInstall(); }}
              placeholder="e.g., mistral:7b"
              className="flex-1 text-sm px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100 placeholder-slate-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-gray-100"
            />
            <button
              onClick={handleCustomInstall}
              disabled={!customTag.trim() || pulling}
              className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Install
            </button>
          </div>
          <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>Custom models are not officially tested with Edgebric. Quality may vary.</span>
          </div>
        </div>

        {/* Embedding note */}
        <p className="text-xs text-slate-400 dark:text-gray-500">
          Embedding model: <span className="font-mono">nomic-embed-text</span> — automatically managed, not switchable.
        </p>
      </div>
    </div>
  );
}
