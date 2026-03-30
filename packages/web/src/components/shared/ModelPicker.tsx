import { useState, useRef, useEffect } from "react";
import { ChevronDown, Loader2, Power, PowerOff, MemoryStick, Settings } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { employeeLabel, adminLabel } from "@/lib/models";
import { useModels, useLoadModel, useUnloadModel, useSwitchModel } from "@/hooks/useModels";
import { useUser } from "@/contexts/UserContext";
import type { InstalledModel } from "@edgebric/types";
import { EMBEDDING_MODEL_TAG } from "@edgebric/types";

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(0)} MB`;
}

function MiniResourceBar({ available, total }: { available: number; total: number }) {
  const used = total - available;
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  const barColor = percent > 90 ? "bg-red-500" : percent > 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <MemoryStick className="w-3 h-3 text-slate-400 dark:text-gray-500" />
      <div className="flex-1 h-1 rounded-full bg-slate-100 dark:bg-gray-800 overflow-hidden">
        <div className={cn("h-full rounded-full", barColor)} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <span className="text-[10px] text-slate-400 dark:text-gray-500 font-mono tabular-nums">
        {formatBytes(available)} free
      </span>
    </div>
  );
}

function ModelRow({ model, isActive, isAdmin, onSwitch, onLoad, onUnload, disabled }: {
  model: InstalledModel;
  isActive: boolean;
  isAdmin: boolean;
  onSwitch: () => void;
  onLoad: () => void;
  onUnload: () => void;
  disabled: boolean;
}) {
  const isLoaded = model.status === "loaded";
  const label = isAdmin ? adminLabel(model.tag) : employeeLabel(model.tag);

  return (
    <div className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-gray-900 transition-colors">
      {/* Status dot + name (clickable to switch) */}
      <button
        onClick={onSwitch}
        disabled={disabled || !isLoaded || isActive}
        className={cn(
          "flex-1 flex items-center gap-2 text-xs text-left min-w-0",
          isActive ? "text-slate-900 dark:text-gray-100 font-medium" : "text-slate-600 dark:text-gray-400",
          (!isLoaded || isActive) && "cursor-default",
        )}
      >
        <span className={cn(
          "w-1.5 h-1.5 rounded-full flex-shrink-0",
          isActive ? "bg-emerald-400" : isLoaded ? "bg-blue-400" : "bg-slate-200 dark:bg-gray-700",
        )} />
        <span className="truncate">{label}</span>
        {isActive && <span className="text-[10px] text-slate-400 dark:text-gray-500 flex-shrink-0">active</span>}
      </button>

      {/* RAM usage */}
      {isLoaded && model.ramUsageBytes && (
        <span className="text-[10px] text-slate-400 dark:text-gray-500 font-mono tabular-nums flex-shrink-0">
          {formatBytes(model.ramUsageBytes)}
        </span>
      )}

      {/* Load/unload button (admin only) */}
      {isAdmin && (
        <>
          {isLoaded ? (
            <button
              onClick={onUnload}
              disabled={disabled}
              className="p-1 rounded text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
              title="Unload from memory"
            >
              <PowerOff className="w-3 h-3" />
            </button>
          ) : (
            <button
              onClick={onLoad}
              disabled={disabled}
              className="p-1 rounded text-slate-400 dark:text-gray-500 hover:text-emerald-500 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
              title="Load into memory"
            >
              <Power className="w-3 h-3" />
            </button>
          )}
        </>
      )}
    </div>
  );
}

export interface ModelPickerProps {
  /** Called when the user switches models and we need to wait for a cold load. */
  onModelLoading?: (loading: boolean) => void;
}

export function ModelPicker({ onModelLoading }: ModelPickerProps) {
  const user = useUser();
  const navigate = useNavigate();
  const isAdmin = user?.isAdmin === true;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useModels();
  const loadMutation = useLoadModel();
  const unloadMutation = useUnloadModel();
  const switchMutation = useSwitchModel();

  const anyMutating = loadMutation.isPending || unloadMutation.isPending || switchMutation.isPending;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!data) return null;

  const { models, activeModel, system } = data;
  const chatModels = models.filter((m) => m.tag !== EMBEDDING_MODEL_TAG);
  const loadedModels = chatModels.filter((m) => m.status === "loaded");
  const installedModels = chatModels.filter((m) => m.status === "installed");

  const activeLabel = isAdmin ? adminLabel(activeModel) : employeeLabel(activeModel);
  const isActiveLoaded = loadedModels.some((m) => m.tag === activeModel);

  const handleLoad = async (tag: string) => {
    onModelLoading?.(true);
    try {
      await loadMutation.mutateAsync(tag);
    } finally {
      onModelLoading?.(false);
    }
    setOpen(false);
  };

  const handleSwitch = (tag: string) => {
    switchMutation.mutate(tag);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={anyMutating}
        className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-400 transition-colors px-2 py-1 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-900"
      >
        <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", isActiveLoaded ? "bg-emerald-400" : "bg-amber-400")} />
        {anyMutating ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <span className="truncate max-w-32">{activeLabel}</span>
        )}
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 bottom-full mb-1 w-64 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-xl shadow-lg z-10 overflow-hidden">
          {/* System RAM bar (admin only) */}
          {isAdmin && (
            <div className="px-3 py-2 border-b border-slate-100 dark:border-gray-800">
              <MiniResourceBar
                available={system.ramAvailableBytes}
                total={system.ramTotalBytes}
              />
            </div>
          )}

          {/* Loaded models */}
          {loadedModels.length > 0 && (
            <div className="py-1">
              <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-gray-500">
                Loaded
              </div>
              {loadedModels.map((m) => (
                <ModelRow
                  key={m.tag}
                  model={m}
                  isActive={m.tag === activeModel}
                  isAdmin={isAdmin}
                  onSwitch={() => handleSwitch(m.tag)}
                  onLoad={() => void handleLoad(m.tag)}
                  onUnload={() => unloadMutation.mutate(m.tag)}
                  disabled={anyMutating}
                />
              ))}
            </div>
          )}

          {/* Installed but not loaded */}
          {isAdmin && installedModels.length > 0 && (
            <div className="py-1 border-t border-slate-100 dark:border-gray-800">
              <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-gray-500">
                Installed
              </div>
              {installedModels.map((m) => (
                <ModelRow
                  key={m.tag}
                  model={m}
                  isActive={m.tag === activeModel}
                  isAdmin={isAdmin}
                  onSwitch={() => handleSwitch(m.tag)}
                  onLoad={() => void handleLoad(m.tag)}
                  onUnload={() => unloadMutation.mutate(m.tag)}
                  disabled={anyMutating}
                />
              ))}
            </div>
          )}

          {/* No models at all */}
          {chatModels.length === 0 && (
            <div className="px-3 py-4 text-xs text-slate-400 dark:text-gray-500 text-center">
              No models installed
            </div>
          )}

          {/* Member: read-only note */}
          {!isAdmin && (
            <div className="px-3 py-2 border-t border-slate-100 dark:border-gray-800 text-[10px] text-slate-400 dark:text-gray-500">
              Model managed by your admin
            </div>
          )}

          {/* Admin: link to settings */}
          {isAdmin && (
            <button
              onClick={() => { setOpen(false); void navigate({ to: "/models" }); }}
              className="w-full flex items-center gap-2 px-3 py-2 border-t border-slate-100 dark:border-gray-800 text-xs text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900 transition-colors"
            >
              <Settings className="w-3 h-3" />
              Manage models
            </button>
          )}
        </div>
      )}
    </div>
  );
}
