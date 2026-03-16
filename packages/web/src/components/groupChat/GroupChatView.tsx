import { useState, useRef, useEffect, useCallback } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import {
  Users,
  Database,
  Send,
  Square,
  MessageSquare,
  UserPlus,
  Clock,
  ChevronDown,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { cleanContent, PROSE_CLASSES } from "@/lib/content";
import { adminLabel } from "@/lib/models";
import { useUser } from "@/contexts/UserContext";
import { CitationList } from "@/components/shared/CitationList";
import { ThreadPanel } from "./ThreadPanel";
import { InviteMemberDialog } from "./InviteMemberDialog";
import { ShareKBDialog } from "./ShareKBDialog";
import type {
  GroupChat,
  GroupChatMessage,
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
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
      <span className="text-xs text-slate-400 ml-1">Thinking...</span>
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
  const [localMessages, setLocalMessages] = useState<GroupChatMessage[]>([]);
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showShareKB, setShowShareKB] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [kbSelectorOpen, setKbSelectorOpen] = useState(false);
  const [selectedKBIds, setSelectedKBIds] = useState<string[]>([]); // empty = all shared KBs
  const [kbTooltipOpen, setKbTooltipOpen] = useState(false);

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
  const queryableKBs: { id: string; name: string; source: "shared" | "org"; sharedBy?: string }[] = [];
  const seenIds = new Set<string>();
  for (const s of chat?.sharedKBs ?? []) {
    if (!seenIds.has(s.knowledgeBaseId)) {
      seenIds.add(s.knowledgeBaseId);
      queryableKBs.push({
        id: s.knowledgeBaseId,
        name: s.knowledgeBaseName,
        source: "shared",
        sharedBy: s.sharedByName ?? s.sharedByEmail,
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
    ? "All KBs"
    : selectedKBIds.length === 1
      ? queryableKBs.find((kb) => kb.id === selectedKBIds[0])?.name ?? "1 KB"
      : `${selectedKBIds.length} KBs`;

  // Merge server + local messages
  const messages = (() => {
    const base = serverMessages ?? [];
    const serverIds = new Set(base.map((m) => m.id));
    const extras = localMessages.filter((m) => !serverIds.has(m.id));
    return [...base, ...extras];
  })();

  // ─── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamContent]);

  useEffect(() => {
    const es = new EventSource(`/api/group-chats/${id}/stream`, { withCredentials: true });
    es.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data) as GroupChatMessage;
        setLocalMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
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

    const hasBotTag = /@(?:bot|edgebric)\b/i.test(content);

    if (!hasBotTag) {
      try {
        const res = await fetch(`/api/group-chats/${id}/send`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        if (res.ok) {
          const msg = (await res.json()) as GroupChatMessage;
          setLocalMessages((prev) => [...prev, msg]);
        }
      } catch { /* ignore */ }
      setSending(false);
      return;
    }

    // Bot-tagged message — SSE streaming
    setStreaming(true);
    setStreamContent("");

    try {
      const res = await fetch(`/api/group-chats/${id}/send`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
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
                setStreamContent((prev) => prev + (parsed.delta ?? ""));
              } else if (eventType === "done") {
                setStreamContent("");
                setLocalMessages((prev) => [...prev, parsed as GroupChatMessage]);
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

  // ─── Loading / error ──────────────────────────────────────────────────────

  if (chatLoading) {
    return <div className="flex items-center justify-center h-full text-sm text-slate-400">Loading...</div>;
  }

  if (!chat) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-slate-500">Group chat not found</p>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b border-slate-200 px-6 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-slate-900 truncate">{chat.name}</h1>
            <div className="flex items-center gap-3 text-[11px] text-slate-400">
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
                {effectiveKBCount} KB{effectiveKBCount !== 1 ? "s" : ""}
                {kbTooltipOpen && queryableKBs.length > 0 && (
                  <div className="absolute left-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg py-2 z-30">
                    {queryableKBs.map((kb) => (
                      <div key={kb.id} className="px-3 py-1.5 flex items-start gap-2">
                        <Database className="w-3 h-3 text-slate-400 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-700 truncate">{kb.name}</p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {kb.source === "org" ? "Organization-wide" : `Shared by ${kb.sharedBy}`}
                          </p>
                        </div>
                      </div>
                    ))}
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

          {isCreator && isActive && (
            <button
              onClick={() => setShowInvite(true)}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              title="Invite member"
            >
              <UserPlus className="w-4 h-4" />
            </button>
          )}
          {isActive && (
            <button
              onClick={() => setShowShareKB(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              title="Share a Knowledge Base"
            >
              <Database className="w-3.5 h-3.5" />
              Share KB
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-1 min-h-0">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Users className="w-8 h-8 text-slate-300 mb-3" />
              <p className="text-slate-900 text-xl font-medium mb-2">{chat.name}</p>
              <p className="text-slate-400 text-sm max-w-sm">
                Tag <span className="font-medium">@bot</span> to query shared knowledge bases.
                Messages without @bot are human-to-human conversation.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isCurrentUser={msg.authorEmail === user?.email}
              onOpenThread={() => setThreadParentId(msg.id)}
            />
          ))}

          {streaming && streamContent && (
            <div className="flex gap-3 py-2">
              <div className="w-7 h-7 rounded-full bg-slate-900 flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] font-bold text-white">AI</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className={cn("text-sm text-slate-800", ...PROSE_CLASSES)}>
                  <Markdown>{cleanContent(streamContent)}</Markdown>
                </div>
              </div>
            </div>
          )}

          {streaming && !streamContent && <ThinkingDots />}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area — matches QueryInterface style */}
        {isActive ? (
          <div className="border-t border-slate-200 px-6 py-4">
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
                          : "text-slate-400 hover:text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      <Database className="w-3.5 h-3.5" />
                      {kbSelectorLabel}
                      <ChevronDown className={cn("w-3 h-3 transition-transform", kbSelectorOpen && "rotate-180")} />
                    </button>

                    {kbSelectorOpen && (
                      <div className="absolute left-0 bottom-full mb-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-20 max-h-64 overflow-y-auto">
                        {/* All KBs option */}
                        <button
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setSelectedKBIds([]);
                            setKbSelectorOpen(false);
                          }}
                          className={cn(
                            "w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors",
                            selectedKBIds.length === 0 ? "bg-slate-50 text-slate-900" : "text-slate-600 hover:bg-slate-50",
                          )}
                        >
                          <Database className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          <span className="truncate">All shared KBs</span>
                          {selectedKBIds.length === 0 && <Check className="w-3.5 h-3.5 ml-auto text-blue-500 flex-shrink-0" />}
                        </button>

                        {queryableKBs.length > 0 && (
                          <div className="px-3 pt-1.5 pb-1 text-[10px] font-medium text-slate-400 uppercase tracking-wider border-t border-slate-100 mt-1">
                            Knowledge Bases
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
                                isSelected ? "bg-slate-50 text-slate-900" : "text-slate-600 hover:bg-slate-50",
                              )}
                            >
                              <Database className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                              <span className="truncate">{kb.name}</span>
                              {kb.source === "org" && (
                                <span className="text-[10px] text-slate-300 ml-0.5">org</span>
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

              {/* KB target chips */}
              {selectedKBIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-1">
                  {selectedKBIds.map((kbId) => {
                    const kb = queryableKBs.find((k) => k.id === kbId);
                    return (
                      <span
                        key={kbId}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
                      >
                        @{kb?.name ?? kbId}
                        <button
                          type="button"
                          onClick={() => setSelectedKBIds((prev) => prev.filter((x) => x !== kbId))}
                          className="text-slate-400 hover:text-slate-600"
                        >
                          <span className="text-xs">&times;</span>
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Input + send */}
              <div className="flex gap-2 items-center">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendMessage();
                    }
                  }}
                  placeholder="Type a message... Use @bot to query knowledge bases"
                  rows={1}
                  className="w-full flex-1 resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent max-h-32 overflow-y-auto"
                  style={{ height: "auto" }}
                  onInput={(e) => {
                    const target = e.currentTarget;
                    target.style.height = "auto";
                    target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
                  }}
                  disabled={sending}
                />
                {streaming ? (
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-1.5 bg-slate-100 text-slate-700 rounded-xl px-4 h-[42px] text-sm font-medium hover:bg-red-50 hover:text-red-600 hover:border-red-200 border border-slate-200 transition-colors flex-shrink-0"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={() => void sendMessage()}
                    disabled={!input.trim() || sending}
                    className="inline-flex items-center justify-center gap-1.5 bg-slate-900 text-white rounded-xl px-4 h-[42px] text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="border-t border-slate-200 px-6 py-3 text-center text-xs text-slate-400">
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
        />
      )}

      {/* Dialogs */}
      {showInvite && chat && (
        <InviteMemberDialog
          groupChatId={chat.id}
          existingMembers={chat.members}
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
}: {
  message: GroupChatMessage;
  isCurrentUser: boolean;
  onOpenThread: () => void;
}) {
  if (message.role === "system") {
    return (
      <div className="text-center py-1">
        <span className="text-[11px] text-slate-400 bg-slate-50 rounded-full px-3 py-1">
          {message.content}
        </span>
      </div>
    );
  }

  const isBot = message.role === "assistant";

  return (
    <div className={cn("flex gap-3 py-2 group", isCurrentUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold",
          isBot ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-600",
        )}
      >
        {isBot ? "AI" : (message.authorName ?? message.authorEmail ?? "?").charAt(0).toUpperCase()}
      </div>

      {/* Content */}
      <div className={cn("flex-1 min-w-0", isCurrentUser && "text-right")}>
        <div className="flex items-baseline gap-2 mb-0.5">
          {!isCurrentUser && (
            <span className="text-xs font-medium text-slate-700">
              {isBot ? "Edgebric" : (message.authorName ?? message.authorEmail)}
            </span>
          )}
          <span className="text-[10px] text-slate-400">{formatTime(message.createdAt)}</span>
        </div>

        <div
          className={cn(
            "inline-block text-left rounded-2xl px-4 py-2 text-sm max-w-[80%]",
            isBot
              ? "bg-slate-50 text-slate-800"
              : isCurrentUser
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-800",
          )}
        >
          {isBot ? (
            <div className={cn(...PROSE_CLASSES)}>
              <Markdown>{cleanContent(message.content)}</Markdown>
            </div>
          ) : (
            <p className="whitespace-pre-wrap">{message.content}</p>
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
            <button
              onClick={onOpenThread}
              className="opacity-0 group-hover:opacity-100 text-[11px] text-slate-400 hover:text-slate-600 transition-opacity flex items-center gap-1"
            >
              <MessageSquare className="w-3 h-3" />
              {message.threadReplyCount && message.threadReplyCount > 0
                ? `${message.threadReplyCount} ${message.threadReplyCount === 1 ? "reply" : "replies"}`
                : "Reply in thread"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
