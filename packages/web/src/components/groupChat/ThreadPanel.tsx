import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import { X, Send } from "lucide-react";
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
}

function formatTime(date: Date | string): string {
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ThreadPanel({ groupChatId, parentId, parentMessage, onClose, isActive }: Props) {
  const user = useUser();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [localMessages, setLocalMessages] = useState<GroupChatMessage[]>([]);
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

    const hasBotTag = /@(?:bot|edgebric)\b/i.test(content);

    if (!hasBotTag) {
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
      return;
    }

    // Bot-tagged — SSE
    setStreaming(true);
    setStreamContent("");

    try {
      const res = await fetch(`/api/group-chats/${groupChatId}/send`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, threadParentId: parentId }),
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
                setStreamContent((prev) => prev + (parsed.delta ?? ""));
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
    <div className="w-80 border-l border-slate-200 flex flex-col bg-white">
      {/* Header */}
      <div className="border-b border-slate-200 px-3 py-2.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-900">Thread</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Parent message */}
      {parentMessage && (
        <div className="border-b border-slate-100 px-3 py-2 bg-slate-50">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-[11px] font-medium text-slate-700">
              {parentMessage.role === "assistant" ? "Edgebric" : (parentMessage.authorName ?? parentMessage.authorEmail)}
            </span>
            <span className="text-[10px] text-slate-400">{formatTime(parentMessage.createdAt)}</span>
          </div>
          <p className="text-xs text-slate-600 line-clamp-3">{parentMessage.content}</p>
        </div>
      )}

      {/* Thread messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
        {messages.map((msg) => {
          const isBot = msg.role === "assistant";
          const isMine = msg.authorEmail === user?.email;
          return (
            <div key={msg.id} className="flex gap-2">
              <div
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold",
                  isBot ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-600",
                )}
              >
                {isBot ? "AI" : (msg.authorName ?? msg.authorEmail ?? "?").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 mb-0.5">
                  <span className="text-[11px] font-medium text-slate-700">
                    {isBot ? "Edgebric" : (msg.authorName ?? msg.authorEmail)}
                  </span>
                  <span className="text-[9px] text-slate-400">{formatTime(msg.createdAt)}</span>
                </div>
                {isBot ? (
                  <div className={cn("text-xs text-slate-800", ...PROSE_CLASSES)}>
                    <Markdown>{cleanContent(msg.content)}</Markdown>
                  </div>
                ) : (
                  <p className="text-xs text-slate-800 whitespace-pre-wrap">{msg.content}</p>
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

        {streaming && streamContent && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-slate-900 flex items-center justify-center flex-shrink-0">
              <span className="text-[9px] font-bold text-white">AI</span>
            </div>
            <div className={cn("flex-1 text-xs text-slate-800", ...PROSE_CLASSES)}>
              <Markdown>{cleanContent(streamContent)}</Markdown>
            </div>
          </div>
        )}

        {streaming && !streamContent && (
          <div className="flex items-center gap-1 py-1">
            <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce" />
            <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
            <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Thread input */}
      {isActive && (
        <div className="border-t border-slate-200 px-3 py-2">
          <div className="flex items-end gap-1.5">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendReply();
                }
              }}
              placeholder="Reply in thread..."
              rows={1}
              className="flex-1 resize-none border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 max-h-20"
              disabled={sending}
            />
            <button
              onClick={() => void sendReply()}
              disabled={!input.trim() || sending}
              className="p-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
