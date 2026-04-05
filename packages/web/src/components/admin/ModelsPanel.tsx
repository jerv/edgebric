import { useState, useEffect, useRef } from "react";
import {
  Loader2,
  Power,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { adminLabel } from "@/lib/models";
import {
  useModels,
  useLoadModel,
  useUnloadModel,
  useSwitchModel,
} from "@/hooks/useModels";
import { RAMBar, formatBytes } from "@/components/shared/ResourceBars";
import Logo from "@/components/shared/Logo";
import type { InstalledModel, RAMFitResult, ModelCapabilities } from "@edgebric/types";
import { EMBEDDING_MODEL_TAG, checkModelRAMFit } from "@edgebric/types";

function CapabilityBadges({ capabilities, huggingFaceUrl }: { capabilities?: ModelCapabilities; huggingFaceUrl?: string }) {
  if (!capabilities) return null;
  return (
    <>
      {capabilities.vision && (
        <span title="Can analyze images and screenshots" className="text-[11px] bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 px-1.5 py-0.5 rounded-full font-medium">
          &#x1f441; Vision
        </span>
      )}
      {capabilities.toolUse && (
        <span title="Can use tools like search and file management" className="text-[11px] bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 rounded-full font-medium">
          &#x1f527; Tools
        </span>
      )}
      {capabilities.reasoning && (
        <span title="Enhanced step-by-step reasoning" className="text-[11px] bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800 px-1.5 py-0.5 rounded-full font-medium">
          &#x1f9e0; Reasoning
        </span>
      )}
      {huggingFaceUrl && (
        <a href={huggingFaceUrl} target="_blank" rel="noopener noreferrer" title="View on HuggingFace" className="text-[11px] bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded-full font-medium no-underline hover:underline">
          &#x1f517;
        </a>
      )}
    </>
  );
}

function RAMWarningBanner({ fit }: { fit: RAMFitResult }) {
  if (fit.level === "ok") return null;

  const isExceeds = fit.level === "exceeds";
  return (
    <div className={cn(
      "flex items-start gap-2 text-xs rounded-xl px-3 py-2 mt-1",
      isExceeds
        ? "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"
        : "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800",
    )}>
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <span>{fit.message}</span>
    </div>
  );
}

function ModelRow({ model, isActive, onLoad, onUnload, onSetDefault, loading, ramFit }: {
  model: InstalledModel;
  isActive: boolean;
  onLoad: () => void;
  onUnload: () => void;
  onSetDefault: () => void;
  loading: boolean;
  ramFit?: RAMFitResult;
}) {
  const [confirmUnload, setConfirmUnload] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>();
  const isLoaded = model.status === "loaded";
  const isEmbedding = model.tag === EMBEDDING_MODEL_TAG;
  const label = adminLabel(model.tag);
  const catalogEntry = model.catalogEntry;

  // Reset confirmation state after 3 seconds
  useEffect(() => {
    if (confirmUnload) {
      confirmTimer.current = setTimeout(() => setConfirmUnload(false), 3000);
      return () => clearTimeout(confirmTimer.current);
    }
  }, [confirmUnload]);

  function handleStopClick() {
    if (isActive && !confirmUnload) {
      setConfirmUnload(true);
      return;
    }
    setConfirmUnload(false);
    onUnload();
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-gray-800 last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-slate-900 dark:text-gray-100">
            {label}
          </span>
          {isLoaded && (
            <span className="text-[11px] bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 rounded-full font-medium">
              {isActive ? "Active" : "Running"}
            </span>
          )}
          {!isLoaded && ramFit && ramFit.level === "exceeds" && (
            <span className="text-[11px] bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 px-1.5 py-0.5 rounded-full font-medium">
              Too large
            </span>
          )}
          {!isLoaded && ramFit && ramFit.level === "tight" && (
            <span className="text-[11px] bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded-full font-medium">
              Low RAM
            </span>
          )}
          <CapabilityBadges capabilities={catalogEntry?.capabilities ?? model.capabilities} huggingFaceUrl={catalogEntry?.huggingFaceUrl} />
        </div>
        <span className="text-xs text-slate-500 dark:text-gray-400">
          {catalogEntry?.family ? `by ${catalogEntry.family} · ` : ""}
          {isLoaded && model.ramUsageBytes ? `${formatBytes(model.ramUsageBytes)} RAM · ` : ""}
          {formatBytes(model.sizeBytes)} on disk
        </span>
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
                  className="text-xs px-2.5 py-1 rounded-lg text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Set default
                </button>
              )}
              <button
                onClick={handleStopClick}
                disabled={loading}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-lg transition-colors",
                  confirmUnload
                    ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 font-medium"
                    : "text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800",
                )}
              >
                {confirmUnload ? "Confirm stop?" : "Stop"}
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
  const allChat = models.filter((m) => m.tag !== EMBEDDING_MODEL_TAG);
  const loadedModels = allChat.filter((m) => m.status === "loaded");
  const installedModels = allChat.filter((m) => m.status === "installed");
  const embeddingModel = models.find((m) => m.tag === EMBEDDING_MODEL_TAG && m.status === "loaded");

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* Header with back button */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.history.back()}
            className="p-1.5 rounded-lg text-slate-400 dark:text-gray-500 hover:bg-slate-100 dark:hover:bg-gray-800 hover:text-slate-600 dark:hover:text-gray-400 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-gray-100">AI Models</h1>
            <p className="text-sm text-slate-500 dark:text-gray-400 mt-0.5">
              Load models into memory for instant responses. To install or remove models, use the desktop app.
            </p>
          </div>
        </div>

        {/* System Resources */}
        <div className="space-y-3 rounded-2xl border border-slate-200 dark:border-gray-800 px-5 py-4">
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-gray-500">System Resources</h2>
          <RAMBar models={loadedModels} embeddingModel={embeddingModel} system={system} />
        </div>

        {/* Your Models — single list like desktop */}
        {allChat.length > 0 && (
          <div className="rounded-2xl border border-slate-200 dark:border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-gray-800">
              <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-gray-500">
                Your Models
              </h2>
            </div>
            {loadedModels.map((model) => (
              <ModelRow
                key={model.tag}
                model={model}
                isActive={model.tag === activeModel}
                onLoad={() => loadMutation.mutate(model.tag)}
                onUnload={() => unloadMutation.mutate(model.tag)}
                onSetDefault={() => switchMutation.mutate(model.tag)}
                loading={anyMutating}
              />
            ))}
            {installedModels.map((model) => {
              const ramGB = model.catalogEntry?.ramUsageGB ?? model.sizeBytes / (1024 ** 3) * 1.2;
              return (
                <ModelRow
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
            <Logo className="w-5 h-5 rounded mt-0.5 flex-shrink-0" />
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
                  href="https://edgebric.com"
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

        {/* Explainer */}
        <p className="text-xs text-slate-400 dark:text-gray-500 leading-relaxed">
          Models power everything AI does — answering questions, searching your documents, and more. Loading a model keeps it ready in memory (RAM), so unload ones you're not using to free up resources.
        </p>
      </div>
    </div>
  );
}
