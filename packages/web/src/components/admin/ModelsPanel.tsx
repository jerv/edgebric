import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Circle, Loader2, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { modelMeta } from "@/lib/models";

interface MILMModel {
  id: string;
  readyToUse: boolean;
}

interface ModelsResponse {
  models: MILMModel[];
  activeModel: string;
}

export function ModelsPanel() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<ModelsResponse>({
    queryKey: ["admin", "models"],
    queryFn: () =>
      fetch("/api/admin/models", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error("Failed to load models");
        return r.json() as Promise<ModelsResponse>;
      }),
    refetchInterval: (query) => {
      // Keep polling while any model is not ready (download in progress)
      const data = query.state.data;
      if (!data) return false;
      return data.models.some((m) => !m.readyToUse) ? 5000 : false;
    },
  });

  const switchMutation = useMutation({
    mutationFn: (modelId: string) =>
      fetch("/api/admin/models/active", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to switch model");
        return r.json() as Promise<{ activeModel: string }>;
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "models"] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading models...
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400 text-sm">
        Could not reach mILM. Make sure the edge node is running.
      </div>
    );
  }

  const { models, activeModel } = data;
  // Sort: ready first, then by id
  const sorted = [...models].sort((a, b) => {
    if (a.readyToUse !== b.readyToUse) return a.readyToUse ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Models</h1>
          <p className="text-sm text-slate-500 mt-1">
            Select the active chat model. Changes take effect immediately — no restart needed.
          </p>
        </div>

        <div className="space-y-3">
          {sorted.map((model) => {
            const meta = modelMeta(model.id);
            const name = meta.family ? `${meta.family} — ${meta.label}` : model.id;
            const desc = meta.spec ? `${meta.spec} parameter model` : "";
            const isActive = model.id === activeModel;
            const isSwitching = switchMutation.isPending && switchMutation.variables === model.id;

            return (
              <button
                key={model.id}
                disabled={!model.readyToUse || isActive || switchMutation.isPending}
                onClick={() => switchMutation.mutate(model.id)}
                className={cn(
                  "w-full text-left rounded-2xl border px-5 py-4 transition-colors",
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white"
                    : model.readyToUse
                    ? "border-slate-200 hover:border-slate-400 hover:bg-slate-50 cursor-pointer"
                    : "border-slate-100 bg-slate-50 cursor-not-allowed opacity-60",
                )}
              >
                <div className="flex items-center gap-3">
                  {isSwitching ? (
                    <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                  ) : isActive ? (
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 flex-shrink-0 text-slate-300" />
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("font-medium text-sm", isActive ? "text-white" : "text-slate-900")}>
                        {name}
                      </span>
                      {isActive && (
                        <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full font-medium">
                          Active
                        </span>
                      )}
                      {!model.readyToUse && (
                        <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" /> Downloading
                        </span>
                      )}
                    </div>
                    {desc && (
                      <p className={cn("text-xs mt-0.5", isActive ? "text-white/70" : "text-slate-500")}>
                        {desc}
                      </p>
                    )}
                  </div>

                  <Cpu className={cn("w-4 h-4 flex-shrink-0", isActive ? "text-white/50" : "text-slate-300")} />
                </div>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-slate-400">
          Embedding model: <span className="font-mono">{/* shown from config */}nomic-embed-text</span> — fixed, not switchable.
        </p>
      </div>
    </div>
  );
}
