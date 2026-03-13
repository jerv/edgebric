import { useEffect, useRef, useState } from "react";
import { useParams, useSearch } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Markdown from "react-markdown";
import { ArrowLeft, Loader2, CheckCircle } from "lucide-react";
import type { Conversation, PersistedMessage, Escalation } from "@edgebric/types";
import { cn } from "@/lib/utils";
import { cleanContent, dedupeCitations, PROSE_CLASSES } from "@/lib/content";
import { useUser } from "@/contexts/UserContext";
import { useFeedback } from "@/hooks/useFeedback";
import { CitationList } from "@/components/shared/CitationList";
import { FeedbackButtons, FeedbackCommentForm } from "@/components/shared/MessageFeedback";
import { SourcePanel } from "../employee/SourcePanel";

interface ConversationResponse {
  conversation: Conversation;
  messages: PersistedMessage[];
  escalations: Escalation[];
}

export function ConversationViewer() {
  const { id } = useParams({ from: "/_shell/conversations/$id" });
  const search = useSearch({ strict: false }) as Record<string, string | undefined>;
  const highlightMessageId = search.msg;
  const highlightRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const user = useUser();

  const [activeSource, setActiveSource] = useState<{
    documentId: string;
    documentName: string;
    sectionPath: string[];
    pageNumber: number;
  } | null>(null);

  // Admin reply state
  const [replyText, setReplyText] = useState("");
  const [resolveNote, setResolveNote] = useState("");
  const [showResolveInput, setShowResolveInput] = useState(false);

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

  const replyMutation = useMutation({
    mutationFn: (args: { escalationId: string; reply: string }) =>
      fetch(`/api/admin/escalations/${args.escalationId}/reply`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: args.reply }),
      }).then((r) => {
        if (!r.ok) throw new Error("Reply failed");
        return r.json();
      }),
    onSuccess: () => {
      setReplyText("");
      void queryClient.invalidateQueries({ queryKey: ["conversation", id] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (args: { escalationId: string; note?: string }) =>
      fetch(`/api/admin/escalations/${args.escalationId}/resolve`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: args.note }),
      }).then((r) => {
        if (!r.ok) throw new Error("Resolve failed");
        return r.json();
      }),
    onSuccess: () => {
      setResolveNote("");
      setShowResolveInput(false);
      void queryClient.invalidateQueries({ queryKey: ["conversation", id] });
    },
  });

  // Auto-scroll to the escalated message
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
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-slate-500">
          {error instanceof Error ? error.message : "Failed to load conversation"}
        </p>
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Go back
        </button>
      </div>
    );
  }

  const { conversation, messages, escalations } = data;
  const pendingEscalation = escalations.find(
    (e) => !e.adminReply && !e.resolvedAt,
  );
  const isAdmin = user?.isAdmin;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.history.back()}
            className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors rounded-lg hover:bg-slate-100"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-slate-900">Conversation</h1>
            <p className="text-xs text-slate-400">
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
                  <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-full px-4 py-2">
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
                  <div className="bg-slate-900 text-white rounded-2xl rounded-tr-sm px-4 py-3 max-w-xl text-sm">
                    {msg.content}
                  </div>
                ) : (
                  <div
                    className="max-w-2xl w-full space-y-3"
                  >
                    <div
                      className={cn(
                        "rounded-2xl rounded-tl-sm px-5 py-4 text-sm leading-relaxed",
                        isAdminReply
                          ? "bg-blue-50 border border-blue-200 text-slate-800"
                          : "bg-slate-50 border border-slate-200 text-slate-800",
                        isHighlighted && "ring-2 ring-slate-300 ring-offset-2",
                      )}
                    >
                      {isAdminReply && (
                        <div className="text-xs font-medium text-blue-600 mb-2">Admin Reply</div>
                      )}
                      <div className={cn(...PROSE_CLASSES)}>
                        <Markdown>{cleanContent(msg.content)}</Markdown>
                      </div>
                    </div>

                    <CitationList citations={dedupedCitations} onSourceClick={setActiveSource} />

                    {msg.hasConfidentAnswer === false && (
                      <p className="text-xs text-amber-600 px-1">
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
            <p className="text-sm text-slate-400">This conversation has no messages.</p>
          </div>
        )}

        {/* Admin reply form — shown if admin and there's a pending escalation */}
        {isAdmin && pendingEscalation && (
          <div className="border border-blue-200 bg-blue-50/50 rounded-2xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Respond to Escalation</h3>
              <p className="text-xs text-slate-500 mt-1">
                An employee requested human verification on this conversation.
              </p>
            </div>

            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Write your reply..."
              rows={3}
              className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
            />

            <div className="flex items-center gap-3">
              <button
                onClick={() => replyMutation.mutate({ escalationId: pendingEscalation.id, reply: replyText })}
                disabled={!replyText.trim() || replyMutation.isPending}
                className="bg-slate-900 text-white rounded-lg px-4 py-2 text-xs font-medium hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {replyMutation.isPending ? "Sending..." : "Send Reply"}
              </button>

              {!showResolveInput ? (
                <button
                  onClick={() => setShowResolveInput(true)}
                  className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-4 py-2 hover:border-slate-300 transition-colors"
                >
                  Resolve Without Reply
                </button>
              ) : (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={resolveNote}
                    onChange={(e) => setResolveNote(e.target.value)}
                    placeholder="Resolution note (optional)"
                    className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") resolveMutation.mutate({ escalationId: pendingEscalation.id, note: resolveNote || undefined });
                      if (e.key === "Escape") setShowResolveInput(false);
                    }}
                  />
                  <button
                    onClick={() => resolveMutation.mutate({ escalationId: pendingEscalation.id, note: resolveNote || undefined })}
                    disabled={resolveMutation.isPending}
                    className="text-xs font-medium text-white bg-slate-900 rounded-lg px-3 py-2 hover:bg-slate-700 transition-colors disabled:opacity-40 flex-shrink-0"
                  >
                    {resolveMutation.isPending ? "Resolving..." : "Resolve"}
                  </button>
                  <button
                    onClick={() => setShowResolveInput(false)}
                    className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
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
