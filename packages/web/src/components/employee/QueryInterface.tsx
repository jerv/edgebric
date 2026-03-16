import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import Markdown from "react-markdown";
import type { AnswerResponse, Citation, EscalateResponse, AvailableTarget, PersistedMessage, FeedbackCheck } from "@edgebric/types";
import { cn } from "@/lib/utils";
import { cleanContent, dedupeCitations, PROSE_CLASSES } from "@/lib/content";
import { adminLabel } from "@/lib/models";
import { useUser } from "@/contexts/UserContext";
import { usePrivacy, type PrivacyMessage } from "@/contexts/PrivacyContext";
import { ChevronDown, Slack, Mail, EyeOff, ShieldCheck, Eye, CheckCircle, X, Database, Check, Building2, UserRound, Search, Send, Square } from "lucide-react";
import { ExitPrivacyDialog } from "@/components/layout/ExitPrivacyDialog";
import { useFeedback } from "@/hooks/useFeedback";
import { CitationList } from "@/components/shared/CitationList";
import { FeedbackButtons, FeedbackCommentForm } from "@/components/shared/MessageFeedback";
import { SourcePanel } from "./SourcePanel";
import { KBMentionPicker, type KBTarget, type KBMentionPickerHandle } from "./KBMentionPicker";
import type { KnowledgeBase } from "@edgebric/types";

interface Message {
  role: "user" | "assistant";
  id?: string;
  content: string;
  /** Only complete paragraphs, revealed progressively during streaming. */
  revealedContent?: string;
  /** Previous revealed snapshot — content before this is rendered statically. */
  prevRevealedContent?: string;
  citations?: Citation[];
  hasConfidentAnswer?: boolean;
  isStreaming?: boolean;
  source?: "ai" | "admin" | "system";
}

interface MILMModel {
  id: string;
  readyToUse: boolean;
}

interface ModelsResponse {
  models: MILMModel[];
  activeModel: string;
}

// ─── Thinking Indicator ─────────────────────────────────────────────────────

const THINKING_WORDS = [
  "Thinking",
  "Searching knowledge bases",
  "Reading documents",
  "Analyzing",
  "Composing answer",
  "Reviewing sources",
  "Cross-referencing",
  "Synthesizing",
];

function ThinkingIndicator() {
  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % THINKING_WORDS.length);
        setFade(true);
      }, 200);
    }, 2400);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
      </div>
      <span
        className={cn(
          "text-xs text-slate-400 transition-opacity duration-200",
          fade ? "opacity-100" : "opacity-0",
        )}
      >
        {THINKING_WORDS[index]}
      </span>
    </div>
  );
}

// ─── Bot Avatar ──────────────────────────────────────────────────────────────

interface KBAvatar {
  id: string;
  name: string;
  avatarUrl?: string;
}

function BotAvatar({
  citations,
  orgAvatarUrl,
  avatarMode,
  privacyLevel,
  orgName,
}: {
  citations?: Citation[];
  orgAvatarUrl?: string;
  avatarMode?: "org" | "kb";
  privacyLevel: "standard" | "private" | "vault";
  orgName?: string;
}) {
  // Privacy modes: show icon instead
  if (privacyLevel === "vault") {
    return (
      <div className="w-8 h-8 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center flex-shrink-0">
        <ShieldCheck className="w-4 h-4 text-emerald-500" />
      </div>
    );
  }
  if (privacyLevel === "private") {
    return (
      <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0">
        <EyeOff className="w-4 h-4 text-slate-400" />
      </div>
    );
  }

  // KB-specific avatars mode
  if (avatarMode === "kb" && citations && citations.length > 0) {
    // Deduplicate KBs from citations
    const kbMap = new Map<string, KBAvatar>();
    for (const c of citations) {
      if (c.knowledgeBaseId && !kbMap.has(c.knowledgeBaseId)) {
        kbMap.set(c.knowledgeBaseId, {
          id: c.knowledgeBaseId,
          name: c.knowledgeBaseName ?? "KB",
          avatarUrl: c.knowledgeBaseAvatarUrl,
        });
      }
    }
    const kbs = Array.from(kbMap.values());

    if (kbs.length === 1) {
      const kb = kbs[0]!;
      return (
        <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0 overflow-hidden" title={kb.name}>
          {kb.avatarUrl ? (
            <img src={kb.avatarUrl} alt={kb.name} className="w-full h-full object-cover" />
          ) : orgAvatarUrl ? (
            <img src={orgAvatarUrl} alt={orgName ?? "Org"} className="w-full h-full object-cover" />
          ) : (
            <Building2 className="w-4 h-4 text-slate-400" />
          )}
        </div>
      );
    }

    if (kbs.length >= 2) {
      const showKbs = kbs.slice(0, 3);
      const remaining = kbs.length - 3;
      const tooltipText = kbs.map((kb) => kb.name).join(", ");

      return (
        <div className="relative w-8 h-8 flex-shrink-0" title={tooltipText}>
          {showKbs.map((kb, idx) => {
            const offset = idx * 5;
            const zIndex = showKbs.length - idx;
            return (
              <div
                key={kb.id}
                className="absolute rounded-full bg-slate-100 border-2 border-white overflow-hidden"
                style={{
                  width: 22,
                  height: 22,
                  left: offset,
                  top: idx % 2 === 0 ? 0 : 10,
                  zIndex,
                }}
              >
                {kb.avatarUrl ? (
                  <img src={kb.avatarUrl} alt={kb.name} className="w-full h-full object-cover" />
                ) : orgAvatarUrl ? (
                  <img src={orgAvatarUrl} alt={orgName ?? "Org"} className="w-full h-full object-cover" />
                ) : (
                  <span className="w-full h-full flex items-center justify-center text-[8px] font-semibold text-slate-400">
                    {kb.name.slice(0, 1)}
                  </span>
                )}
              </div>
            );
          })}
          {remaining > 0 && (
            <div
              className="absolute rounded-full bg-slate-200 border-2 border-white flex items-center justify-center"
              style={{ width: 22, height: 22, left: showKbs.length * 5, top: 5, zIndex: 0 }}
            >
              <span className="text-[8px] font-bold text-slate-500">+{remaining}</span>
            </div>
          )}
        </div>
      );
    }
  }

  // Default: org avatar
  return (
    <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0 overflow-hidden" title={orgName}>
      {orgAvatarUrl ? (
        <img src={orgAvatarUrl} alt={orgName ?? "Organization"} className="w-full h-full object-cover" />
      ) : (
        <Building2 className="w-4 h-4 text-slate-400" />
      )}
    </div>
  );
}

