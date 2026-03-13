
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  LogOut, Trash2, Pencil, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/contexts/UserContext";

// ─── Tab types ───────────────────────────────────────────────────────────────

export type AccountTab = "general" | "conversations";

const TABS: { id: AccountTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "conversations", label: "Conversations" },
];

// ─── General tab (profile info) ─────────────────────────────────────────────

function GeneralTab() {
  const user = useUser();
  const queryClient = useQueryClient();
  const [editingName, setEditingName] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");

  function signOut() {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/auth/logout-redirect";
    document.body.appendChild(form);
    form.submit();
  }

  const displayName = user?.name
    ?? (user?.email ? user.email.split("@")[0]?.replace(/[._]/g, " ") : undefined);

  return (
    <div className="space-y-6">
      <div className="border border-slate-200 rounded-2xl p-5">
        <div className="flex items-center gap-4">
          {user?.picture ? (
            <img
              src={user.picture}
              alt={displayName ?? "Profile"}
              className="w-12 h-12 rounded-full object-cover flex-shrink-0 ring-2 ring-slate-100"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
              <span className="text-lg font-semibold text-slate-500 leading-none">
                {displayName ? displayName.charAt(0).toUpperCase() : "?"}
              </span>
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {displayName && (
                <p className="font-semibold text-slate-900 capitalize truncate">{displayName}</p>
              )}
              <button
                onClick={() => {
                  const parts = (user?.name ?? "").split(" ");
                  setFirstName(parts[0] ?? "");
                  setLastName(parts.slice(1).join(" "));
                  setEditingName(true);
                  setNameError("");
                }}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-md px-2 py-1 transition-colors"
                title="Edit name"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
            </div>
            {user?.email && (
              <p className="text-sm text-slate-400 truncate">{user.email}</p>
            )}
            {user?.isAdmin ? (
              <span className="inline-flex items-center gap-1 mt-1 text-xs bg-slate-900 text-white px-2 py-0.5 rounded-full font-medium">
                <ShieldCheck className="w-3 h-3" /> Administrator
              </span>
            ) : (
              <p className="text-xs text-slate-400 mt-0.5">Member</p>
            )}
          </div>
        </div>

        {editingName && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">First name</label>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoFocus
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Last name <span className="text-slate-300">(optional)</span>
                </label>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>
            </div>
            {nameError && <p className="text-xs text-red-600">{nameError}</p>}
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  if (!firstName.trim()) { setNameError("First name is required"); return; }
                  setNameSaving(true);
                  setNameError("");
                  try {
                    const res = await fetch("/api/auth/profile", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      credentials: "same-origin",
                      body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() }),
                    });
                    if (!res.ok) {
                      const data = await res.json() as { error?: string };
                      setNameError(data.error ?? "Failed to save");
                      return;
                    }
                    setEditingName(false);
                    void queryClient.invalidateQueries({ queryKey: ["me"] });
                  } catch {
                    setNameError("Network error");
                  } finally {
                    setNameSaving(false);
                  }
                }}
                disabled={!firstName.trim() || nameSaving}
                className="px-3 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50"
              >
                {nameSaving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setEditingName(false)}
                className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={() => void signOut()}
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-red-600 transition-colors"
      >
        <LogOut className="w-4 h-4" />
        Sign out
      </button>
    </div>
  );
}

// ─── Conversations tab ──────────────────────────────────────────────────────

