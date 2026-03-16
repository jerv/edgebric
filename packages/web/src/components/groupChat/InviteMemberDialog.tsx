import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, AlertTriangle } from "lucide-react";
import type { GroupChatMember } from "@edgebric/types";

interface Props {
  groupChatId: string;
  existingMembers: GroupChatMember[];
  onClose: () => void;
}

export function InviteMemberDialog({ groupChatId, existingMembers, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"input" | "confirm">("input");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  async function handleInvite() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/group-chats/${groupChatId}/members`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to invite" }));
        setError(body.error ?? "Failed to invite member");
        setStep("input");
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ["group-chat", groupChatId] });
      onClose();
    } catch {
      setError("Network error");
      setStep("input");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-900">Invite Member</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === "input" && (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && email.trim()) setStep("confirm");
                }}
              />
            </div>

            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

            <div className="flex items-center gap-2 mt-5">
              <button
                onClick={() => setStep("confirm")}
                disabled={!email.trim() || !email.includes("@")}
                className="bg-slate-900 text-white rounded-lg px-4 py-2 text-xs font-medium hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                Next
              </button>
              <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-700 px-4 py-2">
                Cancel
              </button>
            </div>
          </>
        )}

        {step === "confirm" && (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-amber-800 mb-1">Confirm invitation</p>
                  <p className="text-xs text-amber-700 leading-relaxed">
                    Are you sure you want to add <strong>{email}</strong> to this group chat?
                    They will gain access to query all shared knowledge bases. This cannot be undone
                    until the chat expires or you remove them.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleInvite()}
                disabled={loading}
                className="bg-slate-900 text-white rounded-lg px-4 py-2 text-xs font-medium hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                {loading ? "Inviting..." : "Confirm Invite"}
              </button>
              <button
                onClick={() => setStep("input")}
                className="text-xs text-slate-500 hover:text-slate-700 px-4 py-2"
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
