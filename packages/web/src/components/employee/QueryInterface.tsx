import { useState, useRef, useEffect } from "react";
import type { AnswerResponse, Citation } from "@edgebric/types";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  hasConfidentAnswer?: boolean;
  isStreaming?: boolean;
}

export function QueryInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const query = input.trim();
    if (!query || isLoading) return;

    setInput("");
    setIsLoading(true);

    const userMessage: Message = { role: "user", content: query };
    const assistantMessage: Message = {
      role: "assistant",
      content: "",
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);

    const deviceToken = localStorage.getItem("edgebric_token");

    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${deviceToken ?? ""}`,
        },
        body: JSON.stringify({ query, sessionId }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response body");

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: delta")) continue;
          if (line.startsWith("data: ")) {
            const payload = line.slice(6);
            try {
              const parsed = JSON.parse(payload) as
                | { delta: string }
                | AnswerResponse;

              if ("delta" in parsed) {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === "assistant") {
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content + parsed.delta,
                    };
                  }
                  return updated;
                });
              } else if ("sessionId" in parsed) {
                // Final answer
                setSessionId(parsed.sessionId);
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === "assistant") {
                    updated[updated.length - 1] = {
                      ...last,
                      content: parsed.answer,
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
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          updated[updated.length - 1] = {
            ...last,
            content: "Something went wrong. Please try again.",
            isStreaming: false,
          };
        }
        return updated;
      });
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e as unknown as React.FormEvent);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <header className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-900 text-lg">Edgebric</span>
          <span className="text-xs text-slate-400 border border-slate-200 rounded px-2 py-0.5">
            HR Policy Assistant
          </span>
        </div>
        <button
          className="text-slate-400 hover:text-slate-600 text-sm flex items-center gap-1"
          title="Incognito mode (coming soon)"
          disabled
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          Incognito
        </button>
      </header>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-slate-900 text-xl font-medium mb-2">
              Ask a question about company policy
            </p>
            <p className="text-slate-400 text-sm max-w-sm">
              Your questions are private. Only aggregate, anonymized topic trends are visible to HR.
            </p>
          </div>
        )}

        {messages.map((message, i) => (
          <div key={i} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
            {message.role === "user" ? (
              <div className="bg-slate-900 text-white rounded-2xl rounded-tr-sm px-4 py-3 max-w-xl text-sm">
                {message.content}
              </div>
            ) : (
              <div className="max-w-2xl w-full space-y-3">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl rounded-tl-sm px-5 py-4 text-sm text-slate-800 leading-relaxed">
                  {message.content}
                  {message.isStreaming && (
                    <span className="inline-block w-1.5 h-4 ml-1 bg-slate-400 animate-pulse rounded-sm" />
                  )}
                </div>

                {!message.isStreaming && message.citations && message.citations.length > 0 && (
                  <div className="space-y-1.5 px-1">
                    {message.citations.map((citation, j) => (
                      <div key={j} className="text-xs text-slate-500 flex items-start gap-2">
                        <span className="text-slate-300 mt-0.5">↳</span>
                        <span>
                          <span className="font-medium text-slate-700">{citation.documentName}</span>
                          {citation.sectionPath.length > 0 && (
                            <span className="text-slate-400"> · {citation.sectionPath.join(" › ")}</span>
                          )}
                          {citation.pageNumber > 0 && (
                            <span className="text-slate-400"> · p. {citation.pageNumber}</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {!message.isStreaming && (
                  <div className="flex items-center justify-between px-1">
                    <p className="text-xs text-amber-600">
                      ⚠ Not legal advice. Verify important decisions with HR.
                    </p>
                    {message.hasConfidentAnswer && (
                      <button className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded px-2.5 py-1 hover:border-slate-300 transition-colors">
                        Ask HR to verify
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 px-6 py-4">
        <form onSubmit={(e) => void handleSubmit(e)} className="flex gap-3 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about company policy..."
            rows={1}
            className="flex-1 resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent max-h-32 overflow-y-auto"
            style={{ height: "auto" }}
            onInput={(e) => {
              const target = e.currentTarget;
              target.style.height = "auto";
              target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="bg-slate-900 text-white rounded-xl px-4 py-3 text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            {isLoading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              "Send"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
