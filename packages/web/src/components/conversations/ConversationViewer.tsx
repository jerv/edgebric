import { useEffect, useRef, useState } from "react";
import { useParams, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import { ArrowLeft, Loader2, CheckCircle } from "lucide-react";
import type { Conversation, PersistedMessage } from "@edgebric/types";
import { cn } from "@/lib/utils";
import { cleanContent, dedupeCitations, PROSE_CLASSES } from "@/lib/content";
import { useFeedback } from "@/hooks/useFeedback";
import { CitationList } from "@/components/shared/CitationList";
import { FeedbackButtons, FeedbackCommentForm } from "@/components/shared/MessageFeedback";
import { SourcePanel } from "../employee/SourcePanel";

interface ConversationResponse {
  conversation: Conversation;
  messages: PersistedMessage[];
}

export function ConversationViewer() {
  const { id } = useParams({ from: "/_shell/conversations/$id" });
  const search = useSearch({ strict: false }) as Record<string, string | undefined>;
  const highlightMessageId = search.msg;
  const highlightRef = useRef<HTMLDivElement>(null);

  const [activeSource, setActiveSource] = useState<{
    documentId: string;
    documentName: string;
    sectionPath: string[];
    pageNumber: number;
  } | null>(null);

  // Feedback — shared hook
  const fb = useFeedback(id);

  const { data, isLoading, error } = useQuery<ConversationResponse>({
    queryKey: ["conversation", id],
    queryFn: () =>
      fetch(`/api/conversations/${id}`, { credentials: "same-origin" }).then((r) => {
        if (r.status === 403) throw new Error("Access denied");
        if (r.status === 404) throw new Error("Conversation not found");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ConversationResponse>;
      }),
  });

  // Auto-scroll to highlighted message
  useEffect(() => {
    if (highlightMessageId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightMessageId, data]);

  // Mark notifications as read when viewing conversation
  useEffect(() => {
    if (!id) return;
    fetch("/api/notifications/mark-read-for-conversation", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: id }),
    }).catch(() => {});
  }, [id]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400 dark:text-gray-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-slate-500 dark:text-gray-400">
          {error instanceof Error ? error.message : "Failed to load conversation"}
        </p>
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Go back
        </button>
      </div>
    );
  }

  const { conversation, messages } = data;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.history.back()}
            className="p-2 text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-400 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-gray-100">Conversation</h1>
            <p className="text-xs text-slate-400 dark:text-gray-500">
              {conversation.userName ?? conversation.userEmail}
              {" · "}
              {new Date(conversation.createdAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="space-y-6">
          {messages.map((msg) => {
            const dedupedCitations = dedupeCitations(msg.citations ?? []);
            const isHighlighted = highlightMessageId && msg.id === highlightMessageId;
            const isAdminReply = msg.source === "admin";
            const isSystemNote = msg.source === "system";
            const showFeedback = msg.id && !isAdminReply && (!msg.source || msg.source === "ai");

            // System notes render as centered muted text
            if (isSystemNote) {
              return (
                <div key={msg.id} className="flex justify-center">
                  <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-gray-500 bg-slate-50 dark:bg-gray-900 border border-slate-100 dark:border-gray-800 rounded-full px-4 py-2">
                    <CheckCircle className="w-3.5 h-3.5" />
                    {msg.content}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                ref={isHighlighted ? highlightRef : undefined}
                className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
              >
                {msg.role === "user" ? (
                  <div className="bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-2xl rounded-tr-sm px-4 py-3 max-w-[85vw] sm:max-w-xl text-sm">
                    {msg.content}
                  </div>
                ) : (
                  <div
                    className="max-w-[85vw] sm:max-w-2xl w-full space-y-3"
                  >
                    <div
                      className={cn(
                        "rounded-2xl rounded-tl-sm px-5 py-4 text-sm leading-relaxed",
                        isAdminReply
                          ? "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-slate-800 dark:text-gray-200"
                          : "bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-slate-800 dark:text-gray-200",
                        isHighlighted && "ring-2 ring-slate-300 dark:ring-gray-600 ring-offset-2 dark:ring-offset-gray-950",
                      )}
                    >
                      {isAdminReply && (
                        <div className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-2">Admin Reply</div>
                      )}
                      <div className={cn(...PROSE_CLASSES)}>
                        <Markdown>{cleanContent(msg.content)}</Markdown>
                      </div>
                    </div>

                    <CitationList citations={dedupedCitations} onSourceClick={setActiveSource} />

                    {msg.hasConfidentAnswer === false && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 px-1">
                        The AI was not confident in this answer. Please contact your administrator directly.
                      </p>
                    )}

                    {showFeedback && (
                      <div className="flex items-center gap-0.5 px-1">
                        <FeedbackButtons
                          messageId={msg.id}
                          rating={fb.feedbackMap.get(msg.id)}
                          isPending={fb.feedbackPending === msg.id}
                          isCommentOpen={fb.feedbackCommentId === msg.id}
                          onThumbsUp={() => void fb.submitFeedback(msg.id, "up")}
                          onThumbsDown={() => fb.toggleCommentInput(msg.id)}
                        />
                      </div>
                    )}

                    {fb.feedbackCommentId === msg.id && !fb.feedbackMap.has(msg.id) && (
                      <FeedbackCommentForm
                        comment={fb.feedbackComment}
                        isPending={fb.feedbackPending === msg.id}
                        onCommentChange={fb.setFeedbackComment}
                        onSubmitWithComment={() => void fb.submitFeedback(msg.id, "down", fb.feedbackComment)}
                        onSubmitWithoutComment={() => void fb.submitFeedback(msg.id, "down")}
                        onCancel={() => fb.setFeedbackCommentId(null)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm text-slate-400 dark:text-gray-500">This conversation has no messages.</p>
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
    </div>
  );
}
