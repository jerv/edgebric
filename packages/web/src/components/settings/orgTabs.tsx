
import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  CheckCircle, Circle, Loader2, Cpu, ShieldCheck,
  Mail, Plus, Trash2, Pencil, Slack, ChevronDown, ChevronUp, HelpCircle,
  Power, RotateCcw, Activity, Search, Upload, X, AlertTriangle,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import type { IntegrationConfig, EscalationTarget, User } from "@edgebric/types";
import { cn } from "@/lib/utils";
import { modelMeta } from "@/lib/models";
import { useUser } from "@/contexts/UserContext";
import type { OrgTab } from "@/components/OrganizationPage";

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
    mutationFn: async ({ userId, canCreateKBs }: { userId: string; canCreateKBs: boolean }) => {
      const res = await fetch(`/api/admin/org/members/${userId}/permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ canCreateKBs }),
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
      <div className="border border-slate-200 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Invite Member</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Invited users will be activated automatically when they sign in via SSO.
            </p>
          </div>
          <button
            onClick={() => setCsvImportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors"
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

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, email, or role..."
          className="w-full pl-9 pr-8 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Member list */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading members...
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">User</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Create KBs</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedMembers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-xs">
                      {searchQuery ? "No members match your search." : "No members yet."}
                    </td>
                  </tr>
                )}
                {pagedMembers.map((m) => {
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
                        ) : pendingRole?.userId === m.id ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={pendingRole.role}
                              onChange={(e) => setPendingRole({ userId: m.id, role: e.target.value })}
                              className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
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
                              className="text-xs text-slate-400 hover:text-slate-600"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setPendingRole({ userId: m.id, role: m.role })}
                            className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white hover:border-slate-300 transition-colors inline-flex items-center gap-1"
                          >
                            {m.role === "admin" ? "Admin" : "Member"}
                            <ChevronDown className="w-3 h-3 text-slate-400" />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {m.role === "admin" || m.role === "owner" ? (
                          <span className="text-xs text-slate-400">Always</span>
                        ) : (
                          <button
                            onClick={() => permsMutation.mutate({ userId: m.id, canCreateKBs: !m.canCreateKBs })}
                            disabled={permsMutation.isPending}
                            className={cn(
                              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                              m.canCreateKBs ? "bg-blue-500" : "bg-slate-200",
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
                      <td className="px-4 py-3 text-right">
                        {isSelf ? null : (
                          <button
                            onClick={() => { setRemoveTarget(m); setRemoveTyped(""); }}
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
                <p className="text-xs text-slate-500">
                  {filteredMembers.length} member{filteredMembers.length !== 1 ? "s" : ""}
                  {searchQuery ? " found" : " total"}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                    className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-slate-500 px-2">
                    {currentPage + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={currentPage >= totalPages - 1}
                    className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
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
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Remove user from organization</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  This will permanently remove <strong>{removeTarget.name ?? removeTarget.email}</strong> from the organization.
                  They will lose access to all knowledge bases and conversations.
                </p>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Type <span className="font-mono bg-slate-100 px-1 py-0.5 rounded text-red-600">{removeTarget.email}</span> to confirm
              </label>
              <input
                value={removeTyped}
                onChange={(e) => setRemoveTyped(e.target.value)}
                placeholder={removeTarget.email}
                autoFocus
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200"
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
                className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700"
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
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900">
                {csvStep === "upload" && "Import Users from CSV"}
                {csvStep === "map" && "Map Columns"}
                {csvStep === "preview" && "Review Import"}
              </h3>
              <button onClick={csvReset} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Step 1: Upload / Paste */}
            {csvStep === "upload" && (
              <>
                <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                  Upload or paste your CSV. Any format works — you'll map the columns in the next step.
                </p>

                <div className="mb-3">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Upload CSV file</label>
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
                    className="w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-200 file:bg-white file:text-xs file:font-medium file:text-slate-600 hover:file:bg-slate-50"
                  />
                </div>

                <div className="mb-3">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Or paste CSV data</label>
                  <textarea
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    rows={5}
                    placeholder={"name,email,department,role\nAlice Smith,alice@company.com,Engineering,admin\nBob Jones,bob@company.com,HR,member"}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
                  />
                </div>

                {csvError && <p className="text-xs text-red-600 mb-3">{csvError}</p>}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => csvDetectColumns(csvText)}
                    disabled={!csvText.trim()}
                    className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
                  >
                    Next
                  </button>
                  <button onClick={csvReset} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">
                    Cancel
                  </button>
                </div>
              </>
            )}

            {/* Step 2: Column Mapping */}
            {csvStep === "map" && (
              <>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                  We found <strong>{csvColumns.length}</strong> column{csvColumns.length !== 1 ? "s" : ""} and <strong>{csvRows.length}</strong> row{csvRows.length !== 1 ? "s" : ""} of data.
                  Map the columns below.
                </p>

                {/* Data preview snippet */}
                <div className="mb-4 border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        {csvColumns.map((col, i) => (
                          <th key={i} className="text-left px-3 py-2 font-medium text-slate-500 whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {csvRows.slice(0, 3).map((row, ri) => (
                        <tr key={ri}>
                          {csvColumns.map((_, ci) => (
                            <td key={ci} className="px-3 py-1.5 text-slate-600 whitespace-nowrap max-w-[200px] truncate">{row[ci] ?? ""}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Column mapping dropdowns */}
                <div className="space-y-3 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Email column <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={csvEmailCol}
                      onChange={(e) => setCsvEmailCol(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                    >
                      <option value={-1}>-- Select column --</option>
                      {csvColumns.map((col, i) => (
                        <option key={i} value={i}>{col} (e.g. "{csvRows[0]?.[i] ?? ""}")</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Role column <span className="text-slate-400">(optional — defaults to member)</span>
                    </label>
                    <select
                      value={csvRoleCol}
                      onChange={(e) => setCsvRoleCol(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
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
                    className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
                  >
                    Preview Import
                  </button>
                  <button
                    onClick={() => setCsvStep("upload")}
                    className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700"
                  >
                    Back
                  </button>
                </div>
              </>
            )}

            {/* Step 3: Preview and import */}
            {csvStep === "preview" && (
              <>
                <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                  <strong>{csvPreview.length}</strong> valid user{csvPreview.length !== 1 ? "s" : ""} ready to import.
                  {csvError && <span className="text-amber-600 ml-1">Some rows were skipped (see below).</span>}
                </p>

                {csvError && <p className="text-xs text-amber-600 mb-3">{csvError}</p>}

                <div className="mb-4 border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-3 py-2 font-medium text-slate-500">Email</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-500">Role</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {csvPreview.slice(0, 20).map((row, i) => (
                        <tr key={i}>
                          <td className="px-3 py-1.5 text-slate-700">{row.email}</td>
                          <td className="px-3 py-1.5 text-slate-500 capitalize">{row.role}</td>
                        </tr>
                      ))}
                      {csvPreview.length > 20 && (
                        <tr>
                          <td colSpan={2} className="px-3 py-1.5 text-slate-400 text-center">
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
                    className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
                  >
                    {bulkInviteMutation.isPending
                      ? "Importing..."
                      : `Import ${csvPreview.length} User${csvPreview.length !== 1 ? "s" : ""}`}
                  </button>
                  <button
                    onClick={() => setCsvStep("map")}
                    className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700"
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
      <div className="border border-slate-200 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Activity className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-900">Service Status</h3>
          {health && (
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full font-medium",
              health.status === "healthy" && "bg-green-50 text-green-700 border border-green-200",
              health.status === "degraded" && "bg-amber-50 text-amber-700 border border-amber-200",
              health.status === "unhealthy" && "bg-red-50 text-red-600 border border-red-200",
            )}>
              {health.status === "healthy" ? "All systems operational" : health.status === "degraded" ? "Degraded" : "Unavailable"}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="border border-slate-100 rounded-xl p-3">
            <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Inference</p>
            <div className="flex items-center gap-1.5">
              <div className={cn("w-2 h-2 rounded-full", inferenceStatus === "ok" ? "bg-green-500" : inferenceStatus === "degraded" ? "bg-amber-500" : "bg-red-400")} />
              <span className="text-xs font-medium text-slate-700 capitalize">{inferenceStatus}</span>
              {health?.checks?.inference?.latencyMs != null && (
                <span className="text-[10px] text-slate-400 ml-auto">{health.checks.inference.latencyMs}ms</span>
              )}
            </div>
          </div>
          <div className="border border-slate-100 rounded-xl p-3">
            <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Vector Store</p>
            <div className="flex items-center gap-1.5">
              <div className={cn("w-2 h-2 rounded-full", vectorStoreStatus === "ok" ? "bg-green-500" : vectorStoreStatus === "degraded" ? "bg-amber-500" : "bg-red-400")} />
              <span className="text-xs font-medium text-slate-700 capitalize">{vectorStoreStatus}</span>
              {health?.checks?.vectorStore?.latencyMs != null && (
                <span className="text-[10px] text-slate-400 ml-auto">{health.checks.vectorStore.latencyMs}ms</span>
              )}
            </div>
          </div>
          <div className="border border-slate-100 rounded-xl p-3">
            <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Uptime</p>
            <p className="text-xs font-medium text-slate-700">{health ? formatUptime(health.uptime) : "—"}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => stopMutation.mutate()}
            disabled={inferenceStatus !== "ok" || anyLoading || stopMutation.isPending}
            className="flex items-center gap-1.5 text-xs border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Power className="w-3.5 h-3.5" />
            {stopMutation.isPending ? "Stopping..." : "Stop"}
          </button>
          <button
            onClick={() => restartMutation.mutate()}
            disabled={anyLoading || restartMutation.isPending}
            className="flex items-center gap-1.5 text-xs border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
          <Cpu className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-900">Models</h3>
        </div>
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
                    {isLoading_ ? (
                      <Loader2 className="w-4 h-4 animate-spin flex-shrink-0 text-slate-400" />
                    ) : isActive ? (
                      <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    ) : (
                      <Circle className="w-4 h-4 flex-shrink-0 text-slate-300" />
                    )}

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

// ─── Integrations tab ────────────────────────────────────────────────────────

export function IntegrationsTab() {
  const queryClient = useQueryClient();

  // Drawer state
  const [slackOpen, setSlackOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

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
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Configure how escalation notifications are delivered to your team.
      </p>

      {/* ─── Slack drawer ──────────────────────────────────────────────────── */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        {/* Header — always visible */}
        <div
          className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
          onClick={() => setSlackOpen(!slackOpen)}
        >
          <div className="w-8 h-8 rounded-lg bg-[#4A154B] flex items-center justify-center flex-shrink-0">
            <Slack className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-medium text-sm text-slate-900">Slack</span>
            {slackEnabled && botToken ? (
              <span className="ml-2 text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-medium">
                Active
              </span>
            ) : (
              <span className="ml-2 text-xs bg-slate-50 text-slate-400 border border-slate-200 px-2 py-0.5 rounded-full font-medium">
                Inactive
              </span>
            )}
          </div>
          <label className="flex items-center gap-2 cursor-pointer" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={slackEnabled}
              onChange={(e) => setSlackEnabled(e.target.checked)}
              className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
            />
            <span className="text-xs text-slate-500">Enabled</span>
          </label>
          {slackOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>

        {/* Expandable body */}
        {slackOpen && (
          <div className="px-5 pb-5 pt-0 space-y-4 border-t border-slate-100">
            <div className="pt-4">
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
        )}
      </div>

      {/* ─── Email drawer ──────────────────────────────────────────────────── */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        {/* Header — always visible */}
        <div
          className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
          onClick={() => setEmailOpen(!emailOpen)}
        >
          <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
            <Mail className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-medium text-sm text-slate-900">Email Notifications</span>
            {emailEnabled && smtpHost ? (
              <span className="ml-2 text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-medium">
                Active
              </span>
            ) : (
              <span className="ml-2 text-xs bg-slate-50 text-slate-400 border border-slate-200 px-2 py-0.5 rounded-full font-medium">
                Inactive
              </span>
            )}
          </div>
          <label className="flex items-center gap-2 cursor-pointer" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={emailEnabled}
              onChange={(e) => setEmailEnabled(e.target.checked)}
              className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
            />
            <span className="text-xs text-slate-500">Enabled</span>
          </label>
          {emailOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>

        {/* Expandable body */}
        {emailOpen && (
          <div className="px-5 pb-5 pt-0 space-y-4 border-t border-slate-100">
            <div className="pt-4 space-y-3">
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
                  <p className="text-[11px] text-slate-400 mt-1">Some providers override this — see "How to configure" below.</p>
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
                      <li><strong>From address:</strong> Gmail SMTP overrides the "From" field with your login email. Use a domain SMTP provider (SendGrid, Resend, SES) if you need a custom from address.</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-slate-700">Microsoft 365 / Outlook</p>
                    <ul className="list-disc list-inside text-slate-500 space-y-0.5 ml-1">
                      <li>Host: <code className="bg-white border border-slate-200 px-1 rounded">smtp.office365.com</code>, Port: <code className="bg-white border border-slate-200 px-1 rounded">587</code>, TLS: on</li>
                      <li>Username: your full email address</li>
                      <li>Password: your account password (or app password if MFA is on)</li>
                      <li><strong>From address:</strong> Microsoft 365 requires the "From" address to match the authenticated account, or a shared mailbox/alias you have "Send As" permissions for.</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-slate-700">Amazon SES</p>
                    <ul className="list-disc list-inside text-slate-500 space-y-0.5 ml-1">
                      <li>Host: <code className="bg-white border border-slate-200 px-1 rounded">email-smtp.us-east-1.amazonaws.com</code>, Port: <code className="bg-white border border-slate-200 px-1 rounded">587</code>, TLS: on</li>
                      <li>Username/Password: SMTP credentials from the SES console (not your AWS keys)</li>
                      <li><strong>From address:</strong> Must be a verified identity (email or domain) in your SES account. Unverified addresses will be rejected.</li>
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
        )}
      </div>

      {/* ─── Microsoft Teams — coming soon ─────────────────────────────────── */}
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

// ─── Escalations tab ─────────────────────────────────────────────────────────

export function EscalationsTab({ onSwitchTab }: { onSwitchTab: (tab: OrgTab) => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ─── Target management state ─────
  const [showTargetForm, setShowTargetForm] = useState(false);
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [targetName, setTargetName] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [targetSlackId, setTargetSlackId] = useState("");
  const [targetEmail, setTargetEmail] = useState("");
  const [targetSlackNotify, setTargetSlackNotify] = useState(true);
  const [targetEmailNotify, setTargetEmailNotify] = useState(true);

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
    mutationFn: (data: { name: string; role?: string; slackUserId?: string; email?: string; slackNotify?: boolean; emailNotify?: boolean }) =>
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
    mutationFn: ({ id, data }: { id: string; data: { name?: string; role?: string; slackUserId?: string; email?: string; slackNotify?: boolean; emailNotify?: boolean } }) =>
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
    setTargetSlackNotify(true);
    setTargetEmailNotify(true);
  }

  function startEditTarget(target: EscalationTarget) {
    setEditingTargetId(target.id);
    setTargetName(target.name);
    setTargetRole(target.role ?? "");
    setTargetSlackId(target.slackUserId ?? "");
    setTargetEmail(target.email ?? "");
    setTargetSlackNotify(target.slackNotify !== false);
    setTargetEmailNotify(target.emailNotify !== false);
    setShowTargetForm(true);
  }

  function handleSaveTarget() {
    const data: { name: string; role?: string; slackUserId?: string; email?: string; slackNotify?: boolean; emailNotify?: boolean } = {
      name: targetName.trim(),
    };
    if (targetRole.trim()) data.role = targetRole.trim();
    if (targetSlackId.trim()) data.slackUserId = targetSlackId.trim();
    if (targetEmail.trim()) data.email = targetEmail.trim();
    data.slackNotify = targetSlackNotify;
    data.emailNotify = targetEmailNotify;

    if (editingTargetId) {
      updateTargetMutation.mutateAsync({ id: editingTargetId, data }).then(() => resetTargetForm());
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
              Members won't be able to send verification requests until a notification channel is active.
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
              People who can receive verification requests from members.
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
            {/* Notification method toggles — show per-method toggle for each filled contact */}
            {((slackEnabled && targetSlackId.trim()) || (emailEnabled && targetEmail.trim())) && (
              <div className="flex items-center gap-5">
                <p className="text-xs font-medium text-slate-500">Notify via:</p>
                {slackEnabled && targetSlackId.trim() && (
                  <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={targetSlackNotify}
                      onChange={(e) => setTargetSlackNotify(e.target.checked)}
                      className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 w-3.5 h-3.5"
                    />
                    Slack
                  </label>
                )}
                {emailEnabled && targetEmail.trim() && (
                  <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={targetEmailNotify}
                      onChange={(e) => setTargetEmailNotify(e.target.checked)}
                      className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 w-3.5 h-3.5"
                    />
                    Email
                  </label>
                )}
              </div>
            )}
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
            <p className="text-xs text-slate-300 mt-1">Add targets so members can request verification.</p>
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
                  <th className="text-center text-xs font-medium text-slate-500 px-4 py-2">Notify</th>
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
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-center gap-2">
                        {slackEnabled && t.slackUserId && (
                          <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium", t.slackNotify !== false ? "bg-slate-100 text-slate-600" : "bg-slate-50 text-slate-300 line-through")} title={t.slackNotify !== false ? "Slack notifications on" : "Slack notifications off"}>
                            <Slack className="w-2.5 h-2.5" />
                          </span>
                        )}
                        {emailEnabled && t.email && (
                          <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium", t.emailNotify !== false ? "bg-slate-100 text-slate-600" : "bg-slate-50 text-slate-300 line-through")} title={t.emailNotify !== false ? "Email notifications on" : "Email notifications off"}>
                            <Mail className="w-2.5 h-2.5" />
                          </span>
                        )}
                        {!(slackEnabled && t.slackUserId) && !(emailEnabled && t.email) && (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </div>
                    </td>
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
            View all verification requests from members.
          </p>
        </div>
        <button
          onClick={() => void navigate({ to: "/escalations" })}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg px-4 py-2 transition-colors flex-shrink-0"
        >
          View Log
        </button>
      </div>
    </div>
  );
}