/** Escalation target picker — scrollable with search when there are many targets. */
function EscalationPicker({
  targets,
  isPending,
  onSelect,
}: {
  targets: AvailableTarget[];
  isPending: boolean;
  onSelect: (targetId: string, method: "email" | "slack") => void;
}) {
  const [search, setSearch] = useState("");
  const showSearch = targets.length > 5;

  const filtered = search
    ? targets.filter(
        (t) =>
          t.name.toLowerCase().includes(search.toLowerCase()) ||
          (t.role && t.role.toLowerCase().includes(search.toLowerCase())),
      )
    : targets;

  return (
    <div className="absolute right-0 bottom-full mb-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-20 overflow-hidden">
      {targets.length === 0 ? (
        <div className="px-3 py-2 text-xs text-slate-400">
          No escalation targets configured. Ask your administrator to set up targets in Settings.
        </div>
      ) : (
        <>
          {showSearch && (
            <div className="px-2 pt-2 pb-1 border-b border-slate-100">
              <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 rounded-lg border border-slate-200">
                <Search className="w-3 h-3 text-slate-400 flex-shrink-0" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search contacts..."
                  className="flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
                  autoFocus
                />
              </div>
            </div>
          )}
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">No matches</div>
            ) : (
              filtered.map((target) => (
                <div key={target.id} className="px-3 py-2 border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <div className="text-xs font-medium text-slate-700">{target.name}</div>
                  {target.role && <div className="text-[11px] text-slate-400">{target.role}</div>}
                  <div className="flex gap-1 mt-1.5">
                    {target.methods.map((method) => (
                      <button
                        key={method}
                        onClick={() => onSelect(target.id, method)}
                        disabled={isPending}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-100 hover:border-slate-300 transition-colors disabled:opacity-40"
                      >
                        {method === "slack" ? <Slack className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
                        {method === "slack" ? "Slack" : "Email"}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function ChatPanel() {
  const user = useUser();
  const privacy = usePrivacy();
  const { level: privacyLevel, setLevel: setPrivacyLevel, privacyMessages: savedPrivacyMessages, setPrivacyMessages, privateModeAvailable, vaultModeAvailable } = privacy;
  const isPrivacyMode = privacyLevel !== "standard";
  const queryClient = useQueryClient();
  const routerState = useRouterState();
  const searchParams = new URLSearchParams(routerState.location.search);
  const urlConvId = isPrivacyMode ? undefined : (searchParams.get("c") ?? undefined);

  const [messages, setMessagesRaw] = useState<Message[]>(() => {
    // Hydrate from context on mount if in privacy mode
    if (privacyLevel !== "standard" && savedPrivacyMessages.length > 0) {
      return savedPrivacyMessages.map((m) => ({
        role: m.role,
        content: m.content,
        citations: m.citations as Citation[] | undefined,
        hasConfidentAnswer: m.hasConfidentAnswer,
      }));
    }
    return [];
  });

  // Wrap setMessages to also sync to privacy context
  const setMessages = useCallback((updater: Message[] | ((prev: Message[]) => Message[])) => {
    setMessagesRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // Sync non-streaming messages to context for navigation persistence
      if (isPrivacyMode) {
        const stable: PrivacyMessage[] = next
          .filter((m) => !m.isStreaming)
          .map((m) => ({
            role: m.role,
            content: m.content,
            citations: m.citations,
            hasConfidentAnswer: m.hasConfidentAnswer,
          }));
        setPrivacyMessages(stable);
      }
      return next;
    });
  }, [isPrivacyMode, setPrivacyMessages]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>(urlConvId);
  const [isLoading, setIsLoading] = useState(false);
  const [escalatedIndices, setEscalatedIndices] = useState<Set<number>>(new Set());
  const [escalationPickerIndex, setEscalationPickerIndex] = useState<number | null>(null);
  const fb = useFeedback(conversationId);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [privacyPopoverOpen, setPrivacyPopoverOpen] = useState(false);
  const [exitDialogTarget, setExitDialogTarget] = useState<"standard" | "private" | "vault" | null>(null);
  const [activeSource, setActiveSource] = useState<{
    documentId: string;
    documentName: string;
    sectionPath: string[];
    pageNumber: number;
  } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [targetKBs, setTargetKBs] = useState<KBTarget[]>([]);
  const [kbSelectorOpen, setKbSelectorOpen] = useState(false);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionStartIndex, setMentionStartIndex] = useState<number>(-1);
  const mentionPickerRef = useRef<KBMentionPickerHandle>(null);
  const kbSelectorRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const privacyRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prevUrlConvIdRef = useRef<string | undefined>(urlConvId);

  // Sync with URL changes (clicking sidebar conversation links)
  useEffect(() => {
    if (urlConvId !== prevUrlConvIdRef.current) {
      prevUrlConvIdRef.current = urlConvId;
      setConversationId(urlConvId);
      setMessages([]);
      setEscalatedIndices(new Set());
      setEscalationPickerIndex(null);
      fb.setFeedbackMap(() => new Map());
      setHydrated(false);
    }
  }, [urlConvId]);

  // Auto-resync IndexedDB chunks when entering Vault mode.
  // Runs in the background — user can start chatting immediately with existing data.
  useEffect(() => {
    if (privacyLevel !== "vault") return;
    let cancelled = false;

    async function backgroundSync() {
      try {
        // Check if server version differs from local
        const versionR = await fetch("/api/sync/version", { credentials: "same-origin" });
        if (cancelled) return;

        // Handle revocation: vault mode disabled server-side → wipe local data
        if (!versionR.ok) {
          const { openVaultDB, clearAllData } = await import("@/services/vaultEngine");
          const db = await openVaultDB();
          await clearAllData(db);
          db.close();
          console.log("Vault: access revoked — local data wiped");
          return;
        }

        const { version: serverVersion, revoked, accessibleChunkIds } = (await versionR.json()) as {
          version: string; revoked?: boolean; accessibleChunkIds?: string[];
        };
        if (revoked) {
          const { openVaultDB, clearAllData } = await import("@/services/vaultEngine");
          const db = await openVaultDB();
          await clearAllData(db);
          db.close();
          console.log("Vault: access revoked — local data wiped");
          return;
        }

        const { openVaultDB, storeChunks, storeSyncMeta } = await import("@/services/vaultEngine");
        const db = await openVaultDB();
        const meta = await db.get("syncMeta", "main");
        if (cancelled) { db.close(); return; }

        // Prune local chunks the user no longer has access to (KB permissions changed)
        if (accessibleChunkIds) {
          const accessibleSet = new Set(accessibleChunkIds);
          const localChunkIds = await db.getAllKeys("chunks");
          const pruneTx = db.transaction("chunks", "readwrite");
          for (const localId of localChunkIds) {
            if (!accessibleSet.has(localId as string)) {
              await pruneTx.store.delete(localId);
            }
          }
          await pruneTx.done;
        }

        // Skip full re-sync if already up to date
        if (meta?.version === serverVersion) { db.close(); return; }

        console.log("Vault: background resync — server version changed");
        const chunksR = await fetch("/api/sync/chunks", { credentials: "same-origin" });
        if (!chunksR.ok || cancelled) { db.close(); return; }
        const text = await chunksR.text();
        const lines = text.trim().split("\n").filter(Boolean);
        const chunks = lines.map((line) => JSON.parse(line) as {
          chunkId: string; content: string; metadata: Record<string, unknown>;
        });

        // Embed each chunk locally
        const embedded: Array<{
          chunkId: string; content: string;
          metadata: Record<string, unknown>; embedding: number[];
        }> = [];
        for (const chunk of chunks) {
          if (cancelled) { db.close(); return; }
          const embedR = await fetch("http://localhost:11434/api/embeddings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "nomic-embed-text", prompt: chunk.content }),
          });
          if (!embedR.ok) continue;
          const { embedding } = (await embedR.json()) as { embedding: number[] };
          embedded.push({ ...chunk, embedding });
        }

        if (!cancelled && embedded.length > 0) {
          await storeChunks(db, embedded);
          await storeSyncMeta(db, {
            version: serverVersion,
            lastSync: new Date().toISOString(),
            embeddingsComplete: true,
            chunkCount: embedded.length,
          });
          console.log(`Vault: resynced ${embedded.length} chunks`);
        }
        db.close();
      } catch {
        // Background sync — don't interrupt the user on failure
      }
    }

    void backgroundSync();
    return () => { cancelled = true; };
  }, [privacyLevel]);

  // Load conversation messages when conversationId changes (from URL or new creation)
  // Skip in privacy modes — messages are ephemeral
  useEffect(() => {
    if (isPrivacyMode || !conversationId || hydrated) return;
    let cancelled = false;

    async function loadConversation() {
      try {
        const res = await fetch(`/api/conversations/${conversationId}`, {
          credentials: "same-origin",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          conversation: { id: string };
          messages: PersistedMessage[];
        };
        if (cancelled) return;
        const loaded: Message[] = data.messages.map((m) => ({
          role: m.role,
          id: m.id,
          content: m.content,
          citations: m.citations,
          hasConfidentAnswer: m.hasConfidentAnswer,
          ...(m.source && { source: m.source }),
        }));
        setMessages(loaded);

        // Hydrate feedback state for assistant messages
        const fbMap = new Map<string, "up" | "down">();
        for (const m of data.messages) {
          if (m.role === "assistant" && m.id && !cancelled) {
            try {
              const fbRes = await fetch(`/api/feedback/${m.id}`, { credentials: "same-origin" });
              if (fbRes.ok) {
                const fbData = (await fbRes.json()) as FeedbackCheck;
                if (fbData.rated && fbData.rating) fbMap.set(m.id, fbData.rating);
              }
            } catch { /* non-critical */ }
          }
        }
        if (!cancelled && fbMap.size > 0) fb.setFeedbackMap(() => fbMap);

        // Auto-dismiss notifications for this conversation
        if (!cancelled) {
          fetch("/api/notifications/mark-read-for-conversation", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId }),
          }).catch(() => {});
        }
      } catch {
        // If conversation can't be loaded, start fresh
      }
      if (!cancelled) setHydrated(true);
    }

    void loadConversation();
    return () => { cancelled = true; };
  }, [conversationId, hydrated]);

  // Update URL when conversationId changes (after first query response)
  const updateUrlConvId = useCallback((newConvId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("c", newConvId);
    window.history.replaceState({}, "", url.toString());
    prevUrlConvIdRef.current = newConvId;
  }, []);

  const { data: status } = useQuery<{ ready: boolean }>({
    queryKey: ["query-status"],
    queryFn: async () => {
      const r = await fetch("/api/query/status", { credentials: "same-origin" });
      if (!r.ok) return { ready: false };
      return r.json() as Promise<{ ready: boolean }>;
    },
    refetchInterval: 8000,
    staleTime: 0,
  });

  const { data: modelsData, refetch: refetchModels } = useQuery<ModelsResponse>({
    queryKey: ["admin", "models"],
    queryFn: () =>
      fetch("/api/admin/models", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error("no access");
        return r.json() as Promise<ModelsResponse>;
      }),
    enabled: user?.isAdmin === true,
    staleTime: 30_000,
  });

  const switchModelMutation = useMutation({
    mutationFn: (modelId: string) =>
      fetch("/api/admin/models/active", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      }).then((r) => {
        if (!r.ok) throw new Error("switch failed");
        return r.json() as Promise<{ activeModel: string }>;
      }),
    onSuccess: () => {
      void refetchModels();
      setModelPickerOpen(false);
    },
  });

  const { data: availableTargets } = useQuery<AvailableTarget[]>({
    queryKey: ["escalation-targets"],
    queryFn: () =>
      fetch("/api/escalation-targets", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) return [];
        return r.json() as Promise<AvailableTarget[]>;
      }),
    staleTime: 60_000,
  });

  const { data: availableKBs } = useQuery<KnowledgeBase[]>({
    queryKey: ["knowledge-bases"],
    queryFn: () =>
      fetch("/api/knowledge-bases", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) return [];
        return r.json() as Promise<KnowledgeBase[]>;
      }),
    staleTime: 60_000,
  });

  const escalateMutation = useMutation({
    mutationFn: (payload: {
      question: string;
      aiAnswer: string;
      citations: Citation[];
      conversationId: string;
      messageId: string;
      targetId: string;
      method: "slack" | "email";
    }) =>
      fetch("/api/escalate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => {
        if (!r.ok) throw new Error("Escalation failed");
        return r.json() as Promise<EscalateResponse>;
      }),
  });

  const systemReady = status?.ready ?? true;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close model picker on outside click
  useEffect(() => {
    if (!modelPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setModelPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [modelPickerOpen]);

  // Close privacy popover on outside click
  useEffect(() => {
    if (!privacyPopoverOpen) return;
    function handleClick(e: MouseEvent) {
      if (privacyRef.current && !privacyRef.current.contains(e.target as Node)) {
        setPrivacyPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [privacyPopoverOpen]);

  // Close KB selector on outside click
  useEffect(() => {
    if (!kbSelectorOpen) return;
    function handleClick(e: MouseEvent) {
      if (kbSelectorRef.current && !kbSelectorRef.current.contains(e.target as Node)) {
        setKbSelectorOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [kbSelectorOpen]);

  function handlePrivacySelect(newLevel: typeof privacyLevel) {
    setPrivacyPopoverOpen(false);
    if (newLevel === privacyLevel) return;
    // If currently in a privacy mode with messages, confirm exit first
    if (isPrivacyMode && savedPrivacyMessages.length > 0) {
      setExitDialogTarget(newLevel);
      return;
    }
    applyPrivacyLevel(newLevel);
  }

  function applyPrivacyLevel(newLevel: typeof privacyLevel) {
    setPrivacyLevel(newLevel);
    if (newLevel !== "standard") {
      // Start fresh ephemeral session
      setMessages([]);
      setConversationId(undefined);
      window.history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }

  /** Toggle a KB in the target list (used by the mouse-friendly KB selector). */
  function toggleKBTarget(target: KBTarget) {
    setTargetKBs((prev) => {
      // If it's a shortcut, replace everything
      if (target.type === "shortcut") {
        // If already selected, deselect (back to default)
        if (prev.some((t) => t.id === target.id)) return [];
        return [target];
      }
      // Specific KB — remove any shortcuts first
      const withoutShortcuts = prev.filter((t) => t.type !== "shortcut");
      // Toggle: remove if already present, add if not
      if (withoutShortcuts.some((t) => t.id === target.id)) {
        return withoutShortcuts.filter((t) => t.id !== target.id);
      }
      return [...withoutShortcuts, target];
    });
  }

  /** Label shown on the KB selector button. */
  const kbSelectorLabel = targetKBs.length === 0
    ? "All KBs"
    : targetKBs.length === 1
      ? targetKBs[0]!.name
      : `${targetKBs.length} KBs`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const query = input.trim();
    if (!query || isLoading || (!systemReady && privacyLevel !== "vault")) return;

    setInput("");
    setIsLoading(true);

    const abort = new AbortController();
    abortRef.current = abort;

    const userMessage: Message = { role: "user", content: query };
    const assistantMessage: Message = { role: "assistant", content: "", isStreaming: true };
    setMessages((prev) => [...prev, userMessage, assistantMessage]);

    // ─── Vault Mode: query locally via Ollama ──────────────────────────────
    if (privacyLevel === "vault") {
      try {
        const { vaultQuery } = await import("@/services/vaultEngine");
        const conversationHistory = messages.slice(-4).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        for await (const chunk of vaultQuery(query, conversationHistory)) {
          if (abort.signal.aborted) break;
          if (chunk.type === "delta") {
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.role === "assistant") {
                const newContent = last.content + chunk.delta;
                const cleaned = cleanContent(newContent);
                const parts = cleaned.split(/\n\n/);
                const revealed = parts.length > 1 ? parts.slice(0, -1).join("\n\n") : "";
                const prevRevealed = revealed !== (last.revealedContent ?? "")
                  ? (last.revealedContent ?? "")
                  : (last.prevRevealedContent ?? "");
                updated[updated.length - 1] = {
                  ...last,
                  content: newContent,
                  revealedContent: revealed,
                  prevRevealedContent: prevRevealed,
                };
              }
              return updated;
            });
          } else if (chunk.type === "done") {
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.role === "assistant") {
                updated[updated.length - 1] = {
                  ...last,
                  content: chunk.answer,
                  revealedContent: chunk.answer,
                  prevRevealedContent: last.revealedContent ?? "",
                  citations: chunk.citations,
                  hasConfidentAnswer: chunk.hasConfidentAnswer,
                  isStreaming: false,
                };
              }
              return updated;
            });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Vault query failed";
        const isOllamaDown = msg.includes("Failed to fetch") || msg.includes("NetworkError");
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant") {
            updated[updated.length - 1] = {
              ...last,
              content: isOllamaDown
                ? "Ollama is not running. Restart it or switch to Private Mode."
                : msg,
              revealedContent: undefined,
              isStreaming: false,
            };
          }
          return updated;
        });
      } finally {
        abortRef.current = null;
        setIsLoading(false);
        inputRef.current?.focus();
      }
      return;
    }

    // ─── Private / Standard Mode: query server ─────────────────────────────
    try {
      // Resolve KB IDs from target chips
      const resolvedKBIds = targetKBs.length === 0 || targetKBs.some((t) => t.id === "__org__")
        ? undefined // default: search accessible org KBs
        : targetKBs.some((t) => t.id === "__all__")
          ? undefined // @all = search everything (same as default until personal KBs exist)
          : targetKBs.filter((t) => t.type !== "shortcut").map((t) => t.id);

      const requestBody = isPrivacyMode
        ? {
            query,
            private: true,
            messages: messages.slice(-4).map((m) => ({ role: m.role, content: m.content })),
            knowledgeBaseIds: resolvedKBIds,
          }
        : { query, conversationId, knowledgeBaseIds: resolvedKBIds };

      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(requestBody),
        signal: abort.signal,
      });

      if (response.status === 401) {
        window.location.href = "/api/auth/login";
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const body = await response.json() as { blocked?: boolean; message?: string };
        if (body.blocked) {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === "assistant") {
              updated[updated.length - 1] = {
                ...last,
                content: body.message ?? "This question should be directed to your administrator.",
                citations: [],
                isStreaming: false,
              };
            }
            return updated;
          });
          return;
        }
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response body");

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done || abort.signal.aborted) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: delta")) continue;
          if (line.startsWith("data: ")) {
            const payload = line.slice(6);
            try {
              const parsed = JSON.parse(payload) as { delta: string } | AnswerResponse;
              if ("delta" in parsed) {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === "assistant") {
                    const newContent = last.content + parsed.delta;
                    const cleaned = cleanContent(newContent);
                    const parts = cleaned.split(/\n\n/);
                    // All-but-last paragraph are complete; last is still being written
                    const revealed = parts.length > 1 ? parts.slice(0, -1).join("\n\n") : "";
                    // Only update prev snapshot when revealed content actually changes
                    const prevRevealed = revealed !== (last.revealedContent ?? "")
                      ? (last.revealedContent ?? "")
                      : (last.prevRevealedContent ?? "");
                    updated[updated.length - 1] = {
                      ...last,
                      content: newContent,
                      revealedContent: revealed,
                      prevRevealedContent: prevRevealed,
                    };
                  }
                  return updated;
                });
              } else if ("sessionId" in parsed) {
                // In privacy mode, skip conversation tracking
                if (!isPrivacyMode && parsed.conversationId) {
                  setConversationId(parsed.conversationId);
                  updateUrlConvId(parsed.conversationId);
                  setHydrated(true);
                  // Refresh sidebar conversation list
                  void queryClient.invalidateQueries({ queryKey: ["conversations"] });
                }
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === "assistant") {
                    const finalContent = parsed.answer;
                    updated[updated.length - 1] = {
                      ...last,
                      id: isPrivacyMode ? undefined : parsed.messageId,
                      content: finalContent,
                      revealedContent: finalContent,
                      prevRevealedContent: last.revealedContent ?? "",
                      citations: parsed.citations,
                      hasConfidentAnswer: parsed.hasConfidentAnswer,
                      isStreaming: false,
                    };
                  }
                  return updated;
                });
              }
            } catch {
              // Malformed SSE data
            }
          }
        }
      }
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          const finalContent = aborted ? (last.content || "") : "Something went wrong. Please try again.";
          updated[updated.length - 1] = {
            ...last,
            content: finalContent,
            revealedContent: finalContent,
            prevRevealedContent: last.revealedContent ?? "",
            isStreaming: false,
          };
        }
        return updated;
      });
    } finally {
      abortRef.current = null;
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setInput(value);

    // Detect @mention trigger
    const cursor = e.target.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursor);
    const mentionMatch = textBeforeCursor.match(/@([^\s@]*)$/);

    if (mentionMatch) {
      setMentionPickerOpen(true);
      setMentionFilter(mentionMatch[1] ?? "");
      setMentionStartIndex(cursor - mentionMatch[0].length);
    } else {
      setMentionPickerOpen(false);
      setMentionFilter("");
      setMentionStartIndex(-1);
    }
  }

  function handleMentionSelect(target: KBTarget) {
    // Remove the @mention text from input
    if (mentionStartIndex >= 0) {
      const cursor = inputRef.current?.selectionStart ?? input.length;
      const before = input.slice(0, mentionStartIndex);
      const after = input.slice(cursor);
      setInput(before + after);
    }

    // If selecting @org or @all, replace all targets with just that shortcut
    if (target.id === "__org__" || target.id === "__all__") {
      setTargetKBs([target]);
    } else {
      // Remove any shortcuts and add the specific KB
      setTargetKBs((prev) => {
        const withoutShortcuts = prev.filter((t) => t.type !== "shortcut");
        if (withoutShortcuts.some((t) => t.id === target.id)) return withoutShortcuts;
        return [...withoutShortcuts, target];
      });
    }

    setMentionPickerOpen(false);
    setMentionFilter("");
    setMentionStartIndex(-1);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // When mention picker is open, delegate navigation keys to it
    if (mentionPickerOpen && mentionPickerRef.current) {
      const handled = mentionPickerRef.current.handleKeyDown(e);
      if (handled) return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e as unknown as React.FormEvent);
    }
  }

  const activeModel = modelsData?.activeModel;
  const readyModels = (modelsData?.models ?? []).filter((m) => m.readyToUse);

  const chatTitle = (() => {
    const firstUserMsg = messages.find((m) => m.role === "user");
    if (!firstUserMsg) return "New Chat";
    const text = firstUserMsg.content.slice(0, 80);
    return text.length < firstUserMsg.content.length ? text + "..." : text;
  })();

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header bar */}
      <div className="border-b border-slate-200 px-6 py-3 flex items-center">
        <h1 className="text-sm font-semibold text-slate-900 truncate">{chatTitle}</h1>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            {privacyLevel === "vault" ? (
              <>
                <ShieldCheck className="w-8 h-8 text-emerald-400 mb-3" />
                <p className="text-slate-900 text-xl font-medium mb-2">Vault Mode</p>
                <p className="text-slate-400 text-sm max-w-sm">
                  Queries are processed entirely on your device. Nothing is sent to any server.
                </p>
                <p className="text-slate-300 text-xs max-w-sm mt-2">
                  Encrypted on-device. Supports text-based PDFs and Word docs. Scanned PDFs are not supported locally.
                </p>
              </>
            ) : privacyLevel === "private" ? (
              <>
                <EyeOff className="w-8 h-8 text-slate-400 mb-3" />
                <p className="text-slate-900 text-xl font-medium mb-2">Private Mode</p>
                <p className="text-slate-400 text-sm max-w-sm">
                  Your identity is hidden from administrators and conversations are not saved.
                  Queries are still processed on the organization's servers.
                </p>
              </>
            ) : systemReady ? (
              <>
                <p className="text-slate-900 text-xl font-medium mb-2">Ask a question</p>
                <p className="text-slate-400 text-sm max-w-sm">
                  Your questions are private. Only aggregate, anonymized topic trends are visible to administrators.
                </p>
              </>
            ) : (
              <>
                <p className="text-slate-900 text-xl font-medium mb-2">Library is empty</p>
                <p className="text-slate-400 text-sm max-w-sm">
                  {user?.isAdmin
                    ? "Upload documents from the Library to get started."
                    : "No documents have been loaded yet. Check back soon."}
                </p>
              </>
            )}
          </div>
        )}

        {messages.map((message, i) => {
          const dedupedCitations = dedupeCitations(message.citations ?? []);

          // During streaming: only show complete paragraphs via revealedContent
          // After done: show full content
          const displayContent = message.isStreaming
            ? cleanContent(message.revealedContent ?? "")
            : cleanContent(message.content);

          // Split into settled (previously revealed) + newly revealed for fade-in
          const settledContent = cleanContent(message.prevRevealedContent ?? "");
          const newContent = displayContent.length > settledContent.length
            ? displayContent.slice(settledContent.length)
            : undefined;

          // System notes render as centered muted text
          if (message.source === "system") {
            return (
              <div key={i} className="flex justify-center">
                <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-full px-4 py-2">
                  <CheckCircle className="w-3.5 h-3.5" />
                  {message.content}
                </div>
              </div>
            );
          }

          return (
            <div key={i} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
              {message.role === "user" ? (
                <div className="bg-slate-900 text-white rounded-2xl rounded-tr-sm px-4 py-3 max-w-xl text-sm">
                  {message.content}
                </div>
              ) : (
                <div className="flex gap-3 max-w-2xl w-full">
                  <div className="mt-1 flex-shrink-0">
                    <BotAvatar
                      citations={message.citations}
                      orgAvatarUrl={user?.orgAvatarUrl}
                      avatarMode={user?.avatarMode}
                      privacyLevel={privacyLevel}
                      orgName={user?.orgName}
                    />
                  </div>
                <div className="min-w-0 flex-1 space-y-3">
                  {message.source === "admin" && (
                    <div className="text-xs font-medium text-blue-600 px-1">Admin Reply</div>
                  )}
                  <div className={cn(
                    "rounded-2xl rounded-tl-sm px-5 py-4 text-sm text-slate-800 leading-relaxed",
                    message.source === "admin"
                      ? "bg-blue-50 border border-blue-200"
                      : "bg-slate-50 border border-slate-200",
                  )}>
                    {message.isStreaming && !displayContent ? (
                      <ThinkingIndicator />
                    ) : (
                      <>
                        <div className={cn(...PROSE_CLASSES)}>
                          {newContent ? (
                            <>
                              <Markdown>{settledContent}</Markdown>
                              <div key={displayContent.length} className="animate-fade-in">
                                <Markdown>{newContent}</Markdown>
                              </div>
                            </>
                          ) : (
                            <Markdown>{displayContent}</Markdown>
                          )}
                        </div>
                        {message.isStreaming && (
                          <span className="inline-block w-1.5 h-1.5 mt-2 rounded-full bg-slate-400 animate-pulse" />
                        )}
                      </>
                    )}
                  </div>

                  {/* Citations */}
                  {!message.isStreaming && (
                    <CitationList citations={dedupedCitations} onSourceClick={setActiveSource} />
                  )}

                  {!message.isStreaming && (
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-3">
                        {isPrivacyMode ? (
                          <span className={cn(
                            "inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full",
                            privacyLevel === "vault"
                              ? "text-emerald-600 bg-emerald-50"
                              : "text-slate-500 bg-slate-100",
                          )}>
                            {privacyLevel === "vault" ? (
                              <ShieldCheck className="w-3 h-3" />
                            ) : (
                              <EyeOff className="w-3 h-3" />
                            )}
                            {privacyLevel === "vault" ? "Vault — fully local" : "Private — not saved"}
                          </span>
                        ) : message.hasConfidentAnswer ? (
                          <p className="text-xs text-amber-600">
                            Verify all important answers with the appropriate human.
                          </p>
                        ) : null}

                        {/* Feedback thumbs up/down — standard mode only */}
                        {!isPrivacyMode && message.id && (
                          <div className="flex items-center gap-0.5">
                            <FeedbackButtons
                              messageId={message.id}
                              rating={fb.feedbackMap.get(message.id)}
                              isPending={fb.feedbackPending === message.id}
                              isCommentOpen={fb.feedbackCommentId === message.id}
                              onThumbsUp={() => void fb.submitFeedback(message.id!, "up")}
                              onThumbsDown={() => fb.toggleCommentInput(message.id!)}
                            />
                          </div>
                        )}
                      </div>
                      {!isPrivacyMode && conversationId && message.id && (
                        <div className="relative">
                          {escalatedIndices.has(i) ? (
                            <span className="text-xs text-green-600 px-2.5 py-1">Sent for review</span>
                          ) : (
                            <button
                              onClick={() => setEscalationPickerIndex(escalationPickerIndex === i ? null : i)}
                              disabled={escalateMutation.isPending}
                              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded px-2.5 py-1 hover:border-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {escalateMutation.isPending && escalationPickerIndex === i ? "Sending..." : (<><UserRound className="w-3.5 h-3.5" /> Verify with a Human</>)}
                            </button>
                          )}
                          {escalationPickerIndex === i && !escalatedIndices.has(i) && (
                            <EscalationPicker
                              targets={availableTargets ?? []}
                              isPending={escalateMutation.isPending}
                              onSelect={(targetId, method) => {
                                const userMsg = messages[i - 1];
                                if (!userMsg || !conversationId || !message.id) return;
                                escalateMutation.mutate(
                                  {
                                    question: userMsg.content,
                                    aiAnswer: message.content,
                                    citations: message.citations ?? [],
                                    conversationId,
                                    messageId: message.id,
                                    targetId,
                                    method,
                                  },
                                  {
                                    onSuccess: () => {
                                      setEscalatedIndices((prev) => new Set(prev).add(i));
                                      setEscalationPickerIndex(null);
                                    },
                                  },
                                );
                              }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Thumbs-down comment input — renders as separate row */}
                  {!message.isStreaming && !isPrivacyMode && fb.feedbackCommentId === message.id && !fb.feedbackMap.has(message.id) && (
                    <FeedbackCommentForm
                      comment={fb.feedbackComment}
                      isPending={fb.feedbackPending === message.id}
                      onCommentChange={fb.setFeedbackComment}
                      onSubmitWithComment={() => void fb.submitFeedback(message.id!, "down", fb.feedbackComment)}
                      onSubmitWithoutComment={() => void fb.submitFeedback(message.id!, "down")}
                      onCancel={() => fb.setFeedbackCommentId(null)}
                    />
                  )}
                </div>
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 px-6 py-4">
        {!systemReady ? (
          <div className="text-center text-sm text-slate-400 py-1">
            Chat unavailable — no documents loaded.
          </div>
        ) : (
          <div className="space-y-2">
            {/* Header row: privacy + KB selector (left) + model selector (right) */}
            <div className="flex items-center justify-between">
             <div className="flex items-center gap-1">
              {/* Privacy mode selector */}
              <div ref={privacyRef} className="relative">
                <button
                  onClick={() => setPrivacyPopoverOpen((o) => !o)}
                  className={cn(
                    "flex items-center gap-1.5 text-xs transition-colors px-2 py-1 rounded-lg",
                    privacyLevel === "vault"
                      ? "text-emerald-600 hover:bg-emerald-50"
                      : privacyLevel === "private"
                        ? "text-amber-600 hover:bg-amber-50"
                        : "text-slate-400 hover:text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {privacyLevel === "vault" ? (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  ) : privacyLevel === "private" ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                  {privacyLevel === "vault" ? "Vault" : privacyLevel === "private" ? "Private" : "Standard"}
                  <ChevronDown className={cn("w-3 h-3 transition-transform", privacyPopoverOpen && "rotate-180")} />
                </button>

                {privacyPopoverOpen && (
                  <div className="absolute left-0 bottom-full mb-1 w-56 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-10">
                    <button
                      onClick={() => handlePrivacySelect("standard")}
                      className={cn(
                        "w-full text-left px-3 py-2.5 text-xs transition-colors flex items-start gap-2.5",
                        privacyLevel === "standard" ? "bg-slate-50" : "hover:bg-slate-50",
                      )}
                    >
                      <Eye className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-400" />
                      <div>
                        <span className={cn("block font-medium", privacyLevel === "standard" ? "text-slate-900" : "text-slate-700")}>Standard</span>
                        <span className="block text-[11px] text-slate-400 mt-0.5">Conversations saved normally</span>
                      </div>
                    </button>
                    {privateModeAvailable && (
                      <button
                        onClick={() => handlePrivacySelect("private")}
                        className={cn(
                          "w-full text-left px-3 py-2.5 text-xs transition-colors flex items-start gap-2.5",
                          privacyLevel === "private" ? "bg-amber-50/50" : "hover:bg-slate-50",
                        )}
                      >
                        <EyeOff className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-500" />
                        <div>
                          <span className={cn("block font-medium", privacyLevel === "private" ? "text-amber-700" : "text-slate-700")}>Private</span>
                          <span className="block text-[11px] text-slate-400 mt-0.5">Messages never saved to server</span>
                        </div>
                      </button>
                    )}
                    {vaultModeAvailable && (
                      <button
                        onClick={() => handlePrivacySelect("vault")}
                        className={cn(
                          "w-full text-left px-3 py-2.5 text-xs transition-colors flex items-start gap-2.5",
                          privacyLevel === "vault" ? "bg-emerald-50/50" : "hover:bg-slate-50",
                        )}
                      >
                        <ShieldCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-emerald-500" />
                        <div>
                          <span className={cn("block font-medium", privacyLevel === "vault" ? "text-emerald-700" : "text-slate-700")}>Vault</span>
                          <span className="block text-[11px] text-slate-400 mt-0.5">Encrypted, fully on-device</span>
                        </div>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* KB scope selector */}
              <div ref={kbSelectorRef} className="relative">
                <button
                  onClick={() => setKbSelectorOpen((o) => !o)}
                  className={cn(
                    "flex items-center gap-1.5 text-xs transition-colors px-2 py-1 rounded-lg",
                    targetKBs.length > 0
                      ? "text-blue-600 hover:bg-blue-50"
                      : "text-slate-400 hover:text-slate-600 hover:bg-slate-50",
                  )}
                >
                  <Database className="w-3.5 h-3.5" />
                  {kbSelectorLabel}
                  <ChevronDown className={cn("w-3 h-3 transition-transform", kbSelectorOpen && "rotate-180")} />
                </button>

                {kbSelectorOpen && (
                  <div className="absolute left-0 bottom-full mb-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-20 max-h-64 overflow-y-auto">
                    {/* Default: All KBs */}
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setTargetKBs([]);
                        setKbSelectorOpen(false);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors",
                        targetKBs.length === 0 ? "bg-slate-50 text-slate-900" : "text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      <Database className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span className="truncate">All knowledge bases</span>
                      {targetKBs.length === 0 && <Check className="w-3.5 h-3.5 ml-auto text-blue-500 flex-shrink-0" />}
                    </button>

                    {/* Individual KBs */}
                    {(availableKBs ?? []).filter((kb) => kb.status === "active").length > 0 && (
                      <div className="px-3 pt-1.5 pb-1 text-[10px] font-medium text-slate-400 uppercase tracking-wider border-t border-slate-100 mt-1">
                        Knowledge Bases
                      </div>
                    )}
                    {(availableKBs ?? [])
                      .filter((kb) => kb.status === "active")
                      .map((kb) => {
                        const isSelected = targetKBs.some((t) => t.id === kb.id);
                        return (
                          <button
                            key={kb.id}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              toggleKBTarget({
                                id: kb.id,
                                name: kb.name,
                                datasetName: kb.datasetName,
                                type: kb.type === "personal" ? "personal" : "organization",
                              });
                            }}
                            className={cn(
                              "w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors",
                              isSelected ? "bg-slate-50 text-slate-900" : "text-slate-600 hover:bg-slate-50",
                            )}
                          >
                            <Database className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                            <span className="truncate">{kb.name}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 ml-auto text-blue-500 flex-shrink-0" />}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
             </div>

              {/* Model selector — admin only */}
              {user?.isAdmin && activeModel && (
                <div ref={pickerRef} className="relative">
                  <button
                    onClick={() => setModelPickerOpen((o) => !o)}
                    disabled={switchModelMutation.isPending}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors px-2 py-1 rounded-lg hover:bg-slate-50"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                    {adminLabel(activeModel)}
                    <ChevronDown className={cn("w-3 h-3 transition-transform", modelPickerOpen && "rotate-180")} />
                  </button>

                  {modelPickerOpen && (
                    <div className="absolute right-0 bottom-full mb-1 w-48 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-10">
                      {readyModels.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => switchModelMutation.mutate(m.id)}
                          disabled={switchModelMutation.isPending}
                          className={cn(
                            "w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2",
                            m.id === activeModel
                              ? "text-slate-900 font-medium bg-slate-50"
                              : "text-slate-600 hover:bg-slate-50",
                          )}
                        >
                          <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", m.id === activeModel ? "bg-green-400" : "bg-slate-200")} />
                          {adminLabel(m.id)}
                          {m.id === activeModel && <span className="ml-auto text-slate-400">active</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-2">
              {/* KB target chips */}
              {targetKBs.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-1">
                  {targetKBs.map((kb) => (
                    <span
                      key={kb.id}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
                    >
                      @{kb.name}
                      <button
                        type="button"
                        onClick={() => setTargetKBs((prev) => prev.filter((t) => t.id !== kb.id))}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-2 items-center">
                <div className="flex-1 relative">
                  {/* Mention picker */}
                  {mentionPickerOpen && (
                    <KBMentionPicker
                      ref={mentionPickerRef}
                      filter={mentionFilter}
                      knowledgeBases={availableKBs ?? []}
                      selected={targetKBs}
                      onSelect={handleMentionSelect}
                      onDismiss={() => setMentionPickerOpen(false)}
                    />
                  )}
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask a question..."
                    rows={1}
                    className="w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent max-h-32 overflow-y-auto"
                    style={{ height: "auto" }}
                    onInput={(e) => {
                      const target = e.currentTarget;
                      target.style.height = "auto";
                      target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
                    }}
                  />
                </div>
                {isLoading ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="inline-flex items-center justify-center gap-1.5 bg-slate-100 text-slate-700 rounded-xl px-4 h-[42px] text-sm font-medium hover:bg-red-50 hover:text-red-600 hover:border-red-200 border border-slate-200 transition-colors flex-shrink-0"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    Stop
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    className="inline-flex items-center justify-center gap-1.5 bg-slate-900 text-white rounded-xl px-4 h-[42px] text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send
                  </button>
                )}
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Source viewer panel */}
      {activeSource && (
        <SourcePanel
          documentId={activeSource.documentId}
          documentName={activeSource.documentName}
          sectionPath={activeSource.sectionPath}
          pageNumber={activeSource.pageNumber}
          onClose={() => setActiveSource(null)}
        />
      )}

      {/* Exit privacy mode confirmation dialog */}
      {exitDialogTarget && privacyLevel !== "standard" && (
        <ExitPrivacyDialog
          currentLevel={privacyLevel}
          onConfirm={() => {
            const target = exitDialogTarget;
            setExitDialogTarget(null);
            applyPrivacyLevel(target);
          }}
          onClose={() => setExitDialogTarget(null)}
        />
      )}
    </div>
  );
}
