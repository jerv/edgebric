import { useState, useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck, EyeOff, CheckCircle, XCircle, Loader2, Copy, Trash2, RefreshCw, ExternalLink, Sparkles,
} from "lucide-react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { IntegrationConfig } from "@edgebric/types";
import { cn } from "@/lib/utils";
import { useUser } from "@/contexts/UserContext";
import { usePrivacy } from "@/contexts/PrivacyContext";

// ─── Admin Toggles ────────────────────────────────────────────────────────────

function AdminToggles() {
  const queryClient = useQueryClient();
  const { data: config } = useQuery<IntegrationConfig>({
    queryKey: ["admin", "integrations"],
    queryFn: () =>
      fetch("/api/admin/integrations", { credentials: "same-origin" }).then(
        (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<IntegrationConfig>;
        },
      ),
  });

  const mutation = useMutation({
    mutationFn: (update: Partial<IntegrationConfig>) =>
      fetch("/api/admin/integrations", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, ...update }),
      }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "integrations"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">
          Privacy Features
        </h3>
        <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">
          Enable privacy modes for members in your organization.
        </p>
      </div>

      <div className="space-y-3">
        <ToggleCard
          icon={<EyeOff className="w-4 h-4" />}
          title="Private Mode"
          description="Members can make queries anonymously. Conversations are not logged and admin cannot see them."
          enabled={config?.privateModeEnabled ?? false}
          saving={mutation.isPending}
          onToggle={(v) => mutation.mutate({ privateModeEnabled: v })}
        />
        <ToggleCard
          icon={<ShieldCheck className="w-4 h-4" />}
          title="Vault Mode"
          description="Members can run queries entirely on their own device using Ollama. Nothing is sent to the server. Requires one-time setup per member."
          enabled={config?.vaultModeEnabled ?? false}
          saving={mutation.isPending}
          onToggle={(v) => mutation.mutate({ vaultModeEnabled: v })}
        />
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">
          AI Behavior
        </h3>
        <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">
          Control how the AI assistant responds to queries.
        </p>
      </div>

      <div className="space-y-3">
        <ToggleCard
          icon={<Sparkles className="w-4 h-4" />}
          title="General AI Answers"
          description="Allow the AI to answer from general knowledge when no matching documents are found. When disabled, the AI only answers from your uploaded documents."
          enabled={config?.generalAnswersEnabled ?? true}
          saving={mutation.isPending}
          onToggle={(v) => mutation.mutate({ generalAnswersEnabled: v })}
        />
      </div>

      {config?.vaultModeEnabled && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3 space-y-2">
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            Vault Mode syncs company document chunks to member devices for
            local processing. This is the same content members can already
            query via the web app. Enabling this means accepting that company
            data will be cached locally.
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
            <span className="font-medium">Limitations:</span> Vault Mode
            processes documents on-device, which supports text-based PDFs and
            Word documents. Scanned or image-only PDFs cannot be processed
            locally. All data is encrypted at rest with AES-256 and can be
            remotely wiped if a device is lost.
          </p>
        </div>
      )}
    </div>
  );
}

function ToggleCard({
  icon,
  title,
  description,
  enabled,
  saving,
  onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  saving: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div className="border border-slate-200 dark:border-gray-800 rounded-xl p-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
            enabled
              ? "bg-slate-900 text-white dark:bg-gray-100 dark:text-gray-900"
              : "bg-slate-100 text-slate-400 dark:bg-gray-800 dark:text-gray-500",
          )}
        >
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-gray-100">{title}</p>
          <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5 leading-relaxed">
            {description}
          </p>
        </div>
      </div>
      <SwitchPrimitive.Root
        checked={enabled}
        onCheckedChange={(v) => onToggle(v)}
        disabled={saving}
        className={cn(
          "relative w-10 h-6 rounded-full flex-shrink-0 transition-colors cursor-pointer",
          "data-[state=checked]:bg-slate-900 data-[state=unchecked]:bg-slate-200 dark:data-[state=checked]:bg-gray-100 dark:data-[state=unchecked]:bg-gray-700",
          saving && "opacity-50 cursor-not-allowed",
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "block w-5 h-5 rounded-full bg-white dark:data-[state=checked]:bg-gray-900 dark:data-[state=unchecked]:bg-gray-300 shadow transition-transform",
            "data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0.5",
          )}
        />
      </SwitchPrimitive.Root>
    </div>
  );
}

// ─── Vault Setup Wizard ───────────────────────────────────────────────────────

type OllamaStatus = "unknown" | "checking" | "connected" | "error";
type ModelsStatus = "unknown" | "checking" | "ready" | "missing";
type SyncStatus = "idle" | "syncing" | "embedding" | "done" | "error";

interface OllamaModel {
  name: string;
  size?: number;
}
interface OllamaTagsResponse {
  models?: OllamaModel[];
}

