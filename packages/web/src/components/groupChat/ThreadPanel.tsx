import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import { X, Send, Sparkles, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { cleanContent, PROSE_CLASSES } from "@/lib/content";
import { useUser } from "@/contexts/UserContext";
import { CitationList } from "@/components/shared/CitationList";
import type { GroupChatMessage } from "@edgebric/types";

interface Props {
  groupChatId: string;
  parentId: string;
  parentMessage?: GroupChatMessage;
  onClose: () => void;
  isActive: boolean;
  memberPictures?: Map<string, string>;
}

function formatTime(date: Date | string): string {
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ThreadPanel({ groupChatId, parentId, parentMessage, onClose, isActive, memberPictures }: Props) {
  const user = useUser();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [streamRevealed, setStreamRevealed] = useState("");
  const [streamPrevRevealed, setStreamPrevRevealed] = useState("");
  const [localMessages, setLocalMessages] = useState<GroupChatMessage[]>([]);
  const [threadSendMode, setThreadSendMode] = useState<"chat" | "ai">("chat");
  const endRef = useRef<HTMLDivElement>(null);

  const { data: serverMessages } = useQuery<GroupChatMessage[]>({
    queryKey: ["group-chat-thread", groupChatId, parentId],
    queryFn: () =>
      fetch(`/api/group-chats/${groupChatId}/threads/${parentId}`, { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<GroupChatMessage[]>;
      }),
    refetchInterval: 5000,
  });

  const messages = (() => {
    const base = serverMessages ?? [];
    const serverIds = new Set(base.map((m) => m.id));
    const extras = localMessages.filter((m) => !serverIds.has(m.id));
    return [...base, ...extras];
  })();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamContent]);

  useEffect(() => {
    if (serverMessages) {
      const serverIds = new Set(serverMessages.map((m) => m.id));
      setLocalMessages((prev) => prev.filter((m) => !serverIds.has(m.id)));
    }
  }, [serverMessages]);

  const sendReply = useCallback(async () => {
    const content = input.trim();
    if (!content || sending) return;
    setInput("");
    setSending(true);

    try {
      const res = await fetch(`/api/group-chats/${groupChatId}/send`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, threadParentId: parentId }),
      });
      if (res.ok) {
        const msg = (await res.json()) as GroupChatMessage;
        setLocalMessages((prev) => [...prev, msg]);
      }
    } catch { /* ignore */ }
    setSending(false);
  }, [input, sending, groupChatId, parentId]);

  const askBot = useCallback(async () => {
    const content = input.trim();
    if (!content || sending) return;
    setInput("");
    setSending(true);
    setStreaming(true);
    setStreamContent("");
    setStreamRevealed("");
    setStreamPrevRevealed("");

    const botContent = `@bot ${content}`;

    try {
      const res = await fetch(`/api/group-chats/${groupChatId}/send`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: botContent, threadParentId: parentId }),
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
          if (line.startsWith("event: ")) eventType = line.slice(7);
          else if (line.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(line.slice(6));
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
                setLocalMessages((prev) => [...prev, parsed as GroupChatMessage]);
              }
            } catch { /* ignore */ }
          }
        }
      }
    } catch { /* ignore */ }

    setStreaming(false);
    setSending(false);
    void queryClient.invalidateQueries({ queryKey: ["group-chat-thread", groupChatId, parentId] });
  }, [input, sending, groupChatId, parentId, queryClient]);

  return (
    <>
    {/* Backdrop */}
    <div className="fixed inset-0 z-40" onClick={onClose} />

    <div className={cn(
      "fixed top-0 right-0 z-50 h-full w-[min(480px,95vw)]",
      "bg-white dark:bg-gray-950 border-l border-slate-200 dark:border-gray-800 shadow-xl",
      "flex flex-col",
      "animate-slide-in-right",
    )}>
      {/* Header */}
      <div className="border-b border-slate-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-900 dark:text-gray-100">Thread</span>
        <button onClick={onClose} className="p-2 rounded-lg text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Parent message */}
      {parentMessage && (
        <div className="border-b border-slate-100 dark:border-gray-800 px-3 py-2 bg-slate-50 dark:bg-gray-900">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-xs font-medium text-slate-700 dark:text-gray-300">
              {parentMessage.role === "assistant" ? "Edgebric" : (parentMessage.authorName ?? parentMessage.authorEmail)}
            </span>
            <span className="text-xs text-slate-400 dark:text-gray-500">{formatTime(parentMessage.createdAt)}</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-gray-400 line-clamp-3">{parentMessage.content}</p>
        </div>
      )}

      {/* Thread messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 min-h-0">
        {messages.map((msg) => {
          const isBot = msg.role === "assistant";
          return (
            <div key={msg.id} className="flex gap-2">
              {isBot ? (
                <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-gray-800 border border-slate-200 dark:border-gray-800 flex items-center justify-center flex-shrink-0 overflow-hidden" title={user?.orgName}>
                  {user?.orgAvatarUrl ? (
                    <img src={user.orgAvatarUrl} alt={user.orgName ?? "Organization"} className="w-full h-full object-cover" />
                  ) : (
                    <Building2 className="w-3 h-3 text-slate-400 dark:text-gray-500" />
                  )}
                </div>
              ) : (
                <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {msg.authorEmail && memberPictures?.get(msg.authorEmail) ? (
                    <img src={memberPictures.get(msg.authorEmail)!} alt={msg.authorName ?? "User"} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="text-xs font-bold text-slate-600 dark:text-gray-400">
                      {(msg.authorName ?? msg.authorEmail ?? "?").charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 mb-0.5">
                  <span className="text-xs font-medium text-slate-700 dark:text-gray-300">
                    {isBot ? "Edgebric" : (msg.authorName ?? msg.authorEmail)}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-gray-500">{formatTime(msg.createdAt)}</span>
                </div>
                {isBot ? (
                  <div className={cn("text-xs text-slate-800 dark:text-gray-200 dark:prose-invert", ...PROSE_CLASSES)}>
                    <Markdown>{cleanContent(msg.content)}</Markdown>
                  </div>
                ) : (
                  <p className="text-xs text-slate-800 dark:text-gray-200 whitespace-pre-wrap">{msg.content.replace(/^@(?:bot|edgebric)\s+/i, "")}</p>
                )}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-1">
                    <CitationList citations={msg.citations} onSourceClick={() => {}} />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {streaming && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-gray-800 border border-slate-200 dark:border-gray-800 flex items-center justify-center flex-shrink-0 overflow-hidden" title={user?.orgName}>
              {user?.orgAvatarUrl ? (
                <img src={user.orgAvatarUrl} alt={user.orgName ?? "Organization"} className="w-full h-full object-cover" />
              ) : (
                <Building2 className="w-3 h-3 text-slate-400 dark:text-gray-500" />
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
                  <div className={cn("text-xs text-slate-800 dark:text-gray-200 dark:prose-invert", ...PROSE_CLASSES)}>
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
                    <div className="flex items-center gap-1 mt-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-500 animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-500 animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-500 animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                );
              })() : (
                <div className="flex items-center gap-1 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-500 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-500 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-gray-500 animate-bounce [animation-delay:300ms]" />
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Thread input */}
      {isActive && (
        <div className="border-t border-slate-200 dark:border-gray-800 px-3 py-2">
          <div className="flex items-center gap-1 mb-1.5">
            <button
              onClick={() => setThreadSendMode("chat")}
              className={cn(
                "text-xs px-2.5 py-1 rounded-full transition-colors flex items-center gap-1",
                threadSendMode === "chat" ? "bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900" : "text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300",
              )}
            >
              <Send className="w-2.5 h-2.5" />
              Chat
            </button>
            <button
              onClick={() => setThreadSendMode("ai")}
              className={cn(
                "text-xs px-2.5 py-1 rounded-full transition-colors flex items-center gap-1",
                threadSendMode === "ai" ? "bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900" : "text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300",
              )}
            >
              <Sparkles className="w-2.5 h-2.5" />
              AI
            </button>
          </div>
          <div className="flex items-end gap-1.5">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void (threadSendMode === "ai" ? askBot() : sendReply());
                }
              }}
              placeholder="Reply in thread..."
              rows={1}
              className="flex-1 resize-none border border-slate-200 dark:border-gray-800 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-gray-100 bg-white dark:bg-gray-950 placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-gray-600 max-h-20"
              disabled={sending}
            />
            <button
              onClick={() => void (threadSendMode === "ai" ? askBot() : sendReply())}
              disabled={!input.trim() || sending}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-medium hover:bg-slate-700 dark:hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              {threadSendMode === "ai" ? <Sparkles className="w-3 h-3" /> : <Send className="w-3 h-3" />}
              Send
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
