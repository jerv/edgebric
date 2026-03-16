import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, AlertTriangle, Database, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KnowledgeBase, GroupChatSharedKB } from "@edgebric/types";

interface Props {
  groupChatId: string;
  existingShares: GroupChatSharedKB[];
  onClose: () => void;
}

export function ShareKBDialog({ groupChatId, existingShares, onClose }: Props) {
  const [selectedKBId, setSelectedKBId] = useState<string | null>(null);
  const [allowSourceViewing, setAllowSourceViewing] = useState(false);
  const [step, setStep] = useState<"select" | "confirm">("select");
  const [loading, setLoading] = useState(false);
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
  const availableKBs = (kbs ?? []).filter(
    (kb) => !alreadySharedIds.has(kb.id) && kb.status !== "archived",
  );
  const selectedKB = availableKBs.find((kb) => kb.id === selectedKBId);

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
        setError(body.error ?? "Failed to share knowledge base");
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
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-900">Share Knowledge Base</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === "select" && (
          <>
            {availableKBs.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No additional knowledge bases available to share.
              </p>
            ) : (
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {availableKBs.map((kb) => (
                  <button
                    key={kb.id}
                    onClick={() => setSelectedKBId(kb.id)}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                      selectedKBId === kb.id
                        ? "bg-slate-900 text-white"
                        : "bg-slate-50 text-slate-700 hover:bg-slate-100",
                    )}
                  >
                    <Database className={cn("w-4 h-4 flex-shrink-0", selectedKBId === kb.id ? "text-white/70" : "text-slate-400")} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{kb.name}</p>
                      <p className={cn("text-[11px] truncate", selectedKBId === kb.id ? "text-white/60" : "text-slate-400")}>
                        {kb.documentCount ?? 0} document{kb.documentCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {selectedKBId && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowSourceViewing}
                    onChange={(e) => setAllowSourceViewing(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span className="text-xs text-slate-700 flex items-center gap-1">
                    {allowSourceViewing ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    Allow members to view source documents
                  </span>
                </label>
                <p className="text-[10px] text-slate-400 mt-1 ml-6">
                  When disabled, members can only see bot-synthesized answers, not original document excerpts.
                </p>
              </div>
            )}

            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

            <div className="flex items-center gap-2 mt-5">
              <button
                onClick={() => setStep("confirm")}
                disabled={!selectedKBId}
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

        {step === "confirm" && selectedKB && (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-amber-800 mb-1">Confirm KB sharing</p>
                  <p className="text-xs text-amber-700 leading-relaxed">
                    You are about to share <strong>"{selectedKB.name}"</strong> with all members
                    of this group chat. The bot will be able to search and answer questions from
                    this knowledge base on behalf of all members.
                  </p>
                  {allowSourceViewing && (
                    <p className="text-xs text-amber-700 leading-relaxed mt-1">
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
                className="bg-slate-900 text-white rounded-lg px-4 py-2 text-xs font-medium hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                {loading ? "Sharing..." : "Confirm Share"}
              </button>
              <button
                onClick={() => setStep("select")}
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
