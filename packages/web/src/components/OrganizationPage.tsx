
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Pencil, Building2, Image,
} from "lucide-react";
import type { Organization } from "@edgebric/types";
import { cn } from "@/lib/utils";
import { useUser } from "@/contexts/UserContext";
import { PrivacyTab } from "@/components/settings/PrivacyTab";
import { AvatarUpload } from "@/components/shared/AvatarUpload";

// Re-export tab components that already exist in SettingsPage
// We import them from the barrel — they'll be extracted into their own files in a follow-up
import {
  MembersTab,
  IntegrationsTab,
  EscalationsTab,
  ServiceTab,
} from "@/components/settings/orgTabs";

// ─── Tab types ───────────────────────────────────────────────────────────────

export type OrgTab = "general" | "privacy" | "members" | "service" | "integrations" | "escalations";

interface TabDef {
  id: OrgTab;
  label: string;
  adminOnly?: boolean;
  /** Label override for non-admin users */
  memberLabel?: string;
}

const TABS: TabDef[] = [
  { id: "general", label: "General" },
  { id: "privacy", label: "Privacy", memberLabel: "Vault Mode" },
  { id: "members", label: "Permissions", adminOnly: true },
  { id: "service", label: "Service", adminOnly: true },
  { id: "integrations", label: "Integrations", adminOnly: true },
  { id: "escalations", label: "Escalations", adminOnly: true },
];

// ─── General tab (org info + rename) ────────────────────────────────────────

function OrgGeneralTab() {
  const user = useUser();
  const queryClient = useQueryClient();
  const isAdmin = !!user?.isAdmin;

  const [editing, setEditing] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const { data: org } = useQuery<Organization>({
    queryKey: ["admin", "org"],
    queryFn: () =>
      fetch("/api/admin/org", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Organization>;
      }),
    enabled: isAdmin,
  });

  const displayOrgName = isAdmin ? org?.name : user?.orgName;
  const orgInitials = (displayOrgName ?? "O").slice(0, 2);
  const avatarUrl = user?.orgAvatarUrl;
  const avatarMode = user?.avatarMode ?? "org";

  async function uploadOrgAvatar(file: File): Promise<string> {
    const form = new FormData();
    form.append("avatar", file);
    const res = await fetch("/api/admin/org/avatar", {
      method: "POST",
      credentials: "same-origin",
      body: form,
    });
    if (!res.ok) throw new Error("Upload failed");
    const data = await res.json() as { avatarUrl: string };
    void queryClient.invalidateQueries({ queryKey: ["me"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "org"] });
    return data.avatarUrl;
  }

  async function removeOrgAvatar() {
    await fetch("/api/admin/org/avatar", {
      method: "DELETE",
      credentials: "same-origin",
    });
    void queryClient.invalidateQueries({ queryKey: ["me"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "org"] });
  }

  async function setAvatarMode(mode: "org" | "kb") {
    await fetch("/api/admin/org/avatar-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ avatarMode: mode }),
    });
    void queryClient.invalidateQueries({ queryKey: ["me"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "org"] });
  }

  return (
    <div className="space-y-6">
      {/* Org info card */}
      <div className="border border-slate-200 rounded-2xl p-5">
        <div className="flex items-center gap-4">
          {isAdmin ? (
            <AvatarUpload
              avatarUrl={avatarUrl}
              onUpload={uploadOrgAvatar}
              onRemove={removeOrgAvatar}
              size={56}
              fallbackText={orgInitials}
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 border border-slate-200 overflow-hidden">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Organization" className="w-full h-full object-cover" />
              ) : (
                <Building2 className="w-6 h-6 text-slate-400" />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-slate-900 truncate">
                {displayOrgName ?? "Organization"}
              </p>
              {isAdmin && !editing && (
                <button
                  onClick={() => {
                    setOrgName(org?.name ?? "");
                    setEditing(true);
                    setError("");
                  }}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-md px-2 py-1 transition-colors"
                  title="Rename organization"
                >
                  <Pencil className="w-3 h-3" />
                  Rename
                </button>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {isAdmin ? "You are an administrator of this organization." : "You are a member of this organization."}
            </p>
          </div>
        </div>

        {editing && isAdmin && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Organization name</label>
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                autoFocus
                className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  if (!orgName.trim()) { setError("Name is required"); return; }
                  setSaving(true);
                  setError("");
                  try {
                    const res = await fetch("/api/admin/org", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      credentials: "same-origin",
                      body: JSON.stringify({ name: orgName.trim() }),
                    });
                    if (!res.ok) {
                      const data = await res.json() as { error?: string };
                      setError(data.error ?? "Failed to save");
                      return;
                    }
                    setEditing(false);
                    void queryClient.invalidateQueries({ queryKey: ["admin", "org"] });
                    void queryClient.invalidateQueries({ queryKey: ["me"] });
                  } catch {
                    setError("Network error");
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={!orgName.trim() || saving}
                className="px-3 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Avatar Settings — admin only */}
      {isAdmin && (
        <div className="border border-slate-200 rounded-2xl p-5 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Image className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-900">Avatar Settings</h3>
            </div>
            <p className="text-xs text-slate-500">
              Choose which avatar the bot uses in chat responses. KBs can always have their own photo — this setting controls what employees see in chat.
            </p>
          </div>

          <div className="space-y-2">
            <label
              className={cn(
                "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors",
                avatarMode === "org" ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300",
              )}
            >
              <input
                type="radio"
                name="avatarMode"
                checked={avatarMode === "org"}
                onChange={() => void setAvatarMode("org")}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-slate-800">Organization avatar</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  The bot uses the organization's picture for all responses. This is the default.
                </p>
              </div>
            </label>
            <label
              className={cn(
                "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors",
                avatarMode === "kb" ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300",
              )}
            >
              <input
                type="radio"
                name="avatarMode"
                checked={avatarMode === "kb"}
                onChange={() => void setAvatarMode("kb")}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-slate-800">Knowledge Base avatars</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Chat responses show the avatar of the KB that sourced the answer. Falls back to org avatar if a KB has no photo set.
                </p>
              </div>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Organization page ──────────────────────────────────────────────────────

export function OrganizationPage({ tab }: { tab: OrgTab }) {
  const user = useUser();
  const navigate = useNavigate();
  const isAdmin = !!user?.isAdmin;

  function setTab(id: OrgTab) {
    void navigate({ to: "/organization", search: { tab: id }, replace: true });
  }

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["admin", "escalations", "unread-count"],
    queryFn: () =>
      fetch("/api/admin/escalations/unread-count", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ count: number }>;
      }),
    enabled: isAdmin,
    refetchInterval: 30_000,
  });

  const unreadCount = unreadData?.count ?? 0;

  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <h1 className="text-xl font-semibold text-slate-900">Organization</h1>

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
              {!isAdmin && t.memberLabel ? t.memberLabel : t.label}
              {t.id === "escalations" && unreadCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold leading-none bg-blue-500 text-white rounded-full">
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "general" && <OrgGeneralTab />}
        {tab === "privacy" && <PrivacyTab />}
        {tab === "members" && isAdmin && <MembersTab />}
        {tab === "service" && isAdmin && <ServiceTab />}
        {tab === "integrations" && isAdmin && <IntegrationsTab />}
        {tab === "escalations" && isAdmin && <EscalationsTab onSwitchTab={setTab} />}
      </div>
    </div>
  );
}
