import { ThumbsUp, ThumbsDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Feedback Buttons ──────────────────────────────────────────────────────

interface FeedbackButtonsProps {
  messageId: string;
  rating?: "up" | "down";
  isPending: boolean;
  isCommentOpen: boolean;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
}

export function FeedbackButtons({
  messageId: _messageId,
  rating,
  isPending,
  isCommentOpen,
  onThumbsUp,
  onThumbsDown,
}: FeedbackButtonsProps) {
  if (rating) {
    return (
      <span className="flex items-center">
        {rating === "up" ? (
          <ThumbsUp className="w-3.5 h-3.5 text-green-500 fill-green-500" />
        ) : (
          <ThumbsDown className="w-3.5 h-3.5 text-red-400 fill-red-400" />
        )}
      </span>
    );
  }

  return (
    <>
      <button
        onClick={onThumbsUp}
        disabled={isPending}
        className="text-slate-300 dark:text-gray-600 hover:text-green-500 transition-colors p-1 disabled:opacity-40"
        title="Helpful"
      >
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onThumbsDown}
        disabled={isPending}
        className={cn(
          "transition-colors p-1 disabled:opacity-40",
          isCommentOpen ? "text-red-400" : "text-slate-300 dark:text-gray-600 hover:text-red-400",
        )}
        title="Not helpful"
      >
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
    </>
  );
}

// ─── Feedback Comment Form ─────────────────────────────────────────────────

interface FeedbackCommentFormProps {
  comment: string;
  isPending: boolean;
  onCommentChange: (value: string) => void;
  onSubmitWithComment: () => void;
  onSubmitWithoutComment: () => void;
  onCancel: () => void;
}

export function FeedbackCommentForm({
  comment,
  isPending,
  onCommentChange,
  onSubmitWithComment,
  onSubmitWithoutComment,
  onCancel,
}: FeedbackCommentFormProps) {
  return (
    <div className="flex items-center gap-2 px-1 pt-1">
      <input
        type="text"
        value={comment}
        onChange={(e) => onCommentChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmitWithComment();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="What went wrong? (optional)"
        autoFocus
        className="flex-1 min-w-0 text-xs border border-slate-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-slate-700 dark:text-gray-300 placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-slate-300 dark:focus:ring-gray-600 dark:bg-gray-900"
      />
      <button
        onClick={onSubmitWithComment}
        disabled={isPending}
        className="text-xs font-medium text-white dark:text-gray-900 bg-slate-900 dark:bg-gray-100 rounded-lg px-3 py-1.5 hover:bg-slate-700 dark:hover:bg-gray-200 transition-colors disabled:opacity-40 flex-shrink-0"
      >
        Submit
      </button>
      <button
        onClick={onSubmitWithoutComment}
        disabled={isPending}
        className="text-xs text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300 transition-colors flex-shrink-0"
      >
        Skip
      </button>
    </div>
  );
}
