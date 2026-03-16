import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import {
  ArrowLeft,
  Users,
  Database,
  Send,
  MessageSquare,
  UserPlus,
  Share2,
  MoreVertical,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { cleanContent, PROSE_CLASSES } from "@/lib/content";
import { useUser } from "@/contexts/UserContext";
import { CitationList } from "@/components/shared/CitationList";
import { ThreadPanel } from "./ThreadPanel";
import { InviteMemberDialog } from "./InviteMemberDialog";
import { ShareKBDialog } from "./ShareKBDialog";
import type {
  GroupChat,
  GroupChatMessage,
  GroupChatMember,
} from "@edgebric/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function memberInitial(member: GroupChatMember | { authorName?: string; authorEmail?: string }): string {
  const name = ("userName" in member ? member.userName : (member as any).authorName) ??
    ("userEmail" in member ? member.userEmail : (member as any).authorEmail) ??
    "?";
  return name.charAt(0).toUpperCase();
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch chat detail
  const { data: chat, isLoading: chatLoading } = useQuery<GroupChat>({
    queryKey: ["group-chat", id],
    queryFn: () =>
      fetch(`/api/group-chats/${id}`, { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<GroupChat>;
      }),
  });

  // Fetch messages
  const { data: serverMessages } = useQuery<GroupChatMessage[]>({
    queryKey: ["group-chat-messages", id],
    queryFn: () =>
      fetch(`/api/group-chats/${id}/messages`, { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<GroupChatMessage[]>;
      }),
    refetchInterval: 5000,
  });

  // Merge server + local messages (dedup by id)
  const messages = (() => {
    const base = serverMessages ?? [];
    const serverIds = new Set(base.map((m) => m.id));
    const extras = localMessages.filter((m) => !serverIds.has(m.id));
    return [...base, ...extras];
  })();

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamContent]);

  // SSE for real-time updates
  useEffect(() => {
    const es = new EventSource(`/api/group-chats/${id}/stream`, { withCredentials: true });

    es.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data) as GroupChatMessage;
        setLocalMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      } catch { /* ignore parse errors */ }
    });

    es.onerror = () => {
      // EventSource will auto-reconnect
    };

    return () => es.close();
  }, [id]);

  // Clear local messages when server messages refresh
  useEffect(() => {
    if (serverMessages) {
      const serverIds = new Set(serverMessages.map((m) => m.id));
      setLocalMessages((prev) => prev.filter((m) => !serverIds.has(m.id)));
    }
  }, [serverMessages]);

  const sendMessage = useCallback(async () => {
    const content = input.trim();
    if (!content || sending) return;

    setInput("");
    setSending(true);

    const hasBotTag = /@(?:bot|edgebric)\b/i.test(content);

    if (!hasBotTag) {
      // Simple message — JSON response
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
        body: JSON.stringify({ content }),
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
  }, [input, sending, id, queryClient]);

  const isCreator = chat?.creatorEmail === user?.email;
  const isActive = chat?.status === "active";

  if (chatLoading) {
    return <div className="flex items-center justify-center h-full text-sm text-slate-400">Loading...</div>;
  }

  if (!chat) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-slate-500">Group chat not found</p>
        <Link to="/group-chats" className="text-sm text-slate-900 underline">Back to group chats</Link>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b border-slate-200 px-4 py-3 flex items-center gap-3">
          <Link to="/group-chats" className="text-slate-400 hover:text-slate-600">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-slate-900 truncate">{chat.name}</h1>
            <div className="flex items-center gap-3 text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {chat.members.length}
              </span>
              <span className="flex items-center gap-1">
                <Database className="w-3 h-3" />
                {chat.sharedKBs.length} KB{chat.sharedKBs.length !== 1 ? "s" : ""}
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
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowInvite(true)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                title="Invite member"
              >
                <UserPlus className="w-4 h-4" />
              </button>
            </div>
          )}
          {isActive && (
            <button
              onClick={() => setShowShareKB(true)}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              title="Share a Knowledge Base"
            >
              <Share2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Shared KBs bar */}
        {chat.sharedKBs.length > 0 && (
          <div className="border-b border-slate-100 px-4 py-2 flex items-center gap-2 overflow-x-auto">
            <span className="text-[10px] text-slate-400 flex-shrink-0">Shared:</span>
            {chat.sharedKBs.map((kb) => (
              <span
                key={kb.id}
                className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-0.5 text-[11px] text-slate-600 flex-shrink-0"
                title={`Shared by ${kb.sharedByName ?? kb.sharedByEmail}`}
              >
                <Database className="w-3 h-3 text-slate-400" />
                {kb.knowledgeBaseName}
              </span>
            ))}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 min-h-0">
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

        {/* Input */}
        {isActive ? (
          <div className="border-t border-slate-200 px-4 py-3">
            <div className="flex items-end gap-2">
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
                className="flex-1 resize-none border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 max-h-32"
                disabled={sending}
              />
              <button
                onClick={() => void sendMessage()}
                disabled={!input.trim() || sending}
                className="p-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1 px-1">
              Tag <span className="font-medium">@bot</span> to query shared knowledge bases
            </p>
          </div>
        ) : (
          <div className="border-t border-slate-200 px-4 py-3 text-center text-xs text-slate-400">
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
