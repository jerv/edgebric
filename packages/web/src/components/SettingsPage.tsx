
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  LogOut, CheckCircle, Circle, Loader2, Cpu, ShieldCheck,
  Mail, Plus, Trash2, Pencil, Slack, ChevronDown, ChevronUp, HelpCircle,
} from "lucide-react";
import type { IntegrationConfig, EscalationTarget, User } from "@edgebric/types";
import { cn } from "@/lib/utils";
import { modelMeta } from "@/lib/models";
import { useUser } from "@/contexts/UserContext";
import { PrivacyTab } from "@/components/settings/PrivacyTab";

// ─── Tab types ───────────────────────────────────────────────────────────────

export type SettingsTab = "account" | "privacy" | "members" | "models" | "integrations" | "escalations";

interface TabDef {
  id: SettingsTab;
  label: string;
  adminOnly?: boolean;
}

const TABS: TabDef[] = [
  { id: "account", label: "Account" },
  { id: "privacy", label: "Privacy" },
  { id: "members", label: "Members", adminOnly: true },
  { id: "models", label: "Models", adminOnly: true },
  { id: "integrations", label: "Integrations", adminOnly: true },
  { id: "escalations", label: "Escalations", adminOnly: true },
];

// ─── Account tab ─────────────────────────────────────────────────────────────

