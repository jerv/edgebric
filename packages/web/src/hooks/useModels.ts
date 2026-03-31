/**
 * Shared React Query hooks for model management.
 * Used by both ModelsPanel (admin settings) and ModelPicker (chat UI).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useRef } from "react";
import type { ModelsResponse, PullProgressEvent } from "@edgebric/types";

const MODELS_KEY = ["admin", "models"] as const;

/** Fetch model list, catalog, active model, and system resources. */
export function useModels(options?: { enabled?: boolean }) {
  return useQuery<ModelsResponse>({
    queryKey: MODELS_KEY,
    queryFn: async () => {
      const r = await fetch("/api/admin/models", { credentials: "same-origin" });
      if (!r.ok) throw new Error("Failed to load models");
      return r.json() as Promise<ModelsResponse>;
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      // Fast poll during downloads, slow poll for resource freshness
      return data.models.some((m) => m.status === "downloading") ? 3000 : 30000;
    },
    enabled: options?.enabled,
  });
}

/** Pull (download) a model with SSE progress streaming. */
export function usePullModel() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<PullProgressEvent | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pullTag, setPullTag] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pull = useCallback(async (tag: string) => {
    setPulling(true);
    setPullTag(tag);
    setProgress({ status: "Starting download..." });
    abortRef.current = new AbortController();

    try {
      const resp = await fetch("/api/admin/models/pull", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag }),
        signal: abortRef.current.signal,
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: "Pull failed" }));
        throw new Error((body as { error?: string }).error ?? "Pull failed");
      }

      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            // SSE event type — we handle data lines
            continue;
          }
          if (line.startsWith("data: ")) {
            const json = line.slice(6);
            try {
              const event = JSON.parse(json) as PullProgressEvent;
              setProgress(event);
            } catch {
              // ignore malformed
            }
          }
        }
      }

      void queryClient.invalidateQueries({ queryKey: [...MODELS_KEY] });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setProgress({ status: "Cancelled" });
      } else {
        throw err;
      }
    } finally {
      setPulling(false);
      setPullTag(null);
      abortRef.current = null;
    }
  }, [queryClient]);

  const cancel = useCallback(async () => {
    if (pullTag) {
      // Signal server to cancel
      await fetch("/api/admin/models/pull/cancel", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: pullTag }),
      }).catch(() => {});
    }
    abortRef.current?.abort();
  }, [pullTag]);

  return { pull, cancel, pulling, pullTag, progress };
}

/** Load a model into RAM. */
export function useLoadModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tag: string) => {
      const r = await fetch("/api/admin/models/load", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: "Failed to load" }));
        throw new Error((body as { error?: string }).error ?? "Failed to load");
      }
      return r.json() as Promise<{ loaded: boolean; tag: string; activeModel: string }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...MODELS_KEY] });
      void queryClient.invalidateQueries({ queryKey: ["query-status"] });
    },
  });
}

/** Unload a model from RAM. */
export function useUnloadModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tag: string) => {
      const r = await fetch("/api/admin/models/unload", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: "Failed to unload" }));
        throw new Error((body as { error?: string }).error ?? "Failed to unload");
      }
      return r.json() as Promise<{ unloaded: boolean; tag: string }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...MODELS_KEY] });
      void queryClient.invalidateQueries({ queryKey: ["query-status"] });
    },
  });
}

/** Delete a model from disk. */
export function useDeleteModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tag: string) => {
      const r = await fetch(`/api/admin/models/${encodeURIComponent(tag)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: "Failed to delete" }));
        throw new Error((body as { error?: string }).error ?? "Failed to delete");
      }
      return r.json() as Promise<{ deleted: boolean; tag: string }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...MODELS_KEY] });
    },
  });
}

/** Set the active (default) chat model. */
export function useSwitchModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tag: string) => {
      const r = await fetch("/api/admin/models/active", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: "Failed to switch" }));
        throw new Error((body as { error?: string }).error ?? "Failed to switch");
      }
      return r.json() as Promise<{ activeModel: string }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...MODELS_KEY] });
    },
  });
}
