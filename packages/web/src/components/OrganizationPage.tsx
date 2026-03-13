
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Loader2, Pencil, Building2,
} from "lucide-react";
import type { Organization } from "@edgebric/types";
import { cn } from "@/lib/utils";
import { useUser } from "@/contexts/UserContext";
import { PrivacyTab } from "@/components/settings/PrivacyTab";

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
  { id: "members", label: "Members", adminOnly: true },
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

  return (
    <div className="space-y-6">
      <div className="border border-slate-200 rounded-2xl p-5">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-6 h-6 text-slate-400" />
          </div>
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