function AccountTab() {
  const user = useUser();
  const queryClient = useQueryClient();
  const [deleteMode, setDeleteMode] = useState<"idle" | "choose">("idle");
  const [confirmText, setConfirmText] = useState("");
  const [archiveConfirmText, setArchiveConfirmText] = useState("");
  const [deleteResult, setDeleteResult] = useState<{ preserved?: number } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");

  function signOut() {
    // Use a form POST so the browser sends the session cookie and fully reloads —
    // avoids stale React Query cache showing the app after logout.
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/auth/logout-redirect";
    document.body.appendChild(form);
    form.submit();
  }

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
                className="p-1 text-slate-300 hover:text-slate-500 transition-colors"
                title="Edit name"
              >
                <Pencil className="w-3 h-3" />
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

      {/* Conversation History */}
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

// ─── Members tab ─────────────────────────────────────────────────────────────

function MembersTab() {
  const user = useUser();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");

  const { data: members = [], isLoading } = useQuery<User[]>({
    queryKey: ["admin", "org", "members"],
    queryFn: () =>
      fetch("/api/admin/org/members", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<User[]>;
      }),
  });

  const inviteMutation = useMutation({
    mutationFn: async (body: { email: string; role: string }) => {
      const res = await fetch("/api/admin/org/members/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      if (res.status === 409) throw new Error("User already exists");
      if (!res.ok) throw new Error("Failed to invite user");
      return res.json() as Promise<User>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "org", "members"] });
      setInviteEmail("");
      setInviteRole("member");
    },
  });

  const roleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await fetch(`/api/admin/org/members/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to update role");
      }
      return res.json() as Promise<User>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "org", "members"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/admin/org/members/${userId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to remove user");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "org", "members"] });
    },
  });

  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Invite */}
      <div className="border border-slate-200 rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Invite Member</h3>
        <p className="text-xs text-slate-500">
          Invited users will be activated automatically when they sign in via SSO.
        </p>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && inviteEmail.trim()) {
                  e.preventDefault();
                  inviteMutation.mutate({ email: inviteEmail.trim(), role: inviteRole });
                }
              }}
              placeholder="user@example.com"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as "member" | "admin")}
            className="px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={() => inviteMutation.mutate({ email: inviteEmail.trim(), role: inviteRole })}
            disabled={!inviteEmail.trim() || inviteMutation.isPending}
            className="px-4 py-2 text-sm bg-slate-900 text-white rounded-xl hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {inviteMutation.isPending ? "Inviting..." : "Invite"}
          </button>
        </div>
        {inviteMutation.isError && (
          <p className="text-xs text-red-600">{inviteMutation.error.message}</p>
        )}
      </div>

      {/* Member list */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading members...
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">User</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Role</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m) => {
                const isSelf = m.email === user?.email;
                return (
                  <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-slate-800">{m.name ?? m.email.split("@")[0]}</p>
                        <p className="text-xs text-slate-400">{m.email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                        m.status === "active"
                          ? "bg-green-50 text-green-700"
                          : "bg-amber-50 text-amber-700",
                      )}>
                        {m.status === "active" ? "Active" : "Invited"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {isSelf ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                          <ShieldCheck className="w-3 h-3" />
                          {m.role === "admin" ? "Admin" : "Member"}
                          <span className="text-slate-300">(you)</span>
                        </span>
                      ) : (
                        <select
                          value={m.role}
                          onChange={(e) => roleMutation.mutate({ userId: m.id, role: e.target.value })}
                          disabled={roleMutation.isPending}
                          className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isSelf ? null : removeConfirm === m.id ? (
                        <div className="flex items-center gap-2 justify-end">
                          <span className="text-xs text-slate-500">Remove?</span>
                          <button
                            onClick={() => { removeMutation.mutate(m.id); setRemoveConfirm(null); }}
                            className="text-xs text-red-600 hover:text-red-800 font-medium"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setRemoveConfirm(null)}
                            className="text-xs text-slate-500 hover:text-slate-700"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setRemoveConfirm(m.id)}
                          className="text-slate-300 hover:text-red-500 transition-colors p-1"
                          title="Remove user"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {roleMutation.isError && (
        <p className="text-xs text-red-600">{roleMutation.error.message}</p>
      )}
    </div>
  );
}

// ─── Models tab ──────────────────────────────────────────────────────────────

interface MILMModel {
  id: string;
  readyToUse: boolean;
  onDisk: boolean;
  loading: boolean;
}

interface ModelsResponse {
  models: MILMModel[];
  activeModel: string;
  loadingModelId: string | null;
}


function ModelsTab() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<ModelsResponse>({
    queryKey: ["admin", "models"],
    queryFn: () =>
      fetch("/api/admin/models", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ModelsResponse>;
      }),
    // Poll every 3s while any model is loading, otherwise every 10s
    refetchInterval: (query) =>
      query.state.data?.loadingModelId ? 3000 : 10_000,
  });

  const loadMutation = useMutation({
    mutationFn: (modelId: string) =>
      fetch("/api/admin/models/load", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      }).then((r) => {
        if (!r.ok) throw new Error("Load failed");
        return r.json() as Promise<{ loading: boolean; modelId: string }>;
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "models"] }),
  });

  const anyLoading = !!data?.loadingModelId || loadMutation.isPending;

  // Sort: loaded first, then by id
  const sorted = [...(data?.models ?? [])].sort((a, b) => {
    if (a.readyToUse !== b.readyToUse) return a.readyToUse ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Loading a model restarts the inference server (~15-60s depending on model size).
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      )}

      {!isLoading && (
        <div className="space-y-2">
          {sorted.map((model) => {
            const meta = modelMeta(model.id);
            const isActive = model.id === data?.activeModel;
            const isLoading_ = model.loading || (loadMutation.isPending && loadMutation.variables === model.id);

            return (
              <div
                key={model.id}
                className={cn(
                  "rounded-2xl border px-5 py-4 transition-colors",
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white",
                )}
              >
                <div className="flex items-center gap-3">
                  {/* Status icon */}
                  {isLoading_ ? (
                    <Loader2 className="w-4 h-4 animate-spin flex-shrink-0 text-slate-400" />
                  ) : isActive ? (
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 flex-shrink-0 text-slate-300" />
                  )}

                  {/* Labels */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("font-medium text-sm", isActive ? "text-white" : "text-slate-900")}>
                        {meta.family} — {meta.label}
                      </span>
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded-full font-mono font-medium",
                        isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500",
                      )}>
                        {model.id}
                      </span>
                      {isActive && (
                        <span className="text-xs bg-white/10 text-white/80 px-2 py-0.5 rounded-full font-medium">
                          Active
                        </span>
                      )}
                      {isLoading_ && (
                        <span className={cn(
                          "text-xs px-2 py-0.5 rounded-full font-medium",
                          isActive ? "bg-white/10 text-white/70" : "bg-amber-50 text-amber-600 border border-amber-200",
                        )}>
                          Loading...
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Load button — only for non-active, non-loading models */}
                  {!isActive && !isLoading_ && (
                    <button
                      onClick={() => loadMutation.mutate(model.id)}
                      disabled={anyLoading || !model.onDisk}
                      className={cn(
                        "flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors",
                        !model.onDisk
                          ? "border-slate-100 text-slate-300 cursor-not-allowed"
                          : anyLoading
                          ? "border-slate-100 text-slate-300 cursor-not-allowed"
                          : "border-slate-300 text-slate-600 hover:bg-slate-50 hover:border-slate-400",
                      )}
                      title={!model.onDisk ? "Model file not on disk" : undefined}
                    >
                      {model.onDisk ? "Load" : "Not downloaded"}
                    </button>
                  )}

                  <Cpu className={cn("w-4 h-4 flex-shrink-0", isActive ? "text-white/50" : "text-slate-300")} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Integrations tab ────────────────────────────────────────────────────────

function IntegrationsTab() {
  const queryClient = useQueryClient();

  // Slack state
  const [botToken, setBotToken] = useState("");
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [showSlackHelp, setShowSlackHelp] = useState(false);

  // Email state
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [showEmailHelp, setShowEmailHelp] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [useTls, setUseTls] = useState(true);

  const { data: config } = useQuery<IntegrationConfig>({
    queryKey: ["admin", "integrations"],
    queryFn: () =>
      fetch("/api/admin/integrations", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<IntegrationConfig>;
      }),
  });

  useEffect(() => {
    if (config?.slack) {
      setBotToken(config.slack.botToken);
      setSlackEnabled(config.slack.enabled);
    }
    if (config?.email) {
      setSmtpHost(config.email.smtpHost);
      setSmtpPort(String(config.email.smtpPort));
      setSmtpUser(config.email.smtpUser);
      setSmtpPass(config.email.smtpPass);
      setFromAddress(config.email.fromAddress);
      setUseTls(config.email.useTls);
      setEmailEnabled(config.email.enabled);
    }
  }, [config]);

  const saveSlackMutation = useMutation({
    mutationFn: (cfg: IntegrationConfig) =>
      fetch("/api/admin/integrations", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      }).then((r) => {
        if (!r.ok) throw new Error("Save failed");
        return r.json() as Promise<IntegrationConfig>;
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "integrations"] }),
  });

  const saveEmailMutation = useMutation({
    mutationFn: (cfg: IntegrationConfig) =>
      fetch("/api/admin/integrations", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      }).then((r) => {
        if (!r.ok) throw new Error("Save failed");
        return r.json() as Promise<IntegrationConfig>;
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "integrations"] }),
  });

  const testSlackMutation = useMutation({
    mutationFn: () =>
      fetch("/api/admin/integrations/test", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "slack" }),
      }).then(async (r) => {
        const body = await r.json() as { ok: boolean; error?: string; teamName?: string };
        if (!body.ok) throw new Error(body.error ?? "Test failed");
        return body;
      }),
  });

  const testEmailMutation = useMutation({
    mutationFn: () =>
      fetch("/api/admin/integrations/test", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "email" }),
      }).then(async (r) => {
        const body = await r.json() as { ok: boolean; error?: string };
        if (!body.ok) throw new Error(body.error ?? "Test failed");
        return body;
      }),
  });

  function handleSaveSlack() {
    saveSlackMutation.mutate({
      slack: { botToken: botToken.trim(), enabled: slackEnabled },
    });
  }

  function handleSaveEmail() {
    saveEmailMutation.mutate({
      email: {
        smtpHost: smtpHost.trim(),
        smtpPort: parseInt(smtpPort, 10) || 587,
        smtpUser: smtpUser.trim(),
        smtpPass: smtpPass,
        fromAddress: fromAddress.trim(),
        useTls,
        enabled: emailEnabled,
      },
    });
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-400">
        Configure how escalation notifications are delivered to your team.
      </p>

      {/* Slack card */}
      <div className="border border-slate-200 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#4A154B] flex items-center justify-center flex-shrink-0">
            <Slack className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-medium text-sm text-slate-900">Slack</span>
            {slackEnabled && botToken && (
              <span className="ml-2 text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-medium">
                Active
              </span>
            )}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={slackEnabled}
              onChange={(e) => setSlackEnabled(e.target.checked)}
              className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
            />
            <span className="text-xs text-slate-500">Enabled</span>
          </label>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Bot Token</label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="xoxb-..."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          />
          <p className="text-xs text-slate-400 mt-1">
            Slack Bot Token with <code className="text-xs bg-slate-100 px-1 rounded">chat:write</code> scope.
            Used to send DMs to escalation targets.
          </p>
        </div>

        {/* Setup help */}
        <button
          onClick={() => setShowSlackHelp(!showSlackHelp)}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          How to create a Slack Bot Token
          {showSlackHelp ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {showSlackHelp && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 space-y-2">
            <ol className="list-decimal list-inside space-y-1.5">
              <li>
                Go to{" "}
                <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-700">
                  api.slack.com/apps
                </a>{" "}
                and click <strong>Create New App</strong> &rarr; <strong>From scratch</strong>.
              </li>
              <li>Name it (e.g. "Edgebric") and pick your workspace.</li>
              <li>
                Under <strong>OAuth &amp; Permissions</strong>, scroll to <strong>Bot Token Scopes</strong> and add:{" "}
                <code className="bg-white border border-slate-200 px-1 rounded">chat:write</code>
              </li>
              <li>
                Click <strong>Install to Workspace</strong> at the top and authorize.
              </li>
              <li>
                Copy the <strong>Bot User OAuth Token</strong> (starts with <code className="bg-white border border-slate-200 px-1 rounded">xoxb-</code>) and paste it above.
              </li>
            </ol>
            <p className="text-slate-400 pt-1">
              The bot will send DMs to the Slack User IDs configured on your escalation targets.
              Make sure the bot is added to your workspace (it doesn't need to be in any specific channel).
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveSlack}
            disabled={!botToken.trim() || saveSlackMutation.isPending}
            className="bg-slate-900 text-white rounded-lg px-3.5 py-1.5 text-xs font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saveSlackMutation.isPending ? "Saving..." : saveSlackMutation.isSuccess ? "Saved" : "Save"}
          </button>
          <button
            onClick={() => testSlackMutation.mutate()}
            disabled={!botToken.trim().startsWith("xoxb-") || testSlackMutation.isPending}
            className="border border-slate-200 text-slate-600 rounded-lg px-3.5 py-1.5 text-xs font-medium hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {testSlackMutation.isPending ? "Testing..." : "Test"}
          </button>
          {testSlackMutation.isSuccess && (
            <span className="text-xs text-green-600">
              Connected{testSlackMutation.data?.teamName ? ` to ${testSlackMutation.data.teamName}` : ""}
            </span>
          )}
          {testSlackMutation.isError && (
            <span className="text-xs text-red-500">
              {testSlackMutation.error instanceof Error ? testSlackMutation.error.message : "Test failed"}
            </span>
          )}
        </div>
      </div>

      {/* Email card */}
      <div className="border border-slate-200 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
            <Mail className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-medium text-sm text-slate-900">Email Notifications</span>
            {emailEnabled && smtpHost && (
              <span className="ml-2 text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-medium">
                Active
              </span>
            )}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={emailEnabled}
              onChange={(e) => setEmailEnabled(e.target.checked)}
              className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
            />
            <span className="text-xs text-slate-500">Enabled</span>
          </label>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">SMTP Host</label>
              <input
                type="text"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.company.com"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Port</label>
              <input
                type="text"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                placeholder="587"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Username</label>
              <input
                type="text"
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                placeholder="notifications@company.com"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Password</label>
              <input
                type="password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">From Address</label>
              <input
                type="email"
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
                placeholder="noreply@company.com"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              />
              <p className="text-[11px] text-slate-400 mt-1">Gmail SMTP overrides this with your login email. Use a domain SMTP provider (SendGrid, Resend, SES) for custom from addresses.</p>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useTls}
                  onChange={(e) => setUseTls(e.target.checked)}
                  className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <span className="text-xs text-slate-500">Use TLS</span>
              </label>
            </div>
          </div>
        </div>

        {/* Setup help */}
        <button
          onClick={() => setShowEmailHelp(!showEmailHelp)}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          How to configure email notifications
          {showEmailHelp ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {showEmailHelp && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 space-y-2">
            <p>You need SMTP credentials from your email provider. Common setups:</p>
            <div className="space-y-2">
              <div>
                <p className="font-medium text-slate-700">Gmail / Google Workspace</p>
                <ul className="list-disc list-inside text-slate-500 space-y-0.5 ml-1">
                  <li>Host: <code className="bg-white border border-slate-200 px-1 rounded">smtp.gmail.com</code>, Port: <code className="bg-white border border-slate-200 px-1 rounded">587</code>, TLS: on</li>
                  <li>Username: your full Gmail address</li>
                  <li>Password: generate an <strong>App Password</strong> at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">myaccount.google.com/apppasswords</a> (requires 2FA enabled)</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-slate-700">Microsoft 365 / Outlook</p>
                <ul className="list-disc list-inside text-slate-500 space-y-0.5 ml-1">
                  <li>Host: <code className="bg-white border border-slate-200 px-1 rounded">smtp.office365.com</code>, Port: <code className="bg-white border border-slate-200 px-1 rounded">587</code>, TLS: on</li>
                  <li>Username: your full email address</li>
                  <li>Password: your account password (or app password if MFA is on)</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-slate-700">Amazon SES</p>
                <ul className="list-disc list-inside text-slate-500 space-y-0.5 ml-1">
                  <li>Host: <code className="bg-white border border-slate-200 px-1 rounded">email-smtp.us-east-1.amazonaws.com</code>, Port: <code className="bg-white border border-slate-200 px-1 rounded">587</code>, TLS: on</li>
                  <li>Username/Password: SMTP credentials from the SES console (not your AWS keys)</li>
                </ul>
              </div>
            </div>
            <p className="text-slate-400 pt-1">
              The "From Address" is who the email appears to come from. Use "Test connection" to verify your settings before saving.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveEmail}
            disabled={!smtpHost.trim() || !fromAddress.trim() || saveEmailMutation.isPending}
            className="bg-slate-900 text-white rounded-lg px-3.5 py-1.5 text-xs font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saveEmailMutation.isPending ? "Saving..." : saveEmailMutation.isSuccess ? "Saved" : "Save"}
          </button>
          <button
            onClick={() => testEmailMutation.mutate()}
            disabled={!smtpHost.trim() || testEmailMutation.isPending}
            className="border border-slate-200 text-slate-600 rounded-lg px-3.5 py-1.5 text-xs font-medium hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {testEmailMutation.isPending ? "Testing..." : "Test connection"}
          </button>
          {testEmailMutation.isSuccess && (
            <span className="text-xs text-green-600">SMTP connection verified</span>
          )}
          {testEmailMutation.isError && (
            <span className="text-xs text-red-500">
              {testEmailMutation.error instanceof Error ? testEmailMutation.error.message : "Test failed"}
            </span>
          )}
        </div>
      </div>

      {/* Microsoft Teams — coming soon */}
      <div className="border border-slate-100 rounded-2xl px-5 py-4 opacity-50 cursor-not-allowed">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-slate-400">T</span>
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-medium text-sm text-slate-500">Microsoft Teams</span>
            <span className="ml-2 text-xs bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">
              Coming soon
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function EscalationsTab({ onSwitchTab }: { onSwitchTab: (tab: SettingsTab) => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ─── Target management state ─────
  const [showTargetForm, setShowTargetForm] = useState(false);
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [targetName, setTargetName] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [targetSlackId, setTargetSlackId] = useState("");
  const [targetEmail, setTargetEmail] = useState("");

  // ─── Queries ─────
  const { data: integrationConfig } = useQuery<IntegrationConfig>({
    queryKey: ["admin", "integrations"],
    queryFn: () =>
      fetch("/api/admin/integrations", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<IntegrationConfig>;
      }),
  });

  const slackEnabled = !!integrationConfig?.slack?.enabled;
  const emailEnabled = !!integrationConfig?.email?.enabled;
  const anyIntegrationEnabled = slackEnabled || emailEnabled;

  const { data: targets = [] } = useQuery<EscalationTarget[]>({
    queryKey: ["admin", "targets"],
    queryFn: () =>
      fetch("/api/admin/targets", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<EscalationTarget[]>;
      }),
  });

  // ─── Target mutations ─────
  const createTargetMutation = useMutation({
    mutationFn: (data: { name: string; role?: string; slackUserId?: string; email?: string }) =>
      fetch("/api/admin/targets", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => {
        if (!r.ok) throw new Error("Create failed");
        return r.json() as Promise<EscalationTarget>;
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "targets"] });
      resetTargetForm();
    },
  });

  const updateTargetMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; role?: string; slackUserId?: string; email?: string } }) =>
      fetch(`/api/admin/targets/${id}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => {
        if (!r.ok) throw new Error("Update failed");
        return r.json() as Promise<EscalationTarget>;
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "targets"] });
      resetTargetForm();
    },
  });

  const deleteTargetMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/admin/targets/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      }).then((r) => {
        if (!r.ok) throw new Error("Delete failed");
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "targets"] }),
  });

  function resetTargetForm() {
    setShowTargetForm(false);
    setEditingTargetId(null);
    setTargetName("");
    setTargetRole("");
    setTargetSlackId("");
    setTargetEmail("");
  }

  function startEditTarget(target: EscalationTarget) {
    setEditingTargetId(target.id);
    setTargetName(target.name);
    setTargetRole(target.role ?? "");
    setTargetSlackId(target.slackUserId ?? "");
    setTargetEmail(target.email ?? "");
    setShowTargetForm(true);
  }

  function handleSaveTarget() {
    const data: { name: string; role?: string; slackUserId?: string; email?: string } = {
      name: targetName.trim(),
    };
    if (targetRole.trim()) data.role = targetRole.trim();
    if (targetSlackId.trim()) data.slackUserId = targetSlackId.trim();
    if (targetEmail.trim()) data.email = targetEmail.trim();

    if (editingTargetId) {
      updateTargetMutation.mutate({ id: editingTargetId, data });
    } else {
      createTargetMutation.mutate(data);
    }
  }

  const hasValidContact =
    (slackEnabled && targetSlackId.trim()) || (emailEnabled && targetEmail.trim());
  const targetFormValid = targetName.trim() && hasValidContact;
  const isSavingTarget = createTargetMutation.isPending || updateTargetMutation.isPending;

  if (!anyIntegrationEnabled) {
    return (
      <div className="space-y-6">
        <div className="border border-slate-200 rounded-2xl px-6 py-10 text-center opacity-60">
          <div className="max-w-sm mx-auto space-y-3">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
              <Mail className="w-5 h-5 text-slate-400" />
            </div>
            <h3 className="text-sm font-semibold text-slate-700">No notification channels configured</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Enable at least one integration (Slack or Email) before setting up escalation targets.
              Employees won't be able to send verification requests until a notification channel is active.
            </p>
            <button
              onClick={() => onSwitchTab("integrations")}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg px-4 py-2 transition-colors"
            >
              Go to Integrations
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ─── Escalation Targets Section ──── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Escalation Targets</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              People who can receive verification requests from employees.
            </p>
          </div>
          {!showTargetForm && (
            <button
              onClick={() => { resetTargetForm(); setShowTargetForm(true); }}
              className="flex items-center gap-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 hover:border-slate-300 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Target
            </button>
          )}
        </div>

        {/* Target form */}
        {showTargetForm && (
          <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Name *</label>
                <input
                  type="text"
                  value={targetName}
                  onChange={(e) => setTargetName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Role</label>
                <input
                  type="text"
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value)}
                  placeholder="HR Manager"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent bg-white"
                />
              </div>
            </div>
            <div className={cn("grid gap-3", slackEnabled && emailEnabled ? "grid-cols-2" : "grid-cols-1")}>
              {slackEnabled && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Slack User ID</label>
                  <input
                    type="text"
                    value={targetSlackId}
                    onChange={(e) => setTargetSlackId(e.target.value)}
                    placeholder="U01ABC2DEF3"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent bg-white"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Open their Slack profile &rarr; click <strong>&middot;&middot;&middot;</strong> (More) &rarr; <strong>Copy member ID</strong>
                  </p>
                </div>
              )}
              {emailEnabled && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
                  <input
                    type="email"
                    value={targetEmail}
                    onChange={(e) => setTargetEmail(e.target.value)}
                    placeholder="jane@company.com"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent bg-white"
                  />
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400">
              {slackEnabled && emailEnabled
                ? "At least one contact method (Slack ID or email) is required."
                : slackEnabled
                  ? "Slack User ID is required."
                  : "Email is required."}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveTarget}
                disabled={!targetFormValid || isSavingTarget}
                className="bg-slate-900 text-white rounded-lg px-3.5 py-1.5 text-xs font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isSavingTarget ? "Saving..." : editingTargetId ? "Update" : "Add"}
              </button>
              <button
                onClick={resetTargetForm}
                className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Target list */}
        {targets.length === 0 && !showTargetForm ? (
          <div className="border border-slate-100 rounded-xl px-4 py-6 text-center">
            <p className="text-sm text-slate-400">No escalation targets configured.</p>
            <p className="text-xs text-slate-300 mt-1">Add targets so employees can request verification.</p>
          </div>
        ) : targets.length > 0 ? (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left text-xs font-medium text-slate-500 px-4 py-2">Name</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-4 py-2">Role</th>
                  {slackEnabled && <th className="text-left text-xs font-medium text-slate-500 px-4 py-2">Slack ID</th>}
                  {emailEnabled && <th className="text-left text-xs font-medium text-slate-500 px-4 py-2">Email</th>}
                  <th className="text-right text-xs font-medium text-slate-500 px-4 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-4 py-2.5 text-xs font-medium text-slate-900">{t.name}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{t.role ?? "—"}</td>
                    {slackEnabled && <td className="px-4 py-2.5 text-xs text-slate-500 font-mono">{t.slackUserId ?? "—"}</td>}
                    {emailEnabled && <td className="px-4 py-2.5 text-xs text-slate-500">{t.email ?? "—"}</td>}
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => startEditTarget(t)}
                          className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => { if (confirm(`Delete target "${t.name}"?`)) deleteTargetMutation.mutate(t.id); }}
                          className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {/* ─── Escalation Log Link ──── */}
      <div className="border border-slate-100 rounded-xl px-4 py-5 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Escalation Log</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            View verification requests and unanswered questions in Analytics.
          </p>
        </div>
        <button
          onClick={() => void navigate({ to: "/analytics", search: { tab: "escalations" } })}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg px-4 py-2 transition-colors flex-shrink-0"
        >
          View Log
        </button>
      </div>
    </div>
  );
}

