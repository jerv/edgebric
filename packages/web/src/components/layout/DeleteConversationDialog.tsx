import { useState } from "react";

interface Props {
  conversationId: string;
  onClose: () => void;
  onDone: (mode: "archive" | "delete") => void;
}

export function DeleteConversationDialog({ conversationId, onClose, onDone }: Props) {
  const [pending, setPending] = useState<"archive" | "delete" | null>(null);

  async function handleAction(mode: "archive" | "delete") {
    setPending(mode);
    try {
      const res = await fetch(`/api/conversations/${conversationId}?mode=${mode}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (res.ok) {
        onDone(mode);
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-2">
          Remove this conversation?
        </h3>
        <p className="text-xs text-slate-500 leading-relaxed mb-5">
          Your conversations help your organization identify knowledge gaps
          — topics that come up frequently signal where documentation needs
          improvement. Removing this conversation affects that signal.
        </p>

        <div className="space-y-2">
          <button
            onClick={() => void handleAction("archive")}
            disabled={!!pending}
            className="w-full text-left px-3 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="text-sm font-medium text-slate-800 block">
              {pending === "archive" ? "Archiving..." : "Hide from sidebar"}
            </span>
            <span className="text-xs text-slate-400 block mt-0.5">
              Your questions still contribute to anonymized topic trends.
            </span>
          </button>

          <button
            onClick={() => void handleAction("delete")}
            disabled={!!pending}
            className="w-full text-left px-3 py-2.5 rounded-lg border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="text-sm font-medium text-red-600 block">
              {pending === "delete" ? "Deleting..." : "Delete permanently"}
            </span>
            <span className="text-xs text-slate-400 block mt-0.5">
              Removes this conversation and all messages entirely.
            </span>
          </button>
        </div>

        <button
          onClick={onClose}
          disabled={!!pending}
          className="w-full mt-3 text-xs text-slate-400 hover:text-slate-600 transition-colors py-1.5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
