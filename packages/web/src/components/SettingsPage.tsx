
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  LogOut, Trash2, Pencil, ShieldCheck, Sun, Moon, Monitor, Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/contexts/UserContext";
import { useTheme, type Theme } from "@/contexts/ThemeContext";

// ─── Tab types ───────────────────────────────────────────────────────────────

export type AccountTab = "general" | "notifications" | "conversations";

const TABS: { id: AccountTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "notifications", label: "Notifications" },
  { id: "conversations", label: "Conversations" },
];

// ─── General tab (profile info) ─────────────────────────────────────────────

const THEME_OPTIONS: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

function GeneralTab() {
  const user = useUser();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [editingName, setEditingName] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");

  function signOut() {
    void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
      .then(() => { window.location.href = "/"; });
  }

  const displayName = user?.name
    ?? (user?.email ? user.email.split("@")[0]?.replace(/[._]/g, " ") : undefined);

  return (
    <div className="space-y-6">
      <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5">
        <div className="flex items-center gap-4">
          {user?.picture ? (
            <img
              src={user.picture}
              alt={displayName ?? "Profile"}
              className="w-12 h-12 rounded-full object-cover flex-shrink-0 ring-2 ring-slate-100 dark:ring-gray-800"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
              <span className="text-lg font-semibold text-slate-500 dark:text-gray-400 leading-none">
                {displayName ? displayName.charAt(0).toUpperCase() : "?"}
              </span>
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {displayName && (
                <p className="font-semibold text-slate-900 dark:text-gray-100 capitalize truncate">{displayName}</p>
              )}
              <button
                onClick={() => {
                  const parts = (user?.name ?? "").split(" ");
                  setFirstName(parts[0] ?? "");
                  setLastName(parts.slice(1).join(" "));
                  setEditingName(true);
                  setNameError("");
                }}
                className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 border border-slate-200 dark:border-gray-800 hover:border-slate-300 rounded-md px-2 py-1 transition-colors"
                title="Edit name"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
            </div>
            {user?.email && (
              <p className="text-sm text-slate-400 dark:text-gray-500 truncate">{user.email}</p>
            )}
            {user?.isAdmin ? (
              <span className="inline-flex items-center gap-1 mt-1 text-xs bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 px-2 py-0.5 rounded-full font-medium">
                <ShieldCheck className="w-3 h-3" /> Administrator
              </span>
            ) : (
              <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">Member</p>
            )}
          </div>
        </div>

        {editingName && (
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-gray-800 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">First name</label>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoFocus
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 dark:border-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 dark:bg-gray-950 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">
                  Last name <span className="text-slate-300 dark:text-gray-600">(optional)</span>
                </label>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 dark:border-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 dark:bg-gray-950 dark:text-gray-100"
                />
              </div>
            </div>
            {nameError && <p className="text-xs text-red-600 dark:text-red-400">{nameError}</p>}
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
                className="px-3 py-1.5 text-sm bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50"
              >
                {nameSaving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setEditingName(false)}
                className="px-3 py-1.5 text-sm text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Appearance */}
      <div className="border border-border rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Appearance</h3>
        <p className="text-xs text-muted-foreground">Choose how Edgebric looks to you.</p>
        <div className="flex gap-2">
          {THEME_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = theme === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setTheme(opt.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
                )}
              >
                <Icon className="w-4 h-4" />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <button
        onClick={() => void signOut()}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-red-600 transition-colors"
      >
        <LogOut className="w-4 h-4" />
        Sign out
      </button>
    </div>
  );
}

// ─── Notifications tab ──────────────────────────────────────────────────────

type NotifLevel = "all" | "mentions" | "none";

const NOTIF_OPTIONS: { id: NotifLevel; label: string; description: string }[] = [
  { id: "all", label: "All messages", description: "Get notified for every new message in group chats" },
  { id: "mentions", label: "Mentions only", description: "Only get notified when someone @mentions you" },
  { id: "none", label: "Nothing", description: "No notifications from group chats" },
];

function NotificationsTab() {
  const user = useUser();
  const queryClient = useQueryClient();
  const [level, setLevel] = useState<NotifLevel>(user?.defaultGroupChatNotifLevel ?? "all");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(newLevel: NotifLevel) {
    setLevel(newLevel);
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/auth/notification-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ defaultGroupChatNotifLevel: newLevel }),
      });
      if (res.ok) {
        setSaved(true);
        void queryClient.invalidateQueries({ queryKey: ["me"] });
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      // revert on failure
      setLevel(user?.defaultGroupChatNotifLevel ?? "all");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-slate-500 dark:text-gray-400" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Default group chat notifications</h3>
        </div>
        <p className="text-xs text-slate-400 dark:text-gray-500">
          Default notification preference for group chats you are added to. You can override this per chat.
        </p>

        <div className="space-y-2">
          {NOTIF_OPTIONS.map((opt) => (
            <label
              key={opt.id}
              className={cn(
                "flex items-start gap-3 border rounded-lg px-4 py-3 cursor-pointer transition-colors",
                level === opt.id
                  ? "border-slate-900 dark:border-gray-100 bg-slate-50 dark:bg-gray-900"
                  : "border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700",
              )}
            >
              <input
                type="radio"
                name="notifLevel"
                value={opt.id}
                checked={level === opt.id}
                onChange={() => void save(opt.id)}
                disabled={saving}
                className="mt-0.5 accent-slate-900 dark:accent-gray-100"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-gray-100">{opt.label}</p>
                <p className="text-xs text-slate-400 dark:text-gray-500">{opt.description}</p>
              </div>
            </label>
          ))}
        </div>

        {saved && (
          <p className="text-xs text-green-600 dark:text-green-400">Preference saved.</p>
        )}
      </div>
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
      <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Conversation History</h3>

        {deleteResult?.preserved && (
          <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 rounded-lg px-4 py-3 mb-2">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              {deleteResult.preserved} conversation{deleteResult.preserved > 1 ? "s were" : " was"} archived
              instead of deleted because {deleteResult.preserved > 1 ? "they include" : "it includes"} a
              request for human verification. Escalated conversations are preserved for admin review.
            </p>
            <button
              onClick={() => setDeleteResult(null)}
              className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 mt-1"
            >
              Dismiss
            </button>
          </div>
        )}

        {deleteMode === "idle" && (
          <button
            onClick={() => setDeleteMode("choose")}
            className="flex items-center gap-2 text-sm text-slate-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete all conversations
          </button>
        )}

        {deleteMode === "choose" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-gray-400">
              Your conversations help your organization identify knowledge gaps.
              Choose how to remove them:
            </p>
            <div className="flex flex-col gap-2">
              <div className="border border-slate-200 dark:border-gray-800 rounded-lg px-4 py-3 space-y-2">
                <p className="text-sm font-medium text-slate-900 dark:text-gray-100">Hide from sidebar</p>
                <p className="text-xs text-slate-400 dark:text-gray-500">
                  Conversations are hidden but still contribute to anonymized topic trends.
                </p>
                <div className="pt-1">
                  <label className="text-xs text-slate-500 dark:text-gray-400 block mb-1">
                    Type <span className="font-mono font-semibold text-slate-700 dark:text-gray-300">HIDE</span> to confirm
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={archiveConfirmText}
                      onChange={(e) => setArchiveConfirmText(e.target.value)}
                      placeholder="HIDE"
                      className="border border-slate-200 dark:border-gray-800 rounded-md px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 focus:border-slate-300 dark:focus:border-gray-600 dark:bg-gray-950 dark:text-gray-100"
                    />
                    <button
                      onClick={() => deleteAllMutation.mutate("archive")}
                      disabled={archiveConfirmText !== "HIDE" || deleteAllMutation.isPending}
                      className="bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-md px-3 py-1.5 text-sm font-medium hover:bg-slate-800 dark:hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {deleteAllMutation.isPending ? "Hiding..." : "Confirm"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 space-y-2">
                <p className="text-sm font-medium text-red-700 dark:text-red-400">Delete permanently</p>
                <p className="text-xs text-slate-400 dark:text-gray-500">
                  Removes all conversations and messages entirely. This cannot be undone.
                  Conversations with human verification requests will be archived instead.
                </p>
                <div className="pt-1">
                  <label className="text-xs text-slate-500 dark:text-gray-400 block mb-1">
                    Type <span className="font-mono font-semibold text-slate-700 dark:text-gray-300">DELETE</span> to confirm
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="DELETE"
                      className="border border-slate-200 dark:border-gray-800 rounded-md px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-red-300 dark:focus:ring-red-700 focus:border-red-300 dark:focus:border-red-700 dark:bg-gray-950 dark:text-gray-100"
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
                className="text-sm text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300 transition-colors mt-1"
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
        <h1 className="text-xl font-semibold text-slate-900 dark:text-gray-100">Account</h1>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-200 dark:border-gray-800">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
                tab === t.id
                  ? "border-slate-900 dark:border-gray-100 text-slate-900 dark:text-gray-100"
                  : "border-transparent text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "general" && <GeneralTab />}
        {tab === "notifications" && <NotificationsTab />}
        {tab === "conversations" && <ConversationsTab />}
      </div>
    </div>
  );
}

// Keep old export for backward compat during transition
export type SettingsTab = AccountTab;
export { AccountPage as SettingsPage };
