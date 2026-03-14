import { useState, useEffect } from "react";

interface Props {
  conversationId: string;
  onClose: () => void;
  onDone: (mode: "archive" | "delete") => void;
}

export function DeleteConversationDialog({ conversationId, onClose, onDone }: Props) {
  const [pending, setPending] = useState<"archive" | "delete" | null>(null);
  const [hasEscalations, setHasEscalations] = useState<boolean | null>(null);
  const [confirmStep, setConfirmStep] = useState<"archive" | "delete" | null>(null);

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
          {/* Hide from sidebar */}
          <div className="border border-slate-200 rounded-lg px-3 py-2.5 space-y-2">
            <span className="text-sm font-medium text-slate-800 block">
              Hide from sidebar
            </span>
            <span className="text-xs text-slate-400 block">
              Your questions still contribute to anonymized topic trends.
            </span>
            <div className="flex items-center gap-2 pt-1">
              {confirmStep === "archive" ? (
                <>
                  <span className="text-xs text-slate-500">Are you sure?</span>
                  <button
                    onClick={() => void handleAction("archive")}
                    disabled={!!pending}
                    className="bg-slate-900 text-white rounded-md px-3 py-1.5 text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-30"
                  >
                    {pending === "archive" ? "Hiding..." : "Yes, hide"}
                  </button>
                  <button
                    onClick={() => setConfirmStep(null)}
                    disabled={!!pending}
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmStep("archive")}
                  disabled={!!pending}
                  className="bg-slate-100 text-slate-700 rounded-md px-3 py-1.5 text-sm font-medium hover:bg-slate-200 transition-colors disabled:opacity-30"
                >
                  Hide
                </button>
              )}
            </div>
          </div>

          {/* Delete permanently */}
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
              <div className="flex items-center gap-2 pt-1">
                {confirmStep === "delete" ? (
                  <>
                    <span className="text-xs text-slate-500">Are you sure?</span>
                    <button
                      onClick={() => void handleAction("delete")}
                      disabled={!!pending || hasEscalations === null}
                      className="bg-red-600 text-white rounded-md px-3 py-1.5 text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-30"
                    >
                      {pending === "delete" ? "Deleting..." : "Yes, delete"}
                    </button>
                    <button
                      onClick={() => setConfirmStep(null)}
                      disabled={!!pending}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmStep("delete")}
                    disabled={hasEscalations === null}
                    className="bg-red-50 text-red-600 rounded-md px-3 py-1.5 text-sm font-medium hover:bg-red-100 transition-colors disabled:opacity-30"
                  >
                    Delete
                  </button>
                )}
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
