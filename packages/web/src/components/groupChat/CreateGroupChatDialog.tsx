import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Database, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GroupChat, GroupChatExpiration, KnowledgeBase } from "@edgebric/types";

const EXPIRATION_OPTIONS: { value: GroupChatExpiration; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "1w", label: "1 week" },
  { value: "1m", label: "1 month" },
  { value: "never", label: "Never" },
];

interface Props {
  onClose: () => void;
}

export function CreateGroupChatDialog({ onClose }: Props) {
  const [name, setName] = useState("");
  const [expiration, setExpiration] = useState<GroupChatExpiration>("1w");
  const [selectedKBIds, setSelectedKBIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: kbs } = useQuery<KnowledgeBase[]>({
    queryKey: ["knowledge-bases"],
    queryFn: () =>
      fetch("/api/knowledge-bases", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) return [];
        return r.json() as Promise<KnowledgeBase[]>;
      }),
  });

  const activeKBs = (kbs ?? []).filter((kb) => kb.status === "active");

  function toggleKB(id: string) {
    setSelectedKBIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);

    try {
      // 1. Create the group chat
      const res = await fetch("/api/group-chats", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), expiration }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to create" }));
        setError(body.error ?? "Failed to create group chat");
        return;
      }

      const chat = (await res.json()) as GroupChat;

      // 2. Share selected KBs (fire-and-forget, don't block navigation)
      for (const kbId of selectedKBIds) {
        void fetch(`/api/group-chats/${chat.id}/shared-kbs`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ knowledgeBaseId: kbId, allowSourceViewing: true }),
        });
      }

      void queryClient.invalidateQueries({ queryKey: ["group-chats"] });
      onClose();
      void navigate({ to: "/group-chats/$id", params: { id: chat.id } });
    } catch {
      setError("Network error");
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
          <h2 className="text-sm font-semibold text-slate-900">New Group Chat</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 Benefits Review"
              maxLength={100}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void handleCreate(); }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Expiration</label>
            <div className="flex gap-2">
              {EXPIRATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setExpiration(opt.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                    expiration === opt.value
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              After expiration, shared KBs are no longer queryable and the chat becomes read-only.
            </p>
          </div>

          {/* KB selection */}
          {activeKBs.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Share Knowledge Bases
                <span className="font-normal text-slate-400 ml-1">(optional)</span>
              </label>
              <div className="space-y-1 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-1">
                {activeKBs.map((kb) => {
                  const isSelected = selectedKBIds.includes(kb.id);
                  return (
                    <button
                      key={kb.id}
                      onClick={() => toggleKB(kb.id)}
                      className={cn(
                        "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                        isSelected
                          ? "bg-slate-100 text-slate-900"
                          : "text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      <Database className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span className="text-xs truncate flex-1">{kb.name}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Selected KBs will be shared with all group chat members. You can add more later.
              </p>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}
        </div>

        <div className="flex items-center gap-2 mt-5">
          <button
            onClick={() => void handleCreate()}
            disabled={!name.trim() || loading}
            className="bg-slate-900 text-white rounded-lg px-4 py-2 text-xs font-medium hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create"}
          </button>
          <button
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-700 px-4 py-2 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
