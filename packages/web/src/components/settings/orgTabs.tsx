
import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle, Circle, Loader2, Cpu, ShieldCheck,
  Trash2, ChevronDown,
  Power, RotateCcw, Activity, Search, Upload, X, AlertTriangle,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import type { User } from "@edgebric/types";
import { cn } from "@/lib/utils";
import { modelMeta } from "@/lib/models";
import { useUser } from "@/contexts/UserContext";

const PAGE_SIZE = 15;

// ─── Members tab ─────────────────────────────────────────────────────────────

export function MembersTab() {
  const user = useUser();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [removeTarget, setRemoveTarget] = useState<User | null>(null);
  const [removeTyped, setRemoveTyped] = useState("");
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvEmailCol, setCsvEmailCol] = useState(-1);
  const [csvRoleCol, setCsvRoleCol] = useState(-1);
  const [csvStep, setCsvStep] = useState<"upload" | "map" | "preview">("upload");
  const [csvPreview, setCsvPreview] = useState<{ email: string; role: string }[]>([]);
  const [csvError, setCsvError] = useState("");

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

  const bulkInviteMutation = useMutation({
    mutationFn: async (rows: { email: string; role: string }[]) => {
      const results: { email: string; ok: boolean; error?: string }[] = [];
      for (const row of rows) {
        try {
          const res = await fetch("/api/admin/org/members/invite", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(row),
          });
          if (res.status === 409) {
            results.push({ email: row.email, ok: false, error: "Already exists" });
          } else if (!res.ok) {
            results.push({ email: row.email, ok: false, error: `HTTP ${res.status}` });
          } else {
            results.push({ email: row.email, ok: true });
          }
        } catch {
          results.push({ email: row.email, ok: false, error: "Network error" });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "org", "members"] });
      const succeeded = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        csvReset();
      } else {
        setCsvError(`${succeeded} invited, ${failed.length} failed: ${failed.map((f) => `${f.email} (${f.error})`).join(", ")}`);
      }
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
      setRemoveTarget(null);
      setRemoveTyped("");
    },
  });

  const permsMutation = useMutation({
    mutationFn: async ({ userId, canCreateKBs, canCreateGroupChats }: { userId: string; canCreateKBs?: boolean; canCreateGroupChats?: boolean }) => {
      const body: Record<string, boolean> = {};
      if (canCreateKBs !== undefined) body.canCreateKBs = canCreateKBs;
      if (canCreateGroupChats !== undefined) body.canCreateGroupChats = canCreateGroupChats;
      const res = await fetch(`/api/admin/org/members/${userId}/permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update permissions");
      return res.json() as Promise<User>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "org", "members"] });
    },
  });

  const [pendingRole, setPendingRole] = useState<{ userId: string; role: string } | null>(null);

  // Filter + paginate
  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const q = searchQuery.toLowerCase();
    return members.filter(
      (m) =>
        m.email.toLowerCase().includes(q) ||
        (m.name ?? "").toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q),
    );
  }, [members, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pagedMembers = filteredMembers.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  // Reset page when search changes
  useEffect(() => { setPage(0); }, [searchQuery]);

  // CSV parsing — step 1: detect columns
  function csvDetectColumns(text: string) {
    const lines = text.trim().split("\n").filter((l) => l.trim());
    if (lines.length === 0) { setCsvError("No data found"); return; }

    const delimiter = lines[0]!.includes("\t") ? "\t" : ",";
    const allRows = lines.map((l) => l.split(delimiter).map((c) => c.trim().replace(/^"(.*)"$/, "$1")));
    const headerRow = allRows[0]!;

    // Detect if first row looks like a header (has non-email text)
    const firstRowHasEmail = headerRow.some((c) => c.includes("@"));
    const hasHeader = !firstRowHasEmail && headerRow.length > 0;

    const columns = hasHeader ? headerRow : headerRow.map((_, i) => `Column ${i + 1}`);
    const dataRows = hasHeader ? allRows.slice(1) : allRows;

    setCsvColumns(columns);
    setCsvRows(dataRows);

    // Auto-guess email column (first column containing @ signs)
    const emailGuess = columns.findIndex((c, i) => {
      const lower = c.toLowerCase();
      if (lower.includes("email") || lower.includes("e-mail")) return true;
      // Check if data in this column looks like emails
      return dataRows.slice(0, 5).some((r) => (r[i] ?? "").includes("@"));
    });
    setCsvEmailCol(emailGuess >= 0 ? emailGuess : 0);

    // Auto-guess role column
    const roleGuess = columns.findIndex((c) => {
      const lower = c.toLowerCase();
      return lower.includes("role") || lower.includes("type") || lower.includes("permission");
    });
    setCsvRoleCol(roleGuess);

    setCsvStep("map");
    setCsvError("");
  }

  // CSV parsing — step 2: apply column mapping to produce preview
  function csvApplyMapping() {
    if (csvEmailCol < 0) { setCsvError("Please select an email column"); return; }
    const rows: { email: string; role: string }[] = [];
    const errors: string[] = [];
    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i]!;
      const email = (row[csvEmailCol] ?? "").toLowerCase().trim();
      if (!email || !email.includes("@")) {
        errors.push(`Row ${i + 1}: invalid email "${email}"`);
        continue;
      }
      const rawRole = csvRoleCol >= 0 ? (row[csvRoleCol] ?? "").toLowerCase().trim() : "";
      const role = rawRole === "admin" ? "admin" : "member";
      rows.push({ email, role });
    }
    setCsvPreview(rows);
    setCsvError(errors.length > 0 ? errors.join("; ") : "");
    setCsvStep("preview");
  }

  function csvReset() {
    setCsvImportOpen(false);
    setCsvText("");
    setCsvColumns([]);
    setCsvRows([]);
    setCsvEmailCol(-1);
    setCsvRoleCol(-1);
    setCsvStep("upload");
    setCsvPreview([]);
    setCsvError("");
  }

  return (
    <div className="space-y-6">
      {/* Invite */}
      <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Invite Member</h3>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              Invited users will be activated automatically when they sign in via SSO.
            </p>
          </div>
          <button
            onClick={() => setCsvImportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-gray-400 border border-slate-200 dark:border-gray-800 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-900 hover:border-slate-300 dark:hover:border-gray-600 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            Import CSV
          </button>
        </div>
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
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
            />
          </div>
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as "member" | "admin")}
            className="px-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 bg-white dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={() => inviteMutation.mutate({ email: inviteEmail.trim(), role: inviteRole })}
            disabled={!inviteEmail.trim() || inviteMutation.isPending}
            className="px-4 py-2 text-sm bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-xl hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {inviteMutation.isPending ? "Inviting..." : "Invite"}
          </button>
        </div>
        {inviteMutation.isError && (
          <p className="text-xs text-red-600">{inviteMutation.error.message}</p>
        )}
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-gray-500" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, email, or role..."
          className="w-full pl-9 pr-8 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Member list */}
      <div className="border border-slate-200 dark:border-gray-800 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-400 dark:text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading members...
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-gray-900 border-b border-slate-200 dark:border-gray-800">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wide">User</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wide">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wide">Create Data Sources</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wide">Create Group Chats</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                {pagedMembers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400 dark:text-gray-500 text-xs">
                      {searchQuery ? "No members match your search." : "No members yet."}
                    </td>
                  </tr>
                )}
                {pagedMembers.map((m) => {
                  const isSelf = m.email === user?.email;
                  return (
                    <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-gray-900 transition-colors">
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-slate-800 dark:text-gray-200">{m.name ?? m.email.split("@")[0]}</p>
                          <p className="text-xs text-slate-400 dark:text-gray-500">{m.email}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                          m.status === "active"
                            ? "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400"
                            : "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400",
                        )}>
                          {m.status === "active" ? "Active" : "Invited"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {isSelf ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-gray-400">
                            <ShieldCheck className="w-3 h-3" />
                            {m.role === "admin" ? "Admin" : "Member"}
                            <span className="text-slate-300 dark:text-gray-600">(you)</span>
                          </span>
                        ) : pendingRole?.userId === m.id ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={pendingRole.role}
                              onChange={(e) => setPendingRole({ userId: m.id, role: e.target.value })}
                              className="text-xs border border-slate-200 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600"
                            >
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                            <button
                              onClick={() => {
                                roleMutation.mutate({ userId: pendingRole.userId, role: pendingRole.role });
                                setPendingRole(null);
                              }}
                              disabled={roleMutation.isPending || pendingRole.role === m.role}
                              className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-40"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setPendingRole(null)}
                              className="text-xs text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setPendingRole({ userId: m.id, role: m.role })}
                            className="text-xs border border-slate-200 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-900 dark:text-gray-100 hover:border-slate-300 dark:hover:border-gray-600 transition-colors inline-flex items-center gap-1"
                          >
                            {m.role === "admin" ? "Admin" : "Member"}
                            <ChevronDown className="w-3 h-3 text-slate-400 dark:text-gray-500" />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {m.role === "admin" || m.role === "owner" ? (
                          <span className="text-xs text-slate-400 dark:text-gray-500">Always</span>
                        ) : (
                          <button
                            onClick={() => permsMutation.mutate({ userId: m.id, canCreateKBs: !m.canCreateKBs })}
                            disabled={permsMutation.isPending}
                            className={cn(
                              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                              m.canCreateKBs ? "bg-blue-500" : "bg-slate-200 dark:bg-gray-700",
                            )}
                          >
                            <span
                              className={cn(
                                "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
                                m.canCreateKBs ? "translate-x-4" : "translate-x-1",
                              )}
                            />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {m.role === "admin" || m.role === "owner" ? (
                          <span className="text-xs text-slate-400 dark:text-gray-500">Always</span>
                        ) : (
                          <button
                            onClick={() => permsMutation.mutate({ userId: m.id, canCreateGroupChats: !m.canCreateGroupChats })}
                            disabled={permsMutation.isPending}
                            className={cn(
                              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                              m.canCreateGroupChats ? "bg-blue-500" : "bg-slate-200 dark:bg-gray-700",
                            )}
                          >
                            <span
                              className={cn(
                                "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
                                m.canCreateGroupChats ? "translate-x-4" : "translate-x-1",
                              )}
                            />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isSelf ? null : (
                          <button
                            onClick={() => { setRemoveTarget(m); setRemoveTyped(""); }}
                            className="text-slate-300 dark:text-gray-600 hover:text-red-500 transition-colors p-1"
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-gray-800 bg-slate-50 dark:bg-gray-900">
                <p className="text-xs text-slate-500 dark:text-gray-400">
                  {filteredMembers.length} member{filteredMembers.length !== 1 ? "s" : ""}
                  {searchQuery ? " found" : " total"}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                    className="p-1 text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-slate-500 dark:text-gray-400 px-2">
                    {currentPage + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={currentPage >= totalPages - 1}
                    className="p-1 text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {roleMutation.isError && (
        <p className="text-xs text-red-600">{roleMutation.error.message}</p>
      )}

      {/* ─── Remove User Confirmation Dialog ─────────────────────────────────── */}
      {removeTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) { setRemoveTarget(null); setRemoveTyped(""); } }}
        >
          <div className="bg-white dark:bg-gray-950 rounded-2xl shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-950 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Remove user from organization</h3>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 leading-relaxed">
                  This will permanently remove <strong>{removeTarget.name ?? removeTarget.email}</strong> from the organization.
                  They will lose access to all sources and conversations.
                </p>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-600 dark:text-gray-400 mb-1.5">
                Type <span className="font-mono bg-slate-100 dark:bg-gray-800 px-1 py-0.5 rounded text-red-600 dark:text-red-400">{removeTarget.email}</span> to confirm
              </label>
              <input
                value={removeTyped}
                onChange={(e) => setRemoveTyped(e.target.value)}
                placeholder={removeTarget.email}
                autoFocus
                className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200 dark:focus:ring-red-800 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => removeMutation.mutate(removeTarget.id)}
                disabled={removeTyped !== removeTarget.email || removeMutation.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
              >
                {removeMutation.isPending ? "Removing..." : "Remove User"}
              </button>
              <button
                onClick={() => { setRemoveTarget(null); setRemoveTyped(""); }}
                className="px-4 py-2 text-sm text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
            {removeMutation.isError && (
              <p className="text-xs text-red-600 mt-2">{removeMutation.error.message}</p>
            )}
          </div>
        </div>
      )}

      {/* ─── CSV Import Dialog ────────────────────────────────────────────────── */}
      {csvImportOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) csvReset(); }}
        >
          <div className="bg-white dark:bg-gray-950 rounded-2xl shadow-xl p-6 max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">
                {csvStep === "upload" && "Import Users from CSV"}
                {csvStep === "map" && "Map Columns"}
                {csvStep === "preview" && "Review Import"}
              </h3>
              <button onClick={csvReset} className="text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Step 1: Upload / Paste */}
            {csvStep === "upload" && (
              <>
                <p className="text-xs text-slate-500 dark:text-gray-400 mb-3 leading-relaxed">
                  Upload or paste your CSV. Any format works — you'll map the columns in the next step.
                </p>

                <div className="mb-3">
                  <label className="block text-xs font-medium text-slate-600 dark:text-gray-400 mb-1">Upload CSV file</label>
                  <input
                    type="file"
                    accept=".csv,.txt,.tsv"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        const text = ev.target?.result as string;
                        setCsvText(text);
                        csvDetectColumns(text);
                      };
                      reader.readAsText(file);
                    }}
                    className="w-full text-xs text-slate-500 dark:text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-200 dark:file:border-gray-700 file:bg-white dark:file:bg-gray-900 file:text-xs file:font-medium file:text-slate-600 dark:file:text-gray-400 hover:file:bg-slate-50 dark:hover:file:bg-gray-800"
                  />
                </div>

                <div className="mb-3">
                  <label className="block text-xs font-medium text-slate-600 dark:text-gray-400 mb-1">Or paste CSV data</label>
                  <textarea
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    rows={5}
                    placeholder={"name,email,department,role\nAlice Smith,alice@company.com,Engineering,admin\nBob Jones,bob@company.com,HR,member"}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 resize-none dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
                  />
                </div>

                {csvError && <p className="text-xs text-red-600 mb-3">{csvError}</p>}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => csvDetectColumns(csvText)}
                    disabled={!csvText.trim()}
                    className="px-4 py-2 text-sm bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
                  >
                    Next
                  </button>
                  <button onClick={csvReset} className="px-4 py-2 text-sm text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300">
                    Cancel
                  </button>
                </div>
              </>
            )}

            {/* Step 2: Column Mapping */}
            {csvStep === "map" && (
              <>
                <p className="text-xs text-slate-500 dark:text-gray-400 mb-4 leading-relaxed">
                  We found <strong>{csvColumns.length}</strong> column{csvColumns.length !== 1 ? "s" : ""} and <strong>{csvRows.length}</strong> row{csvRows.length !== 1 ? "s" : ""} of data.
                  Map the columns below.
                </p>

                {/* Data preview snippet */}
                <div className="mb-4 border border-slate-200 dark:border-gray-800 rounded-lg overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-gray-900 border-b border-slate-200 dark:border-gray-800">
                        {csvColumns.map((col, i) => (
                          <th key={i} className="text-left px-3 py-2 font-medium text-slate-500 dark:text-gray-400 whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                      {csvRows.slice(0, 3).map((row, ri) => (
                        <tr key={ri}>
                          {csvColumns.map((_, ci) => (
                            <td key={ci} className="px-3 py-1.5 text-slate-600 dark:text-gray-400 whitespace-nowrap max-w-[200px] truncate">{row[ci] ?? ""}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Column mapping dropdowns */}
                <div className="space-y-3 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">
                      Email column <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={csvEmailCol}
                      onChange={(e) => setCsvEmailCol(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600"
                    >
                      <option value={-1}>-- Select column --</option>
                      {csvColumns.map((col, i) => (
                        <option key={i} value={i}>{col} (e.g. "{csvRows[0]?.[i] ?? ""}")</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">
                      Role column <span className="text-slate-400 dark:text-gray-500">(optional — defaults to member)</span>
                    </label>
                    <select
                      value={csvRoleCol}
                      onChange={(e) => setCsvRoleCol(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600"
                    >
                      <option value={-1}>-- No role column (all as member) --</option>
                      {csvColumns.map((col, i) => (
                        <option key={i} value={i}>{col} (e.g. "{csvRows[0]?.[i] ?? ""}")</option>
                      ))}
                    </select>
                  </div>
                </div>

                {csvError && <p className="text-xs text-red-600 mb-3">{csvError}</p>}

                <div className="flex items-center gap-2">
                  <button
                    onClick={csvApplyMapping}
                    disabled={csvEmailCol < 0}
                    className="px-4 py-2 text-sm bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
                  >
                    Preview Import
                  </button>
                  <button
                    onClick={() => setCsvStep("upload")}
                    className="px-4 py-2 text-sm text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300"
                  >
                    Back
                  </button>
                </div>
              </>
            )}

            {/* Step 3: Preview and import */}
            {csvStep === "preview" && (
              <>
                <p className="text-xs text-slate-500 dark:text-gray-400 mb-3 leading-relaxed">
                  <strong>{csvPreview.length}</strong> valid user{csvPreview.length !== 1 ? "s" : ""} ready to import.
                  {csvError && <span className="text-amber-600 ml-1">Some rows were skipped (see below).</span>}
                </p>

                {csvError && <p className="text-xs text-amber-600 mb-3">{csvError}</p>}

                <div className="mb-4 border border-slate-200 dark:border-gray-800 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-gray-900 border-b border-slate-200 dark:border-gray-800">
                        <th className="text-left px-3 py-2 font-medium text-slate-500 dark:text-gray-400">Email</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-500 dark:text-gray-400">Role</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                      {csvPreview.slice(0, 20).map((row, i) => (
                        <tr key={i}>
                          <td className="px-3 py-1.5 text-slate-700 dark:text-gray-300">{row.email}</td>
                          <td className="px-3 py-1.5 text-slate-500 dark:text-gray-400 capitalize">{row.role}</td>
                        </tr>
                      ))}
                      {csvPreview.length > 20 && (
                        <tr>
                          <td colSpan={2} className="px-3 py-1.5 text-slate-400 dark:text-gray-500 text-center">
                            ...and {csvPreview.length - 20} more
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => bulkInviteMutation.mutate(csvPreview)}
                    disabled={csvPreview.length === 0 || bulkInviteMutation.isPending}
                    className="px-4 py-2 text-sm bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
                  >
                    {bulkInviteMutation.isPending
                      ? "Importing..."
                      : `Import ${csvPreview.length} User${csvPreview.length !== 1 ? "s" : ""}`}
                  </button>
                  <button
                    onClick={() => setCsvStep("map")}
                    className="px-4 py-2 text-sm text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300"
                  >
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Service tab (formerly Models tab) ───────────────────────────────────────

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


interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  checks: Record<string, { status: string; latencyMs?: number; error?: string }>;
}

export function ServiceTab() {
  const queryClient = useQueryClient();

  const { data: health } = useQuery<HealthResponse>({
    queryKey: ["health"],
    queryFn: () =>
      fetch("/api/health", { credentials: "same-origin" }).then((r) =>
        r.json() as Promise<HealthResponse>,
      ),
    refetchInterval: 10_000,
  });

  const { data, isLoading } = useQuery<ModelsResponse>({
    queryKey: ["admin", "models"],
    queryFn: () =>
      fetch("/api/admin/models", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ModelsResponse>;
      }),
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

  const stopMutation = useMutation({
    mutationFn: () =>
      fetch("/api/admin/models/stop", {
        method: "POST",
        credentials: "same-origin",
      }).then((r) => {
        if (!r.ok) throw new Error("Stop failed");
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "models"] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });

  const restartMutation = useMutation({
    mutationFn: () =>
      fetch("/api/admin/models/restart", {
        method: "POST",
        credentials: "same-origin",
      }).then((r) => {
        if (!r.ok) throw new Error("Restart failed");
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "models"] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });

  const anyLoading = !!data?.loadingModelId || loadMutation.isPending || restartMutation.isPending;
  const inferenceStatus = health?.checks?.inference?.status ?? "unknown";
  const vectorStoreStatus = health?.checks?.vectorStore?.status ?? "unknown";

  function formatUptime(seconds: number) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }

  // Sort: loaded first, then by id
  const sorted = [...(data?.models ?? [])].sort((a, b) => {
    if (a.readyToUse !== b.readyToUse) return a.readyToUse ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  return (
    <div className="space-y-6">
      {/* Service status card */}
      <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Activity className="w-4 h-4 text-slate-400 dark:text-gray-500" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Service Status</h3>
          {health && (
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full font-medium",
              health.status === "healthy" && "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800",
              health.status === "degraded" && "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800",
              health.status === "unhealthy" && "bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800",
            )}>
              {health.status === "healthy" ? "All systems operational" : health.status === "degraded" ? "Degraded" : "Unavailable"}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="border border-slate-100 dark:border-gray-800 rounded-xl p-3">
            <p className="text-[11px] text-slate-400 dark:text-gray-500 uppercase tracking-wide mb-1">Inference</p>
            <div className="flex items-center gap-1.5">
              <div className={cn("w-2 h-2 rounded-full", inferenceStatus === "ok" ? "bg-green-500" : inferenceStatus === "degraded" ? "bg-amber-500" : "bg-red-400")} />
              <span className="text-xs font-medium text-slate-700 dark:text-gray-300 capitalize">{inferenceStatus}</span>
              {health?.checks?.inference?.latencyMs != null && (
                <span className="text-[10px] text-slate-400 dark:text-gray-500 ml-auto">{health.checks.inference.latencyMs}ms</span>
              )}
            </div>
          </div>
          <div className="border border-slate-100 dark:border-gray-800 rounded-xl p-3">
            <p className="text-[11px] text-slate-400 dark:text-gray-500 uppercase tracking-wide mb-1">Vector Store</p>
            <div className="flex items-center gap-1.5">
              <div className={cn("w-2 h-2 rounded-full", vectorStoreStatus === "ok" ? "bg-green-500" : vectorStoreStatus === "degraded" ? "bg-amber-500" : "bg-red-400")} />
              <span className="text-xs font-medium text-slate-700 dark:text-gray-300 capitalize">{vectorStoreStatus}</span>
              {health?.checks?.vectorStore?.latencyMs != null && (
                <span className="text-[10px] text-slate-400 dark:text-gray-500 ml-auto">{health.checks.vectorStore.latencyMs}ms</span>
              )}
            </div>
          </div>
          <div className="border border-slate-100 dark:border-gray-800 rounded-xl p-3">
            <p className="text-[11px] text-slate-400 dark:text-gray-500 uppercase tracking-wide mb-1">Uptime</p>
            <p className="text-xs font-medium text-slate-700 dark:text-gray-300">{health ? formatUptime(health.uptime) : "—"}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => stopMutation.mutate()}
            disabled={inferenceStatus !== "ok" || anyLoading || stopMutation.isPending}
            className="flex items-center gap-1.5 text-xs border border-slate-200 dark:border-gray-800 rounded-lg px-3 py-1.5 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900 hover:border-slate-300 dark:hover:border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Power className="w-3.5 h-3.5" />
            {stopMutation.isPending ? "Stopping..." : "Stop"}
          </button>
          <button
            onClick={() => restartMutation.mutate()}
            disabled={anyLoading || restartMutation.isPending}
            className="flex items-center gap-1.5 text-xs border border-slate-200 dark:border-gray-800 rounded-lg px-3 py-1.5 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900 hover:border-slate-300 dark:hover:border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {restartMutation.isPending ? "Restarting..." : "Restart"}
          </button>
          {(stopMutation.isError || restartMutation.isError) && (
            <span className="text-xs text-red-500">
              {(stopMutation.error ?? restartMutation.error) instanceof Error
                ? (stopMutation.error ?? restartMutation.error)!.message
                : "Action failed"}
            </span>
          )}
        </div>
      </div>

      {/* Models */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-slate-400 dark:text-gray-500" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Models</h3>
        </div>
        <p className="text-xs text-slate-400 dark:text-gray-500">
          Loading a model restarts the inference server (~15-60s depending on model size).
        </p>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-slate-400 dark:text-gray-500 py-4">
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
                      ? "border-slate-900 bg-slate-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
                      : "border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-950",
                  )}
                >
                  <div className="flex items-center gap-3">
                    {isLoading_ ? (
                      <Loader2 className="w-4 h-4 animate-spin flex-shrink-0 text-slate-400 dark:text-gray-500" />
                    ) : isActive ? (
                      <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    ) : (
                      <Circle className="w-4 h-4 flex-shrink-0 text-slate-300 dark:text-gray-600" />
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn("font-medium text-sm", isActive ? "text-white dark:text-gray-900" : "text-slate-900 dark:text-gray-100")}>
                          {meta.family} — {meta.label}
                        </span>
                        <span className={cn(
                          "text-xs px-2 py-0.5 rounded-full font-mono font-medium",
                          isActive ? "bg-white/20 text-white dark:bg-gray-900/30 dark:text-gray-900" : "bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400",
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
                            isActive ? "bg-white/10 text-white/70 dark:bg-gray-900/20 dark:text-gray-600" : "bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800",
                          )}>
                            Loading...
                          </span>
                        )}
                      </div>
                    </div>

                    {!isActive && !isLoading_ && (
                      <button
                        onClick={() => loadMutation.mutate(model.id)}
                        disabled={anyLoading || !model.onDisk}
                        className={cn(
                          "flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors",
                          !model.onDisk
                            ? "border-slate-100 dark:border-gray-800 text-slate-300 dark:text-gray-600 cursor-not-allowed"
                            : anyLoading
                            ? "border-slate-100 dark:border-gray-800 text-slate-300 dark:text-gray-600 cursor-not-allowed"
                            : "border-slate-300 dark:border-gray-600 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900 hover:border-slate-400 dark:hover:border-gray-500",
                        )}
                        title={!model.onDisk ? "Model file not on disk" : undefined}
                      >
                        {model.onDisk ? "Load" : "Not downloaded"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// IntegrationsTab removed — Slack/Email/Teams integrations deferred to Phase 4
