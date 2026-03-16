import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { GroupChat, GroupChatExpiration } from "@edgebric/types";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);

    try {
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
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    expiration === opt.value
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              After expiration, shared KBs are no longer queryable and the chat becomes read-only.
            </p>
          </div>

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