// ─── Settings page ────────────────────────────────────────────────────────────

export function SettingsPage({ tab }: { tab: SettingsTab }) {
  const user = useUser();
  const navigate = useNavigate();

  function setTab(id: SettingsTab) {
    void navigate({ to: "/settings", search: { tab: id }, replace: true });
  }

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["admin", "escalations", "unread-count"],
    queryFn: () =>
      fetch("/api/admin/escalations/unread-count", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ count: number }>;
      }),
    enabled: !!user?.isAdmin,
    refetchInterval: 30_000,
  });

  const unreadCount = unreadData?.count ?? 0;
  const visibleTabs = TABS.filter((t) => !t.adminOnly || user?.isAdmin);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-200">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5",
                tab === t.id
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-400 hover:text-slate-600",
              )}
            >
              {t.label}
              {t.id === "escalations" && unreadCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold leading-none bg-blue-500 text-white rounded-full">
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "account" && <AccountTab />}
        {tab === "privacy" && <PrivacyTab />}
        {tab === "members" && user?.isAdmin && <MembersTab />}
        {tab === "models" && user?.isAdmin && <ModelsTab />}
        {tab === "integrations" && user?.isAdmin && <IntegrationsTab />}
        {tab === "escalations" && user?.isAdmin && <EscalationsTab onSwitchTab={setTab} />}
      </div>
    </div>
  );
}
