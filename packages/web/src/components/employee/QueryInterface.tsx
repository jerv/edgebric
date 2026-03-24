import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import Markdown from "react-markdown";
import type { AnswerResponse, Citation, PersistedMessage } from "@edgebric/types";
import { getLoginUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { cleanContent, dedupeCitations, PROSE_CLASSES } from "@/lib/content";
import { useUser } from "@/contexts/UserContext";
import { usePrivacy, type PrivacyMessage } from "@/contexts/PrivacyContext";
import { ChevronDown, EyeOff, ShieldCheck, Eye, CheckCircle, X, Database, Check, Building2, UserPlus, Loader2 as LoaderIcon } from "lucide-react";
import { ModelPicker } from "@/components/shared/ModelPicker";
import { ExitPrivacyDialog } from "@/components/layout/ExitPrivacyDialog";
import { CitationList } from "@/components/shared/CitationList";
import { ChatInput } from "@/components/shared/ChatInput";
import { SourcePanel } from "./SourcePanel";
import { KBMentionPicker, type KBTarget, type KBMentionPickerHandle } from "./KBMentionPicker";
import { GroupChatSetupDialog } from "@/components/groupChat/GroupChatSetupDialog";
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


// ─── Thinking Indicator ─────────────────────────────────────────────────────

const THINKING_WORDS = [
  "Thinking",
  "Searching data sources",
  "Reading documents",
  "Analyzing",
  "Composing answer",
  "Reviewing data sources",
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
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-500 animate-bounce [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-500 animate-bounce [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-500 animate-bounce [animation-delay:300ms]" />
      </div>
      <span
        className={cn(
          "text-xs text-slate-400 dark:text-gray-500 transition-opacity duration-200",
          fade ? "opacity-100" : "opacity-0",
        )}
      >
        {THINKING_WORDS[index]}
      </span>
    </div>
  );
}

// ─── Bot Avatar ──────────────────────────────────────────────────────────────

function BotAvatar({
  orgAvatarUrl,
  privacyLevel,
  orgName,
}: {
  orgAvatarUrl?: string;
  privacyLevel: "standard" | "private" | "vault";
  orgName?: string;
}) {
  if (privacyLevel === "vault") {
    return (
      <div className="w-8 h-8 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center flex-shrink-0">
        <ShieldCheck className="w-4 h-4 text-emerald-500" />
      </div>
    );
  }
  if (privacyLevel === "private") {
    return (
      <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 flex items-center justify-center flex-shrink-0">
        <EyeOff className="w-4 h-4 text-slate-400 dark:text-gray-500" />
      </div>
    );
  }

  return (
    <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden" title={orgName}>
      {orgAvatarUrl ? (
        <img src={orgAvatarUrl} alt={orgName ?? "Organization"} className="w-full h-full object-cover" />
      ) : (
        <Building2 className="w-4 h-4 text-slate-400 dark:text-gray-500" />
      )}
    </div>
  );
}

// ─── User Avatar ─────────────────────────────────────────────────────────────

function UserAvatar({ picture, name, email }: { picture?: string; name?: string; email?: string }) {
  const initial = (name ?? email ?? "?").charAt(0).toUpperCase();
  return (
    <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden" title={name ?? email}>
      {picture ? (
        <img src={picture} alt={name ?? "User"} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span className="text-xs font-semibold text-slate-500 dark:text-gray-400">{initial}</span>
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
  const [modelLoading, setModelLoading] = useState(false);
  const [showConvertDialog, setShowConvertDialog] = useState(false);
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
  const privacyRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prevUrlConvIdRef = useRef<string | undefined>(urlConvId);

  // Sync with URL changes (clicking sidebar conversation links)
  useEffect(() => {
    if (urlConvId !== prevUrlConvIdRef.current) {
      prevUrlConvIdRef.current = urlConvId;
      setConversationId(urlConvId);
      setMessages([]);
      setHydrated(false);
      setIsLoading(false);
      abortRef.current?.abort();
      abortRef.current = null;
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

  // Watch bot-thinking state for this conversation (from global SSE notifications).
  const { data: thinkingChatIds } = useQuery<Set<string>>({
    queryKey: ["bot-thinking"],
    queryFn: () => Promise.resolve(new Set<string>()),
    staleTime: Infinity,
  });
  const isBotThinking = useMemo(
    () => !!conversationId && !!thinkingChatIds?.has(conversationId),
    [conversationId, thinkingChatIds],
  );
  const prevThinkingRef = useRef(isBotThinking);

  // Derive display messages: append a thinking placeholder when the bot is thinking
  // and we're not already streaming locally. This is computed every render — no timing races.
  const displayMessages = useMemo(() => {
    if (!isBotThinking || isLoading || isPrivacyMode) return messages;
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && last.isStreaming) return messages;
    return [...messages, { role: "assistant" as const, content: "", isStreaming: true }];
  }, [messages, isBotThinking, isLoading, isPrivacyMode]);

  // When bot finishes thinking, auto-reload messages so the answer appears without refresh.
  useEffect(() => {
    const wasThinking = prevThinkingRef.current;
    prevThinkingRef.current = isBotThinking;

    if (!conversationId || isPrivacyMode) return;

    if (wasThinking && !isBotThinking && !isLoading) {
      void (async () => {
        try {
          const res = await fetch(`/api/conversations/${conversationId}`, {
            credentials: "same-origin",
          });
          if (!res.ok) return;
          const data = (await res.json()) as {
            conversation: { id: string };
            messages: PersistedMessage[];
          };
          const loaded: Message[] = data.messages.map((m) => ({
            role: m.role,
            id: m.id,
            content: m.content,
            citations: m.citations,
            hasConfidentAnswer: m.hasConfidentAnswer,
            ...(m.source && { source: m.source }),
          }));
          setMessages(loaded);
        } catch { /* ignore */ }
      })();
    }
  }, [isBotThinking, conversationId, isPrivacyMode, isLoading]);

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

  const { data: availableKBs } = useQuery<KnowledgeBase[]>({
    queryKey: ["knowledge-bases"],
    queryFn: () =>
      fetch("/api/knowledge-bases", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) return [];
        return r.json() as Promise<KnowledgeBase[]>;
      }),
    staleTime: 60_000,
  });

  const systemReady = status?.ready ?? true;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages]);

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

  /** Label shown on the source selector button. */
  const kbSelectorLabel = targetKBs.length === 0
    ? "All Sources"
    : targetKBs.length === 1
      ? targetKBs[0]!.name
      : `${targetKBs.length} sources`;

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
        window.location.href = getLoginUrl();
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

      // Refresh sidebar immediately so the new conversation appears while streaming
      if (!isPrivacyMode) {
        void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      }

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

  const chatTitle = (() => {
    const firstUserMsg = messages.find((m) => m.role === "user");
    if (!firstUserMsg) return "New Chat";
    const text = firstUserMsg.content.slice(0, 80);
    return text.length < firstUserMsg.content.length ? text + "..." : text;
  })();

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-950">
      {/* Header bar */}
      <div className="border-b border-slate-200 dark:border-gray-800 px-6 py-3 flex items-center">
        <h1 className="text-sm font-semibold text-slate-900 dark:text-gray-100 truncate flex-1">{chatTitle}</h1>
        {!isPrivacyMode && conversationId && (
          <button
            onClick={() => setShowConvertDialog(true)}
            className="ml-3 p-1.5 rounded-lg text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
            title="Invite people to this chat"
          >
            <UserPlus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {displayMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            {privacyLevel === "vault" ? (
              <>
                <ShieldCheck className="w-8 h-8 text-emerald-400 mb-3" />
                <p className="text-slate-900 dark:text-gray-100 text-xl font-medium mb-2">Vault Mode</p>
                <p className="text-slate-400 dark:text-gray-500 text-sm max-w-sm">
                  Queries are processed entirely on your device. Nothing is sent to any server.
                </p>
                <p className="text-slate-300 dark:text-gray-600 text-xs max-w-sm mt-2">
                  Encrypted on-device. Supports text-based PDFs and Word docs. Scanned PDFs are not supported locally.
                </p>
              </>
            ) : privacyLevel === "private" ? (
              <>
                <EyeOff className="w-8 h-8 text-slate-400 dark:text-gray-500 mb-3" />
                <p className="text-slate-900 dark:text-gray-100 text-xl font-medium mb-2">Private Mode</p>
                <p className="text-slate-400 dark:text-gray-500 text-sm max-w-sm">
                  Your identity is hidden from administrators and conversations are not saved.
                  Queries are still processed on the organization's servers.
                </p>
              </>
            ) : systemReady ? (
              <>
                <p className="text-slate-900 dark:text-gray-100 text-xl font-medium mb-2">Ask a question</p>
                <p className="text-slate-400 dark:text-gray-500 text-sm max-w-sm">
                  Your questions are private. Only aggregate, anonymized topic trends are visible to administrators.
                </p>
              </>
            ) : (
              <>
                <p className="text-slate-900 dark:text-gray-100 text-xl font-medium mb-2">No sources yet</p>
                <p className="text-slate-400 dark:text-gray-500 text-sm max-w-sm">
                  {user?.isAdmin
                    ? "Upload documents from Data Sources to get started."
                    : "No documents have been loaded yet. Check back soon."}
                </p>
              </>
            )}
          </div>
        )}

        {displayMessages.map((message, i) => {
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
                <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-gray-500 bg-slate-50 dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-full px-4 py-2">
                  <CheckCircle className="w-3.5 h-3.5" />
                  {message.content}
                </div>
              </div>
            );
          }

          return (
            <div key={i} className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}>
              {message.role === "user" ? (
                <div className="flex gap-3 items-end justify-end max-w-xl">
                  <div className="bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-2xl rounded-tr-sm px-4 py-3 text-sm">
                    {message.content}
                  </div>
                  <div className="mb-1 flex-shrink-0">
                    <UserAvatar picture={user?.picture} name={user?.name} email={user?.email} />
                  </div>
                </div>
              ) : (
                <div className="flex gap-3 max-w-2xl w-full">
                  <div className="mt-1 flex-shrink-0">
                    <BotAvatar
                      orgAvatarUrl={user?.orgAvatarUrl}
                      privacyLevel={privacyLevel}
                      orgName={user?.orgName}
                    />
                  </div>
                <div className="min-w-0 flex-1 space-y-3">
                  {message.source === "admin" && (
                    <div className="text-xs font-medium text-blue-600 px-1">Admin Reply</div>
                  )}
                  <div className={cn(
                    "rounded-2xl rounded-tl-sm px-5 py-4 text-sm text-slate-800 dark:text-gray-200 leading-relaxed",
                    message.source === "admin"
                      ? "bg-blue-50 border border-blue-200"
                      : "bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800",
                  )}>
                    {message.isStreaming && !displayContent ? (
                      <ThinkingIndicator />
                    ) : (
                      <>
                        <div className={cn(...PROSE_CLASSES, "dark:prose-invert")}>
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
                          <span className="inline-block w-1.5 h-1.5 mt-2 rounded-full bg-slate-400 dark:bg-gray-500 animate-pulse" />
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
                              : "text-slate-500 dark:text-gray-400 bg-slate-100 dark:bg-gray-800",
                          )}>
                            {privacyLevel === "vault" ? (
                              <ShieldCheck className="w-3 h-3" />
                            ) : (
                              <EyeOff className="w-3 h-3" />
                            )}
                            {privacyLevel === "vault" ? "Vault — fully local" : "Private — not saved"}
                          </span>
                        ) : message.hasConfidentAnswer ? (
                          <p className="text-xs text-slate-400 dark:text-gray-500">
                            Verify all important answers with the appropriate human.
                          </p>
                        ) : null}
                      </div>
                    </div>
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
      <div className="border-t border-slate-200 dark:border-gray-800 px-6 py-4">
        {!systemReady ? (
          <div className="text-center text-sm text-slate-400 dark:text-gray-500 py-1">
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
                        : "text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900",
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
                  <div className="absolute left-0 bottom-full mb-1 w-56 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-xl shadow-lg py-1 z-10">
                    <button
                      onClick={() => handlePrivacySelect("standard")}
                      className={cn(
                        "w-full text-left px-3 py-2.5 text-xs transition-colors flex items-start gap-2.5",
                        privacyLevel === "standard" ? "bg-slate-50 dark:bg-gray-900" : "hover:bg-slate-50 dark:hover:bg-gray-900",
                      )}
                    >
                      <Eye className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-400 dark:text-gray-500" />
                      <div>
                        <span className={cn("block font-medium", privacyLevel === "standard" ? "text-slate-900 dark:text-gray-100" : "text-slate-700 dark:text-gray-300")}>Standard</span>
                        <span className="block text-[11px] text-slate-400 dark:text-gray-500 mt-0.5">Conversations saved normally</span>
                      </div>
                    </button>
                    {privateModeAvailable && (
                      <button
                        onClick={() => handlePrivacySelect("private")}
                        className={cn(
                          "w-full text-left px-3 py-2.5 text-xs transition-colors flex items-start gap-2.5",
                          privacyLevel === "private" ? "bg-amber-50/50" : "hover:bg-slate-50 dark:hover:bg-gray-900",
                        )}
                      >
                        <EyeOff className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-500" />
                        <div>
                          <span className={cn("block font-medium", privacyLevel === "private" ? "text-amber-700" : "text-slate-700 dark:text-gray-300")}>Private</span>
                          <span className="block text-[11px] text-slate-400 dark:text-gray-500 mt-0.5">Messages never saved to server</span>
                        </div>
                      </button>
                    )}
                    {vaultModeAvailable && (
                      <button
                        onClick={() => handlePrivacySelect("vault")}
                        className={cn(
                          "w-full text-left px-3 py-2.5 text-xs transition-colors flex items-start gap-2.5",
                          privacyLevel === "vault" ? "bg-emerald-50/50" : "hover:bg-slate-50 dark:hover:bg-gray-900",
                        )}
                      >
                        <ShieldCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-emerald-500" />
                        <div>
                          <span className={cn("block font-medium", privacyLevel === "vault" ? "text-emerald-700" : "text-slate-700 dark:text-gray-300")}>Vault</span>
                          <span className="block text-[11px] text-slate-400 dark:text-gray-500 mt-0.5">Encrypted, fully on-device</span>
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
                      : "text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900",
                  )}
                >
                  <Database className="w-3.5 h-3.5" />
                  {kbSelectorLabel}
                  <ChevronDown className={cn("w-3 h-3 transition-transform", kbSelectorOpen && "rotate-180")} />
                </button>

                {kbSelectorOpen && (
                  <div className="absolute left-0 bottom-full mb-1 w-64 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-xl shadow-lg py-1 z-20 max-h-64 overflow-y-auto">
                    {/* Default: All KBs */}
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setTargetKBs([]);
                        setKbSelectorOpen(false);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors",
                        targetKBs.length === 0 ? "bg-slate-50 dark:bg-gray-900 text-slate-900 dark:text-gray-100" : "text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900",
                      )}
                    >
                      <Database className="w-3.5 h-3.5 text-slate-400 dark:text-gray-500 flex-shrink-0" />
                      <span className="truncate">All sources</span>
                      {targetKBs.length === 0 && <Check className="w-3.5 h-3.5 ml-auto text-blue-500 flex-shrink-0" />}
                    </button>

                    {/* Individual KBs */}
                    {(availableKBs ?? []).filter((kb) => kb.status === "active").length > 0 && (
                      <div className="px-3 pt-1.5 pb-1 text-[10px] font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider border-t border-slate-100 dark:border-gray-800 mt-1">
                        Data Sources
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
                              isSelected ? "bg-slate-50 dark:bg-gray-900 text-slate-900 dark:text-gray-100" : "text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900",
                            )}
                          >
                            <Database className="w-3.5 h-3.5 text-slate-400 dark:text-gray-500 flex-shrink-0" />
                            <span className="truncate">{kb.name}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 ml-auto text-blue-500 flex-shrink-0" />}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
             </div>

              {/* Model selector — visible to all users */}
              <ModelPicker onModelLoading={setModelLoading} />
            </div>

            {/* Model loading overlay */}
            {modelLoading && (
              <div className="flex items-center justify-center gap-2 py-3 text-sm text-slate-500 dark:text-gray-400">
                <LoaderIcon className="w-4 h-4 animate-spin" />
                <span>Loading model... This may take a few seconds.</span>
              </div>
            )}

            <form onSubmit={(e) => void handleSubmit(e)} className={cn("space-y-2", modelLoading && "opacity-50 pointer-events-none")}>
              {/* KB target chips */}
              {targetKBs.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-1">
                  {targetKBs.map((kb) => (
                    <span
                      key={kb.id}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:text-gray-300"
                    >
                      @{kb.name}
                      <button
                        type="button"
                        onClick={() => setTargetKBs((prev) => prev.filter((t) => t.id !== kb.id))}
                        className="text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-400"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <ChatInput
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onSubmit={() => void handleSubmit({ preventDefault: () => {} } as React.FormEvent)}
                onStop={handleStop}
                isLoading={isLoading}
                overlay={
                  mentionPickerOpen ? (
                    <KBMentionPicker
                      ref={mentionPickerRef}
                      filter={mentionFilter}
                      knowledgeBases={availableKBs ?? []}
                      selected={targetKBs}
                      onSelect={handleMentionSelect}
                      onDismiss={() => setMentionPickerOpen(false)}
                    />
                  ) : undefined
                }
              />
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

      {/* Convert to group chat dialog */}
      {showConvertDialog && conversationId && (
        <GroupChatSetupDialog
          convertFromConversationId={conversationId}
          defaultName={chatTitle}
          onClose={() => setShowConvertDialog(false)}
        />
      )}
    </div>
  );
}