function ConversationsTab() {
  const queryClient = useQueryClient();
  const [deleteMode, setDeleteMode] = useState<"idle" | "choose">("idle");
  const [confirmText, setConfirmText] = useState("");
  const [archiveConfirmText, setArchiveConfirmText] = useState("");
  const [deleteResult, setDeleteResult] = useState<{ preserved?: number } | null>(null);

  const deleteAllMutation = useMutation({
    mutationFn: async (mode: "archive" | "delete") => {
      const res = await fetch(`/api/conversations?mode=${mode}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Failed to delete conversations");
      return res.json() as Promise<{ ok: boolean; mode: string; count: number; preserved?: number }>;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (data.preserved && data.preserved > 0) {
        setDeleteResult({ preserved: data.preserved });
      }
      setDeleteMode("idle");
      setConfirmText("");
      setArchiveConfirmText("");
    },
  });

  return (
    <div className="space-y-6">
      <div className="border border-slate-200 rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Conversation History</h3>

        {deleteResult?.preserved && (
          <div className="border border-amber-200 bg-amber-50 rounded-lg px-4 py-3 mb-2">
            <p className="text-sm text-amber-800">
              {deleteResult.preserved} conversation{deleteResult.preserved > 1 ? "s were" : " was"} archived
              instead of deleted because {deleteResult.preserved > 1 ? "they include" : "it includes"} a
              request for human verification. Escalated conversations are preserved for admin review.
            </p>
            <button
              onClick={() => setDeleteResult(null)}
              className="text-xs text-amber-600 hover:text-amber-800 mt-1"
            >
              Dismiss
            </button>
          </div>
        )}

        {deleteMode === "idle" && (
          <button
            onClick={() => setDeleteMode("choose")}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-red-600 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete all conversations
          </button>
        )}

        {deleteMode === "choose" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Your conversations help your organization identify knowledge gaps.
              Choose how to remove them:
            </p>
            <div className="flex flex-col gap-2">
              <div className="border border-slate-200 rounded-lg px-4 py-3 space-y-2">
                <p className="text-sm font-medium text-slate-900">Hide from sidebar</p>
                <p className="text-xs text-slate-400">
                  Conversations are hidden but still contribute to anonymized topic trends.
                </p>
                <div className="pt-1">
                  <label className="text-xs text-slate-500 block mb-1">
                    Type <span className="font-mono font-semibold text-slate-700">HIDE</span> to confirm
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={archiveConfirmText}
                      onChange={(e) => setArchiveConfirmText(e.target.value)}
                      placeholder="HIDE"
                      className="border border-slate-200 rounded-md px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-300"
                    />
                    <button
                      onClick={() => deleteAllMutation.mutate("archive")}
                      disabled={archiveConfirmText !== "HIDE" || deleteAllMutation.isPending}
                      className="bg-slate-900 text-white rounded-md px-3 py-1.5 text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {deleteAllMutation.isPending ? "Hiding..." : "Confirm"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="border border-red-200 rounded-lg px-4 py-3 space-y-2">
                <p className="text-sm font-medium text-red-700">Delete permanently</p>
                <p className="text-xs text-slate-400">
                  Removes all conversations and messages entirely. This cannot be undone.
                  Conversations with human verification requests will be archived instead.
                </p>
                <div className="pt-1">
                  <label className="text-xs text-slate-500 block mb-1">
                    Type <span className="font-mono font-semibold text-slate-700">DELETE</span> to confirm
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="DELETE"
                      className="border border-slate-200 rounded-md px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-300"
                    />
                    <button
                      onClick={() => deleteAllMutation.mutate("delete")}
                      disabled={confirmText !== "DELETE" || deleteAllMutation.isPending}
                      className="bg-red-600 text-white rounded-md px-3 py-1.5 text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {deleteAllMutation.isPending ? "Deleting..." : "Confirm"}
                    </button>
                  </div>
                </div>
              </div>

              <button
                onClick={() => { setDeleteMode("idle"); setConfirmText(""); setArchiveConfirmText(""); }}
                disabled={deleteAllMutation.isPending}
                className="text-sm text-slate-400 hover:text-slate-600 transition-colors mt-1"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Account page ───────────────────────────────────────────────────────────

export function AccountPage({ tab }: { tab: AccountTab }) {
  const navigate = useNavigate();

  function setTab(id: AccountTab) {
    void navigate({ to: "/account", search: { tab: id }, replace: true });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <h1 className="text-xl font-semibold text-slate-900">Account</h1>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
                tab === t.id
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-400 hover:text-slate-600",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "general" && <GeneralTab />}
        {tab === "conversations" && <ConversationsTab />}
      </div>
    </div>
  );
}

// Keep old export for backward compat during transition
export type SettingsTab = AccountTab;
export { AccountPage as SettingsPage };
