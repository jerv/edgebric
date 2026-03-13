import { useState, useEffect } from "react";

interface Props {
  conversationId: string;
  onClose: () => void;
  onDone: (mode: "archive" | "delete") => void;
}

export function DeleteConversationDialog({ conversationId, onClose, onDone }: Props) {
  const [pending, setPending] = useState<"archive" | "delete" | null>(null);
  const [hasEscalations, setHasEscalations] = useState<boolean | null>(null);
  const [hideConfirm, setHideConfirm] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");

  // Check if this conversation has escalations
  useEffect(() => {
    fetch(`/api/conversations/${conversationId}`, { credentials: "same-origin" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.escalations?.length > 0) {
          setHasEscalations(true);
        } else {
          setHasEscalations(false);
        }
      })
      .catch(() => setHasEscalations(false));
  }, [conversationId]);

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

        <div className="space-y-3">
          {/* Hide from sidebar — type HIDE to confirm */}
          <div className="border border-slate-200 rounded-lg px-3 py-2.5 space-y-2">
            <span className="text-sm font-medium text-slate-800 block">
              Hide from sidebar
            </span>
            <span className="text-xs text-slate-400 block">
              Your questions still contribute to anonymized topic trends.
            </span>
            <div className="pt-0.5">
              <label className="text-xs text-slate-500 block mb-1">
                Type <span className="font-mono font-semibold text-slate-700">HIDE</span> to confirm
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={hideConfirm}
                  onChange={(e) => setHideConfirm(e.target.value)}
                  placeholder="HIDE"
                  className="border border-slate-200 rounded-md px-3 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-300"
                />
                <button
                  onClick={() => void handleAction("archive")}
                  disabled={hideConfirm !== "HIDE" || !!pending}
                  className="bg-slate-900 text-white rounded-md px-3 py-1.5 text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {pending === "archive" ? "Hiding..." : "Confirm"}
                </button>
              </div>
            </div>
          </div>

          {/* Delete permanently — type DELETE to confirm, or disabled if escalated */}
          {hasEscalations ? (
            <div className="border border-slate-200 rounded-lg px-3 py-2.5 bg-slate-50">
              <span className="text-sm font-medium text-slate-400 block">
                Delete permanently
              </span>
              <span className="text-xs text-slate-400 block mt-0.5">
                This conversation includes a request for human verification and is
                preserved for admin review. It can only be archived.
              </span>
            </div>
          ) : (
            <div className="border border-red-200 rounded-lg px-3 py-2.5 space-y-2">
              <span className="text-sm font-medium text-red-600 block">
                Delete permanently
              </span>
              <span className="text-xs text-slate-400 block">
                Removes this conversation and all messages entirely.
              </span>
              <div className="pt-0.5">
                <label className="text-xs text-slate-500 block mb-1">
                  Type <span className="font-mono font-semibold text-slate-700">DELETE</span> to confirm
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder="DELETE"
                    disabled={hasEscalations === null}
                    className="border border-slate-200 rounded-md px-3 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-300 disabled:opacity-40"
                  />
                  <button
                    onClick={() => void handleAction("delete")}
                    disabled={deleteConfirm !== "DELETE" || !!pending || hasEscalations === null}
                    className="bg-red-600 text-white rounded-md px-3 py-1.5 text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {pending === "delete" ? "Deleting..." : "Confirm"}
                  </button>
                </div>
              </div>
            </div>
          )}
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
