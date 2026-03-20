import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import {
  Users,
  Database,
  MessageSquare,
  UserPlus,
  Clock,
  ChevronDown,
  Check,
  Building2,
  Sparkles,
  AtSign,
  UserMinus,
  Bell,
  BellOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { cleanContent, PROSE_CLASSES } from "@/lib/content";
import { adminLabel } from "@/lib/models";
import { useUser } from "@/contexts/UserContext";
import { CitationList } from "@/components/shared/CitationList";
import { ChatInput } from "@/components/shared/ChatInput";
import { ThreadPanel } from "./ThreadPanel";
import { InviteMemberDialog } from "./InviteMemberDialog";
import { ShareKBDialog } from "./ShareKBDialog";
import type {
  GroupChat,
  GroupChatMessage,
  GroupChatNotifLevel,
  KnowledgeBase,
} from "@edgebric/types";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MILMModel {
  id: string;
  readyToUse: boolean;
}
interface ModelsResponse {
  models: MILMModel[];
  activeModel: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─── Thinking Indicator ─────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1 px-2">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-500 animate-bounce [animation-delay:0ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-500 animate-bounce [animation-delay:150ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-500 animate-bounce [animation-delay:300ms]" />
      <span className="text-xs text-slate-400 dark:text-gray-500 ml-1">Thinking...</span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function GroupChatView() {
  const { id } = useParams({ from: "/_shell/group-chats/$id" });
  const user = useUser();
  const queryClient = useQueryClient();

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [streamRevealed, setStreamRevealed] = useState("");
  const [streamPrevRevealed, setStreamPrevRevealed] = useState("");
  const [localMessages, setLocalMessages] = useState<GroupChatMessage[]>([]);
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showShareKB, setShowShareKB] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [kbSelectorOpen, setKbSelectorOpen] = useState(false);
  const [selectedKBIds, setSelectedKBIds] = useState<string[]>([]); // empty = all shared KBs
  const [kbTooltipOpen, setKbTooltipOpen] = useState(false);
  const [sendMode, setSendMode] = useState<"chat" | "ai">("chat");
  const [notifMenuOpen, setNotifMenuOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ─── Queries ────────────────────────────────────────────────────────────────

  const { data: chat, isLoading: chatLoading } = useQuery<GroupChat>({
    queryKey: ["group-chat", id],
    queryFn: () =>
      fetch(`/api/group-chats/${id}`, { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<GroupChat>;
      }),
  });

  const { data: serverMessages } = useQuery<GroupChatMessage[]>({
    queryKey: ["group-chat-messages", id],
    queryFn: () =>
      fetch(`/api/group-chats/${id}/messages`, { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<GroupChatMessage[]>;
      }),
    refetchInterval: 5000,
  });

  // Fetch all org KBs to show org-wide ones alongside shared ones
  const { data: allKBs } = useQuery<KnowledgeBase[]>({
    queryKey: ["knowledge-bases"],
    queryFn: () =>
      fetch("/api/knowledge-bases", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) return [];
        return r.json() as Promise<KnowledgeBase[]>;
      }),
    staleTime: 30_000,
  });

  // Notification preference for this chat
  const { data: notifPrefData } = useQuery<{ level: GroupChatNotifLevel }>({
    queryKey: ["group-chat-notif-pref", id],
    queryFn: () =>
      fetch(`/api/notifications/group-chat-pref/${id}`, { credentials: "same-origin" }).then((r) => {
        if (!r.ok) return { level: "all" as GroupChatNotifLevel };
        return r.json() as Promise<{ level: GroupChatNotifLevel }>;
      }),
    staleTime: 60_000,
  });

  const notifLevel = notifPrefData?.level ?? "all";

  const setNotifLevel = useCallback(async (level: GroupChatNotifLevel) => {
    await fetch("/api/notifications/group-chat-pref", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupChatId: id, level }),
    });
    void queryClient.invalidateQueries({ queryKey: ["group-chat-notif-pref", id] });
    setNotifMenuOpen(false);
  }, [id, queryClient]);

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

  const activeModel = modelsData?.activeModel;
  const readyModels = (modelsData?.models ?? []).filter((m) => m.readyToUse);

  // ─── Derived data ──────────────────────────────────────────────────────────

  // Org-wide KBs that are accessible to everyone (not explicitly shared but available)
  const orgWideKBs = (allKBs ?? []).filter(
    (kb) => kb.status === "active" && kb.type === "organization" && kb.accessMode === "all",
  );
  const sharedKBIds = new Set((chat?.sharedKBs ?? []).map((s) => s.knowledgeBaseId));
  // Effective KBs = explicitly shared + org-wide (deduplicated)
  const effectiveKBCount = new Set([
    ...Array.from(sharedKBIds),
    ...orgWideKBs.map((kb) => kb.id),
  ]).size;

  // Build a list of all queryable KBs for the selector and tooltip
  const queryableKBs: { id: string; name: string; source: "shared" | "org"; sharedBy?: string; shareId?: string; sharedByEmail?: string }[] = [];
  const seenIds = new Set<string>();
  for (const s of chat?.sharedKBs ?? []) {
    if (!seenIds.has(s.knowledgeBaseId)) {
      seenIds.add(s.knowledgeBaseId);
      queryableKBs.push({
        id: s.knowledgeBaseId,
        name: s.knowledgeBaseName,
        source: "shared",
        sharedBy: s.sharedByName ?? s.sharedByEmail,
        shareId: s.id,
        sharedByEmail: s.sharedByEmail,
      });
    }
  }
  for (const kb of orgWideKBs) {
    if (!seenIds.has(kb.id)) {
      seenIds.add(kb.id);
      queryableKBs.push({ id: kb.id, name: kb.name, source: "org" });
    }
  }

  const kbSelectorLabel = selectedKBIds.length === 0
    ? "All Data Sources"
    : selectedKBIds.length === 1
      ? queryableKBs.find((kb) => kb.id === selectedKBIds[0])?.name ?? "1 data source"
      : `${selectedKBIds.length} data sources`;

  // Merge server + local messages
  const messages = (() => {
    const base = serverMessages ?? [];
    const serverIds = new Set(base.map((m) => m.id));
    const extras = localMessages.filter((m) => !serverIds.has(m.id));
    return [...base, ...extras];
  })();

  // ─── Effects ───────────────────────────────────────────────────────────────

  // Mark group chat as read when viewing it
  useEffect(() => {
    fetch("/api/notifications/mark-read-group-chat", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupChatId: id }),
    }).catch(() => {});
    // Also clear the unread badge in the sidebar cache
    void queryClient.invalidateQueries({ queryKey: ["unread-group-chats"] });
  }, [id, queryClient]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamContent]);

  useEffect(() => {
    const es = new EventSource(`/api/group-chats/${id}/stream`, { withCredentials: true });
    es.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data) as GroupChatMessage;
        // Skip thread replies — they only show in the thread panel
        if (msg.threadParentId) return;
        setLocalMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        // Re-mark as read since we're actively viewing this chat
        fetch("/api/notifications/mark-read-group-chat", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupChatId: id }),
        }).catch(() => {});
      } catch { /* ignore */ }
    });
    es.onerror = () => {};
    return () => es.close();
  }, [id]);

  useEffect(() => {
    if (serverMessages) {
      const serverIds = new Set(serverMessages.map((m) => m.id));
      setLocalMessages((prev) => prev.filter((m) => !serverIds.has(m.id)));
    }
  }, [serverMessages]);

  // ─── Send ──────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const content = input.trim();
    if (!content || sending) return;

    setInput("");
    setSending(true);

    try {
      const res = await fetch(`/api/group-chats/${id}/send`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        const msg = (await res.json()) as GroupChatMessage;
        setLocalMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    } catch { /* ignore */ }
    setSending(false);
  }, [input, sending, id]);

  const askBot = useCallback(async () => {
    const content = input.trim();
    if (!content || sending) return;

    setInput("");
    setSending(true);
    setStreaming(true);
    setStreamContent("");
    setStreamRevealed("");
    setStreamPrevRevealed("");

    // Prepend @bot so the server triggers the RAG pipeline
    const botContent = `@bot ${content}`;

    try {
      const res = await fetch(`/api/group-chats/${id}/send`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: botContent,
          knowledgeBaseIds: selectedKBIds.length > 0 ? selectedKBIds : undefined,
        }),
      });

      if (!res.ok || !res.body) {
        setStreaming(false);
        setSending(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (eventType === "user_message") {
                setLocalMessages((prev) => {
                  if (prev.some((m) => m.id === parsed.id)) return prev;
                  return [...prev, parsed as GroupChatMessage];
                });
              } else if (eventType === "delta") {
                setStreamContent((prev) => {
                  const newContent = prev + (parsed.delta ?? "");
                  const cleaned = cleanContent(newContent);
                  const parts = cleaned.split(/\n\n/);
                  const revealed = parts.length > 1 ? parts.slice(0, -1).join("\n\n") : "";
                  setStreamRevealed((prevRevealed) => {
                    if (revealed !== prevRevealed) {
                      setStreamPrevRevealed(prevRevealed);
                    }
                    return revealed;
                  });
                  return newContent;
                });
              } else if (eventType === "done") {
                setStreamContent("");
                setLocalMessages((prev) => {
                  if (prev.some((m) => m.id === (parsed as GroupChatMessage).id)) return prev;
                  return [...prev, parsed as GroupChatMessage];
                });
              } else if (eventType === "error") {
                setStreamContent("");
              }
            } catch { /* ignore */ }
          }
        }
      }
    } catch { /* ignore */ }

    setStreaming(false);
    setSending(false);
    void queryClient.invalidateQueries({ queryKey: ["group-chat-messages", id] });
  }, [input, sending, id, queryClient, selectedKBIds]);

  const isCreator = chat?.creatorEmail === user?.email;
  const isActive = chat?.status === "active";

  // Build member picture lookup
  const memberPictures = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of chat?.members ?? []) {
      if (m.picture) map.set(m.userEmail, m.picture);
    }
    return map;
  }, [chat?.members]);

  // ─── Loading / error ──────────────────────────────────────────────────────

  if (chatLoading) {
    return <div className="flex items-center justify-center h-full text-sm text-slate-400 dark:text-gray-500">Loading...</div>;
  }

  if (!chat) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-slate-500 dark:text-gray-400">Group chat not found</p>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b border-slate-200 dark:border-gray-800 px-6 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-slate-900 dark:text-gray-100 truncate">{chat.name}</h1>
            <div className="flex items-center gap-3 text-[11px] text-slate-400 dark:text-gray-500">
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {chat.members.length} member{chat.members.length !== 1 ? "s" : ""}
              </span>
              <span
                className="flex items-center gap-1 relative cursor-default"
                onMouseEnter={() => setKbTooltipOpen(true)}
                onMouseLeave={() => setKbTooltipOpen(false)}
              >
                <Database className="w-3 h-3" />
                {effectiveKBCount} data source{effectiveKBCount !== 1 ? "s" : ""}
                {kbTooltipOpen && queryableKBs.length > 0 && (
                  <div className="absolute left-0 top-full pt-1 z-30">
                    <div className="w-72 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-xl shadow-lg py-2">
                      {queryableKBs.map((kb) => {
                        const canRevoke = isActive && kb.source === "shared" && kb.sharedByEmail?.toLowerCase() === user?.email?.toLowerCase();
                        return (
                          <div key={kb.id} className="px-3 py-1.5 flex items-start gap-2 group/kb">
                            <Database className="w-3 h-3 text-slate-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-slate-700 dark:text-gray-300 truncate">{kb.name}</p>
                              <p className="text-[10px] text-slate-400 dark:text-gray-500 truncate">
                                {kb.source === "org" ? "Organization-wide" : `Shared by ${kb.sharedBy}`}
                              </p>
                            </div>
                            {canRevoke && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!kb.shareId || !chat) return;
                                  await fetch(`/api/group-chats/${chat.id}/shared-kbs/${kb.shareId}`, {
                                    method: "DELETE",
                                    credentials: "same-origin",
                                  });
                                  void queryClient.invalidateQueries({ queryKey: ["group-chat", chat.id] });
                                }}
                                className="text-[10px] text-red-500 hover:text-red-700 flex-shrink-0"
                                title="Revoke sharing"
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </span>
              {chat.expiresAt && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {chat.status === "expired" ? "Expired" : `Expires ${new Date(chat.expiresAt).toLocaleDateString()}`}
                </span>
              )}
            </div>
          </div>

          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
            title={isCreator && isActive ? "Manage members" : "View members"}
          >
            {isCreator && isActive ? <UserPlus className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
            Members
          </button>
          {isActive && (
            <button
              onClick={() => setShowShareKB(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
              title="Share a Data Source"
            >
              <Database className="w-3.5 h-3.5" />
              Share Data Source
            </button>
          )}

          {/* Notification settings */}
          <div className="relative">
            <button
              onClick={() => setNotifMenuOpen((v) => !v)}
              className={cn(
                "p-1.5 rounded-lg transition-colors",
                notifLevel === "none"
                  ? "text-slate-300 dark:text-gray-600 hover:text-slate-500 dark:hover:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800"
                  : "text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800",
              )}
              title={`Notifications: ${notifLevel}`}
            >
              {notifLevel === "none" ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
            </button>
            {notifMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setNotifMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-xl shadow-lg py-1 w-48">
                  <div className="px-3 py-1.5 text-[10px] font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider">
                    Notify me
                  </div>
                  {(["all", "mentions", "none"] as GroupChatNotifLevel[]).map((level) => (
                    <button
                      key={level}
                      onClick={() => void setNotifLevel(level)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors",
                        notifLevel === level
                          ? "text-slate-900 dark:text-gray-100 bg-slate-50 dark:bg-gray-900 font-medium"
                          : "text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900",
                      )}
                    >
                      {level === "all" && <Bell className="w-3.5 h-3.5" />}
                      {level === "mentions" && <AtSign className="w-3.5 h-3.5" />}
                      {level === "none" && <BellOff className="w-3.5 h-3.5" />}
                      <span className="flex-1 text-left">
                        {level === "all" && "All messages"}
                        {level === "mentions" && "Mentions only"}
                        {level === "none" && "Nothing"}
                      </span>
                      {notifLevel === level && <Check className="w-3.5 h-3.5 text-blue-500" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-1 min-h-0">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Users className="w-8 h-8 text-slate-300 dark:text-gray-600 mb-3" />
              <p className="text-slate-900 dark:text-gray-100 text-xl font-medium mb-2">{chat.name}</p>
              <p className="text-slate-400 dark:text-gray-500 text-sm max-w-sm">
                Use the <span className="font-medium">Ask</span> button to query data sources.
                Press Enter or Send for human-to-human conversation.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isCurrentUser={msg.authorEmail === user?.email}
              onOpenThread={() => setThreadParentId(msg.id)}
              orgAvatarUrl={user?.orgAvatarUrl}
              orgName={user?.orgName}
              memberPicture={msg.authorEmail ? memberPictures.get(msg.authorEmail) : undefined}
              canKick={isCreator && isActive}
              onMention={(name) => {
                setInput((prev) => `${prev}@${name} `);
                inputRef.current?.focus();
              }}
              onKick={async (email) => {
                await fetch(`/api/group-chats/${id}/members/${encodeURIComponent(email)}`, {
                  method: "DELETE",
                  credentials: "same-origin",
                });
                void queryClient.invalidateQueries({ queryKey: ["group-chat", id] });
              }}
            />
          ))}

          {streaming && (
            <div className="flex gap-3 py-2">
              <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-gray-800 border border-slate-200 dark:border-gray-800 flex items-center justify-center flex-shrink-0 overflow-hidden" title={user?.orgName}>
                {user?.orgAvatarUrl ? (
                  <img src={user.orgAvatarUrl} alt={user.orgName ?? "Organization"} className="w-full h-full object-cover" />
                ) : (
                  <Building2 className="w-3.5 h-3.5 text-slate-400 dark:text-gray-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                {streamRevealed ? (() => {
                  const displayContent = cleanContent(streamRevealed);
                  const settledContent = cleanContent(streamPrevRevealed);
                  const newContent = displayContent.length > settledContent.length
                    ? displayContent.slice(settledContent.length)
                    : undefined;
                  return (
                    <div className={cn("text-sm text-slate-800 dark:text-gray-200", ...PROSE_CLASSES)}>
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
                      <span className="inline-block w-1.5 h-1.5 mt-2 rounded-full bg-slate-400 dark:bg-gray-500 animate-pulse" />
                    </div>
                  );
                })() : (
                  <ThinkingDots />
                )}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area — matches QueryInterface style */}
        {isActive ? (
          <div className="border-t border-slate-200 dark:border-gray-800 px-6 py-4">
            <div className="space-y-2">
              {/* Controls row: KB selector (left) + model selector (right) */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {/* KB scope selector */}
                  <div className="relative">
                    <button
                      onClick={() => setKbSelectorOpen((o) => !o)}
                      className={cn(
                        "flex items-center gap-1.5 text-xs transition-colors px-2 py-1 rounded-lg",
                        selectedKBIds.length > 0
                          ? "text-blue-600 hover:bg-blue-50"
                          : "text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-900",
                      )}
                    >
                      <Database className="w-3.5 h-3.5" />
                      {kbSelectorLabel}
                      <ChevronDown className={cn("w-3 h-3 transition-transform", kbSelectorOpen && "rotate-180")} />
                    </button>

                    {kbSelectorOpen && (
                      <div className="absolute left-0 bottom-full mb-1 w-64 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-xl shadow-lg py-1 z-20 max-h-64 overflow-y-auto">
                        {/* All KBs option */}
                        <button
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setSelectedKBIds([]);
                            setKbSelectorOpen(false);
                          }}
                          className={cn(
                            "w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors",
                            selectedKBIds.length === 0 ? "bg-slate-50 dark:bg-gray-900 text-slate-900 dark:text-gray-100" : "text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900",
                          )}
                        >
                          <Database className="w-3.5 h-3.5 text-slate-400 dark:text-gray-500 flex-shrink-0" />
                          <span className="truncate">All shared data sources</span>
                          {selectedKBIds.length === 0 && <Check className="w-3.5 h-3.5 ml-auto text-blue-500 flex-shrink-0" />}
                        </button>

                        {queryableKBs.length > 0 && (
                          <div className="px-3 pt-1.5 pb-1 text-[10px] font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider border-t border-slate-100 dark:border-gray-800 mt-1">
                            Data Sources
                          </div>
                        )}
                        {queryableKBs.map((kb) => {
                          const isSelected = selectedKBIds.includes(kb.id);
                          return (
                            <button
                              key={kb.id}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setSelectedKBIds((prev) =>
                                  isSelected ? prev.filter((x) => x !== kb.id) : [...prev, kb.id],
                                );
                              }}
                              className={cn(
                                "w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors",
                                isSelected ? "bg-slate-50 dark:bg-gray-900 text-slate-900 dark:text-gray-100" : "text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900",
                              )}
                            >
                              <Database className="w-3.5 h-3.5 text-slate-400 dark:text-gray-500 flex-shrink-0" />
                              <span className="truncate">{kb.name}</span>
                              {kb.source === "org" && (
                                <span className="text-[10px] text-slate-300 dark:text-gray-600 ml-0.5">org</span>
                              )}
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
                  <div className="relative">
                    <button
                      onClick={() => setModelPickerOpen((o) => !o)}
                      disabled={switchModelMutation.isPending}
                      className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300 transition-colors px-2 py-1 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-900"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                      {adminLabel(activeModel)}
                      <ChevronDown className={cn("w-3 h-3 transition-transform", modelPickerOpen && "rotate-180")} />
                    </button>

                    {modelPickerOpen && (
                      <div className="absolute right-0 bottom-full mb-1 w-48 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-xl shadow-lg py-1 z-10">
                        {readyModels.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => switchModelMutation.mutate(m.id)}
                            disabled={switchModelMutation.isPending}
                            className={cn(
                              "w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2",
                              m.id === activeModel
                                ? "text-slate-900 dark:text-gray-100 font-medium bg-slate-50 dark:bg-gray-900"
                                : "text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900",
                            )}
                          >
                            <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", m.id === activeModel ? "bg-green-400" : "bg-slate-200 dark:bg-gray-700")} />
                            {adminLabel(m.id)}
                            {m.id === activeModel && <span className="ml-auto text-slate-400 dark:text-gray-500">active</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* KB target chips */}
              {selectedKBIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-1">
                  {selectedKBIds.map((kbId) => {
                    const kb = queryableKBs.find((k) => k.id === kbId);
                    return (
                      <span
                        key={kbId}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:text-gray-300"
                      >
                        @{kb?.name ?? kbId}
                        <button
                          type="button"
                          onClick={() => setSelectedKBIds((prev) => prev.filter((x) => x !== kbId))}
                          className="text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300"
                        >
                          <span className="text-xs">&times;</span>
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Input + send */}
              <ChatInput
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onSubmit={() => void sendMessage()}
                onAsk={() => void askBot()}
                sendMode={sendMode}
                onSendModeChange={setSendMode}
                isLoading={sending}
                isStreaming={streaming}
                disabled={sending}
                placeholder="Type a message..."
              />
            </div>
          </div>
        ) : (
          <div className="border-t border-slate-200 dark:border-gray-800 px-6 py-3 text-center text-xs text-slate-400 dark:text-gray-500">
            This group chat is {chat.status}. Messages are read-only.
          </div>
        )}
      </div>

      {/* Thread panel */}
      {threadParentId && (
        <ThreadPanel
          groupChatId={id}
          parentId={threadParentId}
          parentMessage={messages.find((m) => m.id === threadParentId)}
          onClose={() => setThreadParentId(null)}
          isActive={isActive}
          memberPictures={memberPictures}
        />
      )}

      {/* Dialogs */}
      {showInvite && chat && (
        <InviteMemberDialog
          groupChatId={chat.id}
          existingMembers={chat.members}
          creatorEmail={chat.creatorEmail}
          isActive={isActive}
          onClose={() => setShowInvite(false)}
        />
      )}
      {showShareKB && chat && (
        <ShareKBDialog
          groupChatId={chat.id}
          existingShares={chat.sharedKBs}
          onClose={() => setShowShareKB(false)}
        />
      )}
    </div>
  );
}

// ─── Message Bubble ─────────────────────────────────────────────────────────

function MessageBubble({
  message,
  isCurrentUser,
  onOpenThread,
  orgAvatarUrl,
  orgName,
  memberPicture,
  canKick,
  onMention,
  onKick,
}: {
  message: GroupChatMessage;
  isCurrentUser: boolean;
  onOpenThread: () => void;
  orgAvatarUrl?: string;
  orgName?: string;
  memberPicture?: string;
  canKick?: boolean;
  onMention?: (name: string) => void;
  onKick?: (email: string) => Promise<void>;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  if (message.role === "system") {
    return (
      <div className="text-center py-1">
        <span className="text-[11px] text-slate-400 dark:text-gray-500 bg-slate-50 dark:bg-gray-900 rounded-full px-3 py-1">
          {message.content}
        </span>
      </div>
    );
  }

  const isBot = message.role === "assistant";
  const isAIQuery = !isBot && /^@(?:bot|edgebric)\b/i.test(message.content);
  const initial = (message.authorName ?? message.authorEmail ?? "?").charAt(0).toUpperCase();
  const authorDisplayName = message.authorName ?? message.authorEmail ?? "Unknown";
  const canShowMenu = !isBot && !isCurrentUser && !!message.authorEmail;

  return (
    <div className={cn("flex gap-3 py-2 group", isCurrentUser && "flex-row-reverse")}>
      {/* Avatar */}
      {isBot ? (
        <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-gray-800 border border-slate-200 dark:border-gray-800 flex items-center justify-center flex-shrink-0 overflow-hidden" title={orgName}>
          {orgAvatarUrl ? (
            <img src={orgAvatarUrl} alt={orgName ?? "Organization"} className="w-full h-full object-cover" />
          ) : (
            <Building2 className="w-3.5 h-3.5 text-slate-400 dark:text-gray-500" />
          )}
        </div>
      ) : (
        <div
          className={cn(
            "w-7 h-7 rounded-full bg-slate-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden",
            canShowMenu && "cursor-pointer hover:ring-2 hover:ring-slate-300 dark:hover:ring-gray-600 transition-shadow",
          )}
          title={message.authorName ?? message.authorEmail}
          onClick={canShowMenu ? () => setShowMenu((v) => !v) : undefined}
        >
          {memberPicture ? (
            <img src={memberPicture} alt={message.authorName ?? "User"} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span className="text-[10px] font-bold text-slate-600 dark:text-gray-400">{initial}</span>
          )}
        </div>
      )}

      {/* Content */}
      <div className={cn("flex-1 min-w-0", isCurrentUser && "text-right")}>
        <div className={cn("flex items-baseline gap-2 mb-0.5", isCurrentUser && "justify-end")}>
          {!isCurrentUser && (
            <span className="relative inline-block" ref={menuRef}>
              <button
                type="button"
                onClick={canShowMenu ? () => setShowMenu((v) => !v) : undefined}
                className={cn(
                  "text-xs font-medium text-slate-700 dark:text-gray-300",
                  canShowMenu && "hover:text-slate-900 dark:hover:text-gray-100 hover:underline cursor-pointer",
                )}
              >
                {isBot ? "Edgebric" : authorDisplayName}
              </button>

              {showMenu && canShowMenu && (
                <div className="absolute left-0 top-full mt-1 z-30 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-lg shadow-lg py-1 w-40">
                  <button
                    type="button"
                    onClick={() => {
                      onMention?.(authorDisplayName.split(" ")[0] ?? authorDisplayName);
                      setShowMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-900 transition-colors"
                  >
                    <AtSign className="w-3 h-3 text-slate-400 dark:text-gray-500" />
                    Mention
                  </button>
                  {canKick && (
                    <button
                      type="button"
                      onClick={async () => {
                        setShowMenu(false);
                        await onKick?.(message.authorEmail!);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <UserMinus className="w-3 h-3" />
                      Remove from chat
                    </button>
                  )}
                </div>
              )}
            </span>
          )}
          <span className="text-[10px] text-slate-400 dark:text-gray-500">{formatTime(message.createdAt)}</span>
          {isAIQuery && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 dark:text-gray-500">
              <Sparkles className="w-2.5 h-2.5" />
              Asked AI
            </span>
          )}
        </div>

        <div
          className={cn(
            "inline-block text-left rounded-2xl px-4 py-2 text-sm max-w-[80%]",
            isBot
              ? "bg-slate-50 dark:bg-gray-900 text-slate-800 dark:text-gray-200"
              : isAIQuery && isCurrentUser
                ? "bg-slate-800 dark:bg-gray-200 text-white dark:text-gray-900 border border-slate-600 dark:border-gray-400"
                : isCurrentUser
                  ? "bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900"
                  : isAIQuery
                    ? "bg-slate-100 dark:bg-gray-800 text-slate-800 dark:text-gray-200 border border-slate-300 dark:border-gray-600"
                    : "bg-slate-100 dark:bg-gray-800 text-slate-800 dark:text-gray-200",
          )}
        >
          {isBot ? (
            <div className={cn(...PROSE_CLASSES)}>
              <Markdown>{cleanContent(message.content)}</Markdown>
            </div>
          ) : (
            <p className="whitespace-pre-wrap">{message.content.replace(/^@(?:bot|edgebric)\s+/i, "")}</p>
          )}
        </div>

        {/* Citations */}
        {message.citations && message.citations.length > 0 && (
          <div className="mt-1">
            <CitationList citations={message.citations} onSourceClick={() => {}} />
          </div>
        )}

        {/* Thread button */}
        {!message.threadParentId && (
          <div className="mt-0.5">
            {message.threadReplyCount && message.threadReplyCount > 0 ? (
              <button
                onClick={onOpenThread}
                className="text-[11px] text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 transition-colors flex items-center gap-1.5"
              >
                {/* Participant avatars */}
                {message.threadParticipants && message.threadParticipants.length > 0 && (
                  <span className="flex -space-x-1.5">
                    {message.threadParticipants.slice(0, 4).map((p) => (
                      <span key={p.email} className="w-4 h-4 rounded-full border border-white dark:border-gray-950 overflow-hidden flex-shrink-0 inline-flex items-center justify-center bg-slate-200 dark:bg-gray-700">
                        {p.picture ? (
                          <img src={p.picture} alt={p.name ?? p.email} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <span className="text-[7px] font-bold text-slate-500 dark:text-gray-400">{(p.name ?? p.email).charAt(0).toUpperCase()}</span>
                        )}
                      </span>
                    ))}
                  </span>
                )}
                <MessageSquare className="w-3 h-3" />
                {message.threadReplyCount} {message.threadReplyCount === 1 ? "reply" : "replies"}
              </button>
            ) : (
              <button
                onClick={onOpenThread}
                className="opacity-0 group-hover:opacity-100 text-[11px] text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300 transition-opacity flex items-center gap-1"
              >
                <MessageSquare className="w-3 h-3" />
                Reply in thread
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
