import { useState, useCallback } from "react";

interface FeedbackState {
  /** Map of messageId -> rating */
  feedbackMap: Map<string, "up" | "down">;
  /** MessageId currently being submitted */
  feedbackPending: string | null;
  /** MessageId that has the comment input open */
  feedbackCommentId: string | null;
  /** Current comment text */
  feedbackComment: string;
}

export function useFeedback(conversationId: string | undefined) {
  const [state, setState] = useState<FeedbackState>({
    feedbackMap: new Map(),
    feedbackPending: null,
    feedbackCommentId: null,
    feedbackComment: "",
  });

  const setFeedbackMap = useCallback((updater: (prev: Map<string, "up" | "down">) => Map<string, "up" | "down">) => {
    setState((s) => ({ ...s, feedbackMap: updater(s.feedbackMap) }));
  }, []);

  const setFeedbackComment = useCallback((comment: string) => {
    setState((s) => ({ ...s, feedbackComment: comment }));
  }, []);

  const setFeedbackCommentId = useCallback((id: string | null) => {
    setState((s) => ({ ...s, feedbackCommentId: id, feedbackComment: "" }));
  }, []);

  const toggleCommentInput = useCallback((messageId: string) => {
    setState((s) => ({
      ...s,
      feedbackCommentId: s.feedbackCommentId === messageId ? null : messageId,
      feedbackComment: "",
    }));
  }, []);

  const submitFeedback = useCallback(async (messageId: string, rating: "up" | "down", comment?: string) => {
    if (!conversationId || !messageId || state.feedbackMap.has(messageId)) return;
    setState((s) => ({ ...s, feedbackPending: messageId }));
    try {
      const body: Record<string, string> = { conversationId, messageId, rating };
      if (comment) body["comment"] = comment;
      const res = await fetch("/api/feedback", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok || res.status === 409) {
        setState((s) => ({
          ...s,
          feedbackMap: new Map(s.feedbackMap).set(messageId, rating),
          feedbackCommentId: null,
          feedbackComment: "",
          feedbackPending: null,
        }));
      } else {
        setState((s) => ({ ...s, feedbackPending: null }));
      }
    } catch {
      setState((s) => ({ ...s, feedbackPending: null }));
    }
  }, [conversationId, state.feedbackMap]);

  return {
    feedbackMap: state.feedbackMap,
    feedbackPending: state.feedbackPending,
    feedbackCommentId: state.feedbackCommentId,
    feedbackComment: state.feedbackComment,
    setFeedbackMap,
    setFeedbackComment,
    setFeedbackCommentId,
    toggleCommentInput,
    submitFeedback,
  };
}
