
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "@tanstack/react-router";
import {
  Pencil, Building2, Lock,
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
} from "@/components/settings/orgTabs";
import { NetworkTab } from "@/components/settings/NetworkTab";
import { IntegrationsTab } from "@/components/settings/IntegrationsTab";
import { ApiKeysTab } from "@/components/settings/ApiKeysTab";

// ─── Tab types ───────────────────────────────────────────────────────────────

export type OrgTab = "general" | "privacy" | "members" | "network" | "integrations" | "api-keys";

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
  { id: "network", label: "Network", adminOnly: true },
  { id: "integrations", label: "Integrations", adminOnly: true },
  { id: "api-keys", label: "API Keys", adminOnly: true },
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

  return (
    <div className="space-y-6">
      {/* Org info card */}
      <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5">
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
            <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0 border border-slate-200 dark:border-gray-800 overflow-hidden">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Organization" className="w-full h-full object-cover" />
              ) : (
                <Building2 className="w-6 h-6 text-slate-400 dark:text-gray-500" />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-slate-900 dark:text-gray-100 truncate">
                {displayOrgName ?? "Organization"}
              </p>
              {isAdmin && !editing && (
                <button
                  onClick={() => {
                    setOrgName(org?.name ?? "");
                    setEditing(true);
                    setError("");
                  }}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 border border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-600 rounded-md px-2 py-1 transition-colors"
                  title="Rename organization"
                >
                  <Pencil className="w-3 h-3" />
                  Rename
                </button>
              )}
            </div>
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">
              {isAdmin ? "You are an administrator of this organization." : "You are a member of this organization."}
            </p>
          </div>
        </div>

        {editing && isAdmin && (
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-gray-800 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">Organization name</label>
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                autoFocus
                className="w-full px-3 py-1.5 text-sm border border-slate-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600"
              />
            </div>
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
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
                className="px-3 py-1.5 text-sm bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 text-sm text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300"
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

// ─── Organization page ──────────────────────────────────────────────────────

export function OrganizationPage({ tab }: { tab: OrgTab }) {
  const user = useUser();
  const navigate = useNavigate();
  const isAdmin = !!user?.isAdmin;
  const isSolo = user?.authMode === "none";

  function setTab(id: OrgTab) {
    void navigate({ to: "/organization", search: { tab: id }, replace: true });
  }

  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  // Redirect non-admins away from admin-only tabs
  const tabDef = TABS.find((t) => t.id === tab);
  if (tabDef?.adminOnly && !isAdmin) {
    void navigate({ to: "/organization", search: { tab: "general" }, replace: true });
    return null;
  }

  if (isSolo && tab !== "network") {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-6">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-gray-100">Organization</h1>
          <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-6 sm:p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-gray-800 flex items-center justify-center mx-auto">
              <Lock className="w-6 h-6 text-slate-400 dark:text-gray-500" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-gray-100">Multi-user features</h2>
            <p className="text-sm text-slate-500 dark:text-gray-400 max-w-md mx-auto">
              Organization mode enables SSO authentication, team members, group chats, and shared data sources across your network.
            </p>
            <Link
              to="/account"
              search={{ tab: "general" }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium rounded-xl hover:bg-slate-800 dark:hover:bg-gray-200 transition-colors"
            >
              Enable Organization Mode
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-6">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-gray-100">Organization</h1>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-200 dark:border-gray-800 overflow-x-auto">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 whitespace-nowrap",
                tab === t.id
                  ? "border-slate-900 dark:border-gray-100 text-slate-900 dark:text-gray-100"
                  : "border-transparent text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-400",
              )}
            >
              {!isAdmin && t.memberLabel ? t.memberLabel : t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "general" && <OrgGeneralTab />}
        {tab === "privacy" && <PrivacyTab />}
        {tab === "members" && isAdmin && <MembersTab />}
        {tab === "network" && isAdmin && <NetworkTab />}
        {tab === "integrations" && isAdmin && <IntegrationsTab />}
        {tab === "api-keys" && isAdmin && <ApiKeysTab />}
      </div>
    </div>
  );
}
