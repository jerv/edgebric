import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, AlertTriangle, Database, Eye, EyeOff, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/contexts/UserContext";
import type { KnowledgeBase, GroupChatSharedKB } from "@edgebric/types";

interface Props {
  groupChatId: string;
  existingShares: GroupChatSharedKB[];
  onClose: () => void;
}

export function ShareKBDialog({ groupChatId, existingShares, onClose }: Props) {
  const user = useUser();
  const [selectedKBId, setSelectedKBId] = useState<string | null>(null);
  const [allowSourceViewing, setAllowSourceViewing] = useState(false);
  const [step, setStep] = useState<"select" | "confirm">("select");
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: kbs } = useQuery<KnowledgeBase[]>({
    queryKey: ["knowledge-bases"],
    queryFn: () =>
      fetch("/api/knowledge-bases", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<KnowledgeBase[]>;
      }),
  });

  const alreadySharedIds = new Set(existingShares.map((s) => s.knowledgeBaseId));
  const allActiveKBs = (kbs ?? []).filter((kb) => kb.status !== "archived");
  const selectedKB = allActiveKBs.find((kb) => kb.id === selectedKBId);

  function kbDisabledReason(kb: KnowledgeBase): string | null {
    if (alreadySharedIds.has(kb.id)) return "Already shared";
    if (kb.type === "organization" && kb.accessMode === "all") return "Shared org-wide — always included";
    return null;
  }

  const myShares = existingShares.filter(
    (s) => s.sharedByEmail?.toLowerCase() === user?.email?.toLowerCase(),
  );

  async function handleRevoke(shareId: string) {
    setRevoking(shareId);
    try {
      await fetch(`/api/group-chats/${groupChatId}/shared-kbs/${shareId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      void queryClient.invalidateQueries({ queryKey: ["group-chat", groupChatId] });
    } catch { /* ignore */ }
    setRevoking(null);
  }

  async function handleShare() {
    if (!selectedKBId) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/group-chats/${groupChatId}/shared-kbs`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledgeBaseId: selectedKBId,
          allowSourceViewing,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to share" }));
        setError(body.error ?? "Failed to share data source");
        setStep("select");
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ["group-chat", groupChatId] });
      onClose();
    } catch {
      setError("Network error");
      setStep("select");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-950 rounded-2xl shadow-xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-slate-500 dark:text-gray-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Share Data Source</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === "select" && (
          <>
            {/* Currently shared by me — with revoke */}
            {myShares.length > 0 && (
              <div className="mb-4">
                <p className="text-[10px] font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">
                  Shared by you
                </p>
                <div className="space-y-1">
                  {myShares.map((share) => (
                    <div
                      key={share.id}
                      className="flex items-center gap-3 rounded-xl px-3 py-2 bg-slate-50 dark:bg-gray-900 text-slate-700 dark:text-gray-300"
                    >
                      <Database className="w-4 h-4 text-slate-400 dark:text-gray-500 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{share.knowledgeBaseName}</p>
                      </div>
                      <button
                        onClick={() => void handleRevoke(share.id)}
                        disabled={revoking === share.id}
                        className="text-[11px] text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 flex items-center gap-1 flex-shrink-0 disabled:opacity-50"
                      >
                        <Trash2 className="w-3 h-3" />
                        {revoking === share.id ? "Revoking..." : "Revoke"}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="border-b border-slate-100 dark:border-gray-800 mt-3 mb-2" />
              </div>
            )}

            {allActiveKBs.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-gray-400 py-4 text-center">
                No data sources available.
              </p>
            ) : (
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {allActiveKBs.map((kb) => {
                  const disabled = kbDisabledReason(kb);
                  const isSelected = selectedKBId === kb.id;

                  return (
                    <button
                      key={kb.id}
                      onClick={() => !disabled && setSelectedKBId(kb.id)}
                      disabled={!!disabled}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                        disabled
                          ? "opacity-50 cursor-not-allowed bg-slate-50 dark:bg-gray-900"
                          : isSelected
                            ? "bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900"
                            : "bg-slate-50 dark:bg-gray-900 text-slate-700 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800",
                      )}
                    >
                      <Database className={cn("w-4 h-4 flex-shrink-0", isSelected && !disabled ? "text-white/70 dark:text-gray-900/70" : "text-slate-400 dark:text-gray-500")} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{kb.name}</p>
                        <p className={cn("text-[11px] truncate", isSelected && !disabled ? "text-white/60 dark:text-gray-900/60" : "text-slate-400 dark:text-gray-500")}>
                          {disabled ?? `${kb.documentCount ?? 0} document${kb.documentCount !== 1 ? "s" : ""}`}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedKBId && !kbDisabledReason(allActiveKBs.find((kb) => kb.id === selectedKBId)!) && (
              <div className="mt-4 border-t border-slate-100 dark:border-gray-800 pt-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowSourceViewing}
                    onChange={(e) => setAllowSourceViewing(e.target.checked)}
                    className="rounded border-slate-300 dark:border-gray-600"
                  />
                  <span className="text-xs text-slate-700 dark:text-gray-300 flex items-center gap-1">
                    {allowSourceViewing ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    Allow members to view source documents
                  </span>
                </label>
                <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-1 ml-6">
                  When disabled, members can only see bot-synthesized answers, not original document excerpts.
                </p>
              </div>
            )}

            {error && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{error}</p>}

            <div className="flex items-center gap-2 mt-5">
              <button
                onClick={() => setStep("confirm")}
                disabled={!selectedKBId || !!kbDisabledReason(allActiveKBs.find((kb) => kb.id === selectedKBId)!)}
                className="bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg px-4 py-2 text-xs font-medium hover:bg-slate-700 dark:hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                Next
              </button>
              <button onClick={onClose} className="text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 px-4 py-2">
                Cancel
              </button>
            </div>
          </>
        )}

        {step === "confirm" && selectedKB && (
          <>
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">Confirm data source sharing</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                    You are about to share <strong>"{selectedKB.name}"</strong> with all members
                    of this group chat. The bot will be able to search and answer questions from
                    this data source on behalf of all members.
                  </p>
                  {allowSourceViewing && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed mt-1">
                      Source document viewing is <strong>enabled</strong> — members will be able to
                      see original document excerpts in citations.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleShare()}
                disabled={loading}
                className="bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg px-4 py-2 text-xs font-medium hover:bg-slate-700 dark:hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                {loading ? "Sharing..." : "Confirm Share"}
              </button>
              <button
                onClick={() => setStep("select")}
                className="text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 px-4 py-2"
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
