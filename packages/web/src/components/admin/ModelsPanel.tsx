import {
  CheckCircle,
  Circle,
  Loader2,
  Power,
  PowerOff,
  HardDrive,
  MemoryStick,
  Monitor,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { adminLabel } from "@/lib/models";
import {
  useModels,
  useLoadModel,
  useUnloadModel,
  useSwitchModel,
} from "@/hooks/useModels";
import type { InstalledModel, RAMFitResult } from "@edgebric/types";
import { EMBEDDING_MODEL_TAG, checkModelRAMFit } from "@edgebric/types";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(0)} MB`;
}

function RAMBar({ models, embeddingModel, system }: {
  models: InstalledModel[];
  embeddingModel?: InstalledModel;
  system: { ramTotalBytes: number; ramAvailableBytes: number };
}) {
  const ramTotal = system.ramTotalBytes;
  const ramUsed = ramTotal - system.ramAvailableBytes;
  const modelRam = models
    .filter((m) => m.ramUsageBytes)
    .reduce((sum, m) => sum + (m.ramUsageBytes ?? 0), 0);
  const embeddingRam = embeddingModel?.ramUsageBytes ?? 0;
  const otherUsed = Math.max(0, ramUsed - modelRam - embeddingRam);
  const pctOf = (bytes: number) => ramTotal > 0 ? Math.max(0, (bytes / ramTotal) * 100) : 0;
  const percent = ramTotal > 0 ? Math.round((ramUsed / ramTotal) * 100) : 0;

  return (
    <div className="flex items-center gap-3">
      <MemoryStick className="w-4 h-4 text-slate-400 dark:text-gray-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-slate-600 dark:text-gray-400">Memory (RAM)</span>
          <span className="text-slate-500 dark:text-gray-500 font-mono">
            {formatBytes(system.ramAvailableBytes)} available / {formatBytes(ramTotal)} total
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 dark:bg-gray-800 overflow-hidden flex">
          <div className="h-full bg-slate-400 dark:bg-gray-600 transition-all" style={{ width: `${pctOf(otherUsed)}%` }} />
          {embeddingRam > 0 && (
            <div className="h-full bg-cyan-500 dark:bg-cyan-400 transition-all" style={{ width: `${pctOf(embeddingRam)}%` }} />
          )}
          {modelRam > 0 && (
            <div className="h-full bg-blue-500 dark:bg-blue-400 transition-all" style={{ width: `${pctOf(modelRam)}%` }} />
          )}
        </div>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {models.filter((m) => m.ramUsageBytes).map((m) => (
            <span key={m.tag} className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400" />
              {adminLabel(m.tag)} {formatBytes(m.ramUsageBytes!)}
            </span>
          ))}
          {embeddingRam > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 dark:bg-cyan-400" />
              Embeddings {formatBytes(embeddingRam)}
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-gray-400">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-600" />
            Other {formatBytes(otherUsed)}
          </span>
        </div>
      </div>
    </div>
  );
}

function DiskBar({ system }: { system: { diskTotalBytes: number; diskFreeBytes: number } }) {
  const used = system.diskTotalBytes - system.diskFreeBytes;
  const percent = system.diskTotalBytes > 0 ? Math.round((used / system.diskTotalBytes) * 100) : 0;
  const barColor = percent > 90 ? "bg-red-500 dark:bg-red-400" : percent > 70 ? "bg-amber-500 dark:bg-amber-400" : "bg-emerald-500 dark:bg-emerald-400";

  return (
    <div className="flex items-center gap-3">
      <HardDrive className="w-4 h-4 text-slate-400 dark:text-gray-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-slate-600 dark:text-gray-400">Disk</span>
          <span className="text-slate-500 dark:text-gray-500 font-mono">
            {formatBytes(used)} / {formatBytes(system.diskTotalBytes)}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 dark:bg-gray-800 overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${Math.min(percent, 100)}%` }} />
        </div>
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

function ModelCard({ model, isActive, onLoad, onUnload, onSetDefault, loading, ramFit }: {
  model: InstalledModel;
  isActive: boolean;
  onLoad: () => void;
  onUnload: () => void;
  onSetDefault: () => void;
  loading: boolean;
  ramFit?: RAMFitResult;
}) {
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

        {/* Actions — load/unload + set default only */}
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
                <button
                  onClick={onUnload}
                  disabled={loading}
                  className="p-1.5 rounded-lg text-slate-400 dark:text-gray-500 hover:bg-slate-100 dark:hover:bg-gray-800 hover:text-slate-600 dark:hover:text-gray-400 transition-colors"
                  title="Unload from RAM"
                >
                  <PowerOff className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <button
                onClick={onLoad}
                disabled={loading}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
              >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
                Load
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ModelsPanel() {
  const { data, isLoading, isError } = useModels();
  const loadMutation = useLoadModel();
  const unloadMutation = useUnloadModel();
  const switchMutation = useSwitchModel();

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

  const { models, activeModel, system } = data;
  const anyMutating = loadMutation.isPending || unloadMutation.isPending || switchMutation.isPending;

  // Split models by status
  const loadedModels = models.filter((m) => m.status === "loaded" && m.tag !== EMBEDDING_MODEL_TAG);
  const installedModels = models.filter((m) => m.status === "installed" && m.tag !== EMBEDDING_MODEL_TAG);
  const embeddingModel = models.find((m) => m.tag === EMBEDDING_MODEL_TAG && m.status === "loaded");

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-gray-100">AI Models</h1>
          <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
            Load models into memory for instant responses. To install or remove models, use the desktop app.
          </p>
        </div>

        {/* System Resources */}
        <div className="space-y-3 rounded-2xl border border-slate-200 dark:border-gray-800 px-5 py-4">
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-gray-500">System Resources</h2>
          <RAMBar models={loadedModels} embeddingModel={embeddingModel} system={system} />
          <DiskBar system={system} />
        </div>

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
                  onSetDefault={() => switchMutation.mutate(model.tag)}
                  loading={anyMutating}
                  ramFit={checkModelRAMFit(ramGB, system.ramTotalBytes)}
                />
              );
            })}
          </div>
        )}

        {/* Desktop app CTA */}
        <div className="rounded-2xl border border-slate-200 dark:border-gray-800 px-5 py-4">
          <div className="flex items-start gap-3">
            <Monitor className="w-5 h-5 text-slate-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Install & Manage Models</h3>
              <p className="text-xs text-slate-500 dark:text-gray-400">
                Download, install, and delete models from the desktop app.
              </p>
              <div className="flex items-center gap-3 pt-1">
                <a
                  href="edgebric://models"
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Open Edgebric Desktop
                </a>
                <span className="text-slate-300 dark:text-gray-700">|</span>
                <a
                  href="https://edgebric.com/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-slate-500 dark:text-gray-400 hover:underline"
                >
                  Download Edgebric
                </a>
              </div>
            </div>
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