const EMBEDDING_MODEL_PREFIX = "nomic-embed-text";

/** Models that are known to not be chat models (embedding-only). */
const EMBEDDING_ONLY_PREFIXES = ["nomic-embed-text", "all-minilm", "mxbai-embed", "snowflake-arctic-embed"];

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${bytes} B`;
}

function isChatModel(name: string): boolean {
  const base = name.split(":")[0]!;
  return !EMBEDDING_ONLY_PREFIXES.some((p) => base === p);
}

function VaultSetupWizard() {
  const { vaultSetupComplete, setVaultSetupComplete } = usePrivacy();

  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>("unknown");
  const [modelsStatus, setModelsStatus] = useState<ModelsStatus>("unknown");
  const [installedModels, setInstalledModels] = useState<OllamaModel[]>([]);
  const [selectedChatModel, setSelectedChatModel] = useState<string>(() => {
    // Lazy-import to avoid top-level side effects
    try {
      return localStorage.getItem("edgebric-vault-chat-model") ?? "";
    } catch { return ""; }
  });
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    vaultSetupComplete ? "done" : "idle",
  );
  const [syncProgress, setSyncProgress] = useState("");
  const [syncError, setSyncError] = useState("");

  const fetchModels = useCallback(async () => {
    const r = await fetch("http://localhost:11434/api/tags");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as OllamaTagsResponse;
    return data.models ?? [];
  }, []);

  const evaluateModels = useCallback((models: OllamaModel[]) => {
    setInstalledModels(models);
    const hasEmbedding = models.some((m) => m.name.split(":")[0] === EMBEDDING_MODEL_PREFIX);
    const chatModels = models.filter((m) => isChatModel(m.name));
    const hasChatModel = chatModels.length > 0;

    // Auto-select chat model if only one available or previous selection still present
    if (hasChatModel && !selectedChatModel) {
      const first = chatModels[0]!.name;
      setSelectedChatModel(first);
      try { localStorage.setItem("edgebric-vault-chat-model", first); } catch { /* localStorage unavailable */ }
    }

    setModelsStatus(hasEmbedding && hasChatModel ? "ready" : "missing");
  }, [selectedChatModel]);

  const checkOllama = useCallback(async () => {
    setOllamaStatus("checking");
    try {
      const models = await fetchModels();
      setOllamaStatus("connected");
      evaluateModels(models);
    } catch {
      setOllamaStatus("error");
      setModelsStatus("unknown");
    }
  }, [fetchModels, evaluateModels]);

  const checkModels = useCallback(async () => {
    setModelsStatus("checking");
    try {
      const models = await fetchModels();
      evaluateModels(models);
    } catch {
      setModelsStatus("unknown");
    }
  }, [fetchModels, evaluateModels]);

  // Auto-verify Ollama connection on mount
  useEffect(() => {
    void checkOllama();
  }, []);

  const startSync = useCallback(async () => {
    setSyncStatus("syncing");
    setSyncError("");
    setSyncProgress("Downloading chunks from server...");

    try {
      // Fetch chunks from server
      const r = await fetch("/api/sync/chunks", { credentials: "same-origin" });
      if (!r.ok) throw new Error(`Server returned ${r.status}`);

      const text = await r.text();
      const lines = text.trim().split("\n").filter(Boolean);
      const chunks = lines.map((line) => JSON.parse(line) as {
        chunkId: string;
        content: string;
        metadata: Record<string, unknown>;
      });

      setSyncProgress(`Downloaded ${chunks.length} chunks. Embedding locally...`);
      setSyncStatus("embedding");

      // Open IndexedDB
      const { openVaultDB, storeChunks, storeSyncMeta } = await import(
        "@/services/vaultEngine"
      );
      const db = await openVaultDB();

      // Embed each chunk via Ollama
      const embedded: Array<{
        chunkId: string;
        content: string;
        metadata: Record<string, unknown>;
        embedding: number[];
      }> = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        setSyncProgress(
          `Embedding chunks locally... ${i + 1}/${chunks.length}`,
        );

        const embedR = await fetch("http://localhost:11434/api/embeddings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "nomic-embed-text",
            prompt: chunk.content,
          }),
        });
        if (!embedR.ok) throw new Error(`Ollama embed error: ${embedR.status}`);
        const embedData = (await embedR.json()) as { embedding: number[] };
        embedded.push({ ...chunk, embedding: embedData.embedding });
      }

      // Store in IndexedDB
      await storeChunks(db, embedded);

      // Get version hash
      const versionR = await fetch("/api/sync/version", {
        credentials: "same-origin",
      });
      const versionData = (await versionR.json()) as { version: string };
      await storeSyncMeta(db, {
        version: versionData.version,
        lastSync: new Date().toISOString(),
        embeddingsComplete: true,
        chunkCount: embedded.length,
      });

      db.close();
      setSyncStatus("done");
      setSyncProgress(`${embedded.length} chunks synced and indexed.`);
      setVaultSetupComplete(true);
    } catch (err) {
      setSyncStatus("error");
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    }
  }, [setVaultSetupComplete]);

  const clearLocalData = useCallback(async () => {
    try {
      const { openVaultDB, clearAllData } = await import(
        "@/services/vaultEngine"
      );
      const db = await openVaultDB();
      await clearAllData(db);
      db.close();
      setVaultSetupComplete(false);
      setSyncStatus("idle");
      setSyncProgress("");
    } catch {
      // IndexedDB not available
    }
  }, [setVaultSetupComplete]);

  const handleSelectChatModel = useCallback((model: string) => {
    setSelectedChatModel(model);
    try { localStorage.setItem("edgebric-vault-chat-model", model); } catch { /* localStorage unavailable */ }
  }, []);

  const chatModels = installedModels.filter((m) => isChatModel(m.name));
  const hasEmbeddingModel = installedModels.some(
    (m) => m.name.split(":")[0] === EMBEDDING_MODEL_PREFIX,
  );

  // Determine which step we're on
  const step =
    ollamaStatus !== "connected"
      ? 1
      : modelsStatus !== "ready"
        ? 2
        : syncStatus !== "done"
          ? 3
          : 4;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">
          Vault Mode Setup
        </h3>
        <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">
          Run queries entirely on your device. Nothing is sent to any server.
        </p>
      </div>

      <div className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-gray-800">
        {/* Step 1: Install Ollama */}
        <StepRow
          number={1}
          title="Install Ollama"
          active={step === 1}
          complete={ollamaStatus === "connected"}
        >
          {ollamaStatus === "connected" ? (
            <p className="text-xs text-emerald-600 flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5" /> Connected
            </p>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed">
                Ollama runs AI models locally on your Mac. Install it once — it
                runs automatically in the background.
              </p>
              <div className="flex items-center gap-2">
                <CopyCommand command="brew install ollama" />
                <span className="text-xs text-slate-300 dark:text-gray-600">or</span>
                <a
                  href="https://ollama.com/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-100 flex items-center gap-1 underline"
                >
                  Download <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <button
                onClick={() => void checkOllama()}
                disabled={ollamaStatus === "checking"}
                className="flex items-center gap-1.5 text-xs font-medium text-white dark:text-gray-900 bg-slate-900 dark:bg-gray-100 rounded-lg px-3 py-1.5 hover:bg-slate-700 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
              >
                {ollamaStatus === "checking" && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                Verify Connection
              </button>
              {ollamaStatus === "error" && (
                <p className="text-xs text-red-500 flex items-center gap-1.5">
                  <XCircle className="w-3.5 h-3.5" /> Could not connect.
                  Make sure Ollama is installed and running.
                </p>
              )}
            </div>
          )}
        </StepRow>

        {/* Step 2: AI Models */}
        <StepRow
          number={2}
          title="AI Models"
          active={step === 2}
          complete={modelsStatus === "ready"}
        >
          {modelsStatus === "ready" ? (
            <p className="text-xs text-slate-500 dark:text-gray-400">
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">{selectedChatModel}</span>
              {" + "}
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">nomic-embed-text</span>
            </p>
          ) : (
            <div className="space-y-2.5">
              {/* Embedding model */}
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-700 dark:text-gray-300">
                  <span className="font-medium">nomic-embed-text</span>
                  <span className="text-slate-400 dark:text-gray-500 ml-1">~274 MB, search</span>
                </div>
                {hasEmbeddingModel ? (
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                ) : (
                  <CopyCommand command="ollama pull nomic-embed-text" />
                )}
              </div>

              {/* Chat models */}
              {chatModels.length > 0 ? (
                <div className="space-y-1">
                  {chatModels.map((m) => (
                    <button
                      key={m.name}
                      onClick={() => handleSelectChatModel(m.name)}
                      className={cn(
                        "flex items-center justify-between w-full rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                        selectedChatModel === m.name
                          ? "bg-slate-100 dark:bg-gray-800 font-medium text-slate-900 dark:text-gray-100"
                          : "text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900",
                      )}
                    >
                      <span>
                        {m.name}
                        {m.size != null && (
                          <span className="text-slate-400 dark:text-gray-500 ml-1">{formatSize(m.size)}</span>
                        )}
                      </span>
                      {selectedChatModel === m.name && (
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500 dark:text-gray-400">
                  No chat models found.{" "}
                  <CopyCommand command="ollama pull llama3.2:3b" />
                </div>
              )}

              <button
                onClick={() => void checkModels()}
                disabled={modelsStatus === "checking" || ollamaStatus !== "connected"}
                className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 disabled:opacity-50 transition-colors"
              >
                {modelsStatus === "checking" ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                Refresh
              </button>
            </div>
          )}
        </StepRow>

        {/* Step 3: Sync Data */}
        <StepRow
          number={3}
          title="Sync Company Data"
          active={step === 3}
          complete={syncStatus === "done"}
        >
          {syncStatus === "done" ? (
            <div className="flex items-center justify-between">
              <p className="text-xs text-emerald-600">
                {syncProgress || "Synced and indexed"}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void startSync()}
                  className="flex items-center gap-1 text-xs text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-300 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" /> Re-sync
                </button>
                <button
                  onClick={() => void clearLocalData()}
                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> Clear
                </button>
              </div>
            </div>
          ) : syncStatus === "syncing" || syncStatus === "embedding" ? (
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {syncProgress}
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed">
                Download and index company documents locally for search.
              </p>
              <button
                onClick={() => void startSync()}
                disabled={modelsStatus !== "ready"}
                className="flex items-center gap-1.5 text-xs font-medium text-white dark:text-gray-900 bg-slate-900 dark:bg-gray-100 rounded-lg px-3 py-1.5 hover:bg-slate-700 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
              >
                Sync Data
              </button>
              {syncStatus === "error" && (
                <p className="text-xs text-red-500 flex items-center gap-1.5">
                  <XCircle className="w-3.5 h-3.5" /> {syncError}
                </p>
              )}
            </div>
          )}
        </StepRow>

        {/* Step 4: Ready */}
        <StepRow number={4} title="Ready" active={step === 4} complete={step === 4}>
          <p className={cn("text-xs", step === 4 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-gray-500")}>
            {step === 4
              ? "Vault Mode is ready. Use the privacy selector in the sidebar."
              : "Complete the steps above."}
          </p>
        </StepRow>
      </div>
    </div>
  );
}

// ─── Shared components ───────────────────────────────────────────────────────

function StepRow({
  number,
  title,
  active,
  complete,
  children,
}: {
  number: number;
  title: string;
  active: boolean;
  complete: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("px-4 py-3 transition-colors", !active && !complete && "opacity-50")}>
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={cn(
            "w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0",
            complete
              ? "bg-emerald-500 text-white"
              : active
                ? "bg-slate-900 text-white dark:bg-gray-100 dark:text-gray-900"
                : "bg-slate-200 text-slate-500 dark:bg-gray-700 dark:text-gray-400",
          )}
        >
          {complete ? <CheckCircle className="w-3 h-3" /> : number}
        </span>
        <h4 className="text-xs font-medium text-slate-900 dark:text-gray-100">{title}</h4>
      </div>
      <div className="pl-7">{children}</div>
    </div>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1.5 font-mono text-xs bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 rounded-lg px-2.5 py-1.5 hover:bg-slate-200 dark:hover:bg-gray-700 transition-colors"
    >
      <code>{command}</code>
      {copied ? (
        <CheckCircle className="w-3 h-3 text-emerald-500" />
      ) : (
        <Copy className="w-3 h-3 text-slate-400 dark:text-gray-500" />
      )}
    </button>
  );
}

// ─── Main PrivacyTab ─────────────────────────────────────────────────────────

export function PrivacyTab() {
  const user = useUser();

  return (
    <div className="space-y-8">
      {/* Admin section */}
      {user?.isAdmin && <AdminToggles />}

      {/* Employee section — Vault Mode setup wizard */}
      {user?.vaultModeEnabled && (
        <>
          {user?.isAdmin && (
            <div className="border-t border-slate-200 dark:border-gray-800 pt-6" />
          )}
          <VaultSetupWizard />
        </>
      )}

      {/* Status when no features enabled */}
      {!user?.isAdmin && !user?.privateModeEnabled && !user?.vaultModeEnabled && (
        <div className="border border-slate-100 dark:border-gray-800 rounded-xl px-4 py-8 text-center">
          <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-gray-800 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-5 h-5 text-slate-400 dark:text-gray-500" />
          </div>
          <p className="text-sm text-slate-500 dark:text-gray-400 mt-3">
            No privacy features are enabled for your organization.
          </p>
          <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">
            Contact your administrator to enable Private Mode or Vault Mode.
          </p>
        </div>
      )}

      {/* Employee info when only Private Mode enabled (no wizard needed) */}
      {!user?.isAdmin && user?.privateModeEnabled && !user?.vaultModeEnabled && (
        <div className="border border-slate-200 dark:border-gray-800 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 flex items-center justify-center flex-shrink-0">
              <EyeOff className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-gray-100">
                Private Mode Available
              </p>
              <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5 leading-relaxed">
                Use the privacy selector in the sidebar to switch to Private
                Mode. Your queries will be anonymous and nothing will be
                logged.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
