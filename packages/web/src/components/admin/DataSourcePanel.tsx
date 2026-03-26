import { useState, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  FileText,
  Plus,
  ArrowLeft,
  Database,
  Pencil,
  AlertTriangle,
  Globe,
  Lock,
  X,
  ChevronDown,
  Search,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Network,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/contexts/UserContext";
import { AvatarUpload } from "@/components/shared/AvatarUpload";
import { SourcePanel } from "@/components/employee/SourcePanel";
import type { Document, DataSource, PIIWarning } from "@edgebric/types";

/** Format a full name into "First L." display format. */
function nameToDisplay(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return name;
  const first = parts[0]!;
  const firstCap = first.charAt(0).toUpperCase() + first.slice(1);
  if (parts.length === 1) return firstCap;
  return `${firstCap} ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.`;
}

/** Format an email into a display name: "john.doe@co.com" → "John D." */
function emailToDisplayName(email: string): string {
  const local = email.split("@")[0] ?? email;
  return nameToDisplay(local.replace(/[._]/g, " "));
}

/** Get a display-friendly owner label for a data source. Prefers ownerName over email. */
function ownerDisplayName(ds: DataSource): string {
  if (ds.ownerName) return nameToDisplay(ds.ownerName);
  return emailToDisplayName(ds.ownerId);
}

type DataSourceOwnerFilter = "all" | "mine";
type DataSourceStorageFilter = "all" | "network" | "vault";
type DataSourceSort = "name" | "updated" | "files" | "storage" | "access" | "owner";
type SortDir = "asc" | "desc";

// ─── Shared Source Type Selector ─────────────────────────────────────────────

function SourceTypeSelector({
  value,
  onChange,
  compact,
}: {
  value: "organization" | "personal";
  onChange: (type: "organization" | "personal") => void;
  /** Compact labels for edit form ("Network" / "Vault") vs full labels for create ("Network Source" / "Vault Source"). */
  compact?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-slate-500 dark:text-gray-400">Source Type</label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange("organization")}
          className={cn(
            "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors",
            value === "organization"
              ? "border-slate-900 dark:border-gray-100 bg-slate-900/5 dark:bg-gray-100/5"
              : "border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700",
          )}
        >
          <Globe className={cn("w-4 h-4 shrink-0", value === "organization" ? "text-slate-900 dark:text-gray-100" : "text-slate-400 dark:text-gray-500")} />
          <div>
            <p className={cn("text-sm font-medium", value === "organization" ? "text-slate-900 dark:text-gray-100" : "text-slate-600 dark:text-gray-400")}>{compact ? "Network" : "Network Source"}</p>
            <p className="text-xs text-slate-400 dark:text-gray-500">{compact ? "Org server" : "Stored on org server"}</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => onChange("personal")}
          className={cn(
            "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors",
            value === "personal"
              ? "border-slate-900 dark:border-gray-100 bg-slate-900/5 dark:bg-gray-100/5"
              : "border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700",
          )}
        >
          <Lock className={cn("w-4 h-4 shrink-0", value === "personal" ? "text-slate-900 dark:text-gray-100" : "text-slate-400 dark:text-gray-500")} />
          <div>
            <p className={cn("text-sm font-medium", value === "personal" ? "text-slate-900 dark:text-gray-100" : "text-slate-600 dark:text-gray-400")}>{compact ? "Vault" : "Vault Source"}</p>
            <p className="text-xs text-slate-400 dark:text-gray-500">{compact ? "Your device" : "Encrypted on your device"}</p>
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Document["status"] }) {
  const config: Record<string, { bg: string; dot: string; label: string }> = {
    ready: { bg: "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400", dot: "bg-green-500", label: "Ready" },
    processing: { bg: "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400", dot: "bg-amber-500 animate-pulse", label: "Processing" },
    failed: { bg: "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400", dot: "bg-red-500", label: "Failed" },
    pii_review: { bg: "bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-400", dot: "bg-orange-500", label: "Needs Review" },
    rejected: { bg: "bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400", dot: "bg-red-400", label: "Rejected" },
  };
  const c = config[status] ?? config.failed!;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium", c.bg)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", c.dot)} />
      {c.label}
    </span>
  );
}

// ─── Security Toggle ─────────────────────────────────────────────────────────

function SecurityToggle({ label, description, checked, onChange, disabled }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={cn(
          "relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 focus:ring-offset-1 mt-0.5",
          checked ? "bg-slate-900 dark:bg-gray-100" : "bg-slate-200 dark:bg-gray-700",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white dark:bg-gray-950 shadow transform transition duration-200 ease-in-out",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-slate-700 dark:text-gray-300 group-hover:text-slate-900 dark:group-hover:text-gray-100">{label}</span>
        <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">{description}</p>
      </div>
    </label>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface UploadingFile {
  name: string;
  docId?: string;
  status: "uploading" | "processing" | "ready" | "failed" | "pii_review" | "rejected";
  error?: string;
}

interface DataSourceDetailResponse extends DataSource {
  documents: (Document & { isStale?: boolean })[];
  accessList?: string[];
  rebuilding?: boolean;
}

/** Tooltip that shows PII reasons on hover — uses fixed positioning to escape overflow containers. */
function PIIReasonTooltip({ warnings }: { warnings: PIIWarning[] }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  const reasonCounts = new Map<string, number>();
  for (const w of warnings) {
    reasonCounts.set(w.pattern, (reasonCounts.get(w.pattern) ?? 0) + 1);
  }

  function handleEnter() {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ x: rect.left, y: rect.bottom + 4 });
    }
    setShow(true);
  }

  return (
    <>
      <span ref={ref} onMouseEnter={handleEnter} onMouseLeave={() => setShow(false)}>
        <StatusBadge status="pii_review" />
      </span>
      {show && (
        <div
          className="fixed w-60 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-lg shadow-lg p-2.5 z-50 space-y-1"
          style={{ left: pos.x, top: pos.y }}
        >
          {[...reasonCounts.entries()].map(([reason, count]) => (
            <p key={reason} className="text-[11px] text-slate-600 dark:text-gray-400 leading-tight">
              {reason}{count > 1 ? ` (${count} sections)` : ""}
            </p>
          ))}
          <p className="text-[11px] text-slate-400 dark:text-gray-500 leading-tight pt-0.5">
            Use the actions on the right to approve or reject.
          </p>
        </div>
      )}
    </>
  );
}

// ─── Data Source List View ────────────────────────────────────────────────────

function DSListView({ onSelect }: { onSelect: (ds: DataSource) => void }) {
  const user = useUser();
  const canCreate = user?.canCreateDataSources ?? user?.isAdmin ?? false;
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createAccessMode, setCreateAccessMode] = useState<"all" | "restricted">("all");
  const [createAccessList, setCreateAccessList] = useState<string[]>([]);
  const [createType, setCreateType] = useState<"organization" | "personal">("organization");
  const [createAccessEmail, setCreateAccessEmail] = useState("");
  const [createShowSuggestions, setCreateShowSuggestions] = useState(false);
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<DataSourceOwnerFilter>("all");
  const [storageFilter, setStorageFilter] = useState<DataSourceStorageFilter>("all");
  const [sortBy, setSortBy] = useState<DataSourceSort>(() =>
    (localStorage.getItem("sources-sort") as DataSourceSort) || "name",
  );
  const [sortDir, setSortDir] = useState<SortDir>(() =>
    (localStorage.getItem("sources-sort-dir") as SortDir) || "asc",
  );

  function toggleSort(col: DataSourceSort) {
    if (sortBy === col) {
      const next: SortDir = sortDir === "asc" ? "desc" : "asc";
      setSortDir(next);
      localStorage.setItem("sources-sort-dir", next);
    } else {
      setSortBy(col);
      setSortDir("asc");
      localStorage.setItem("sources-sort", col);
      localStorage.setItem("sources-sort-dir", "asc");
    }
  }

  const { data: dataSources = [], isLoading } = useQuery<(DataSource & { rebuilding?: boolean })[]>({
    queryKey: ["data-sources"],
    queryFn: () =>
      fetch("/api/data-sources", { credentials: "same-origin" }).then((r) => r.json() as Promise<(DataSource & { rebuilding?: boolean })[]>),
    refetchInterval: (query) => query.state.data?.some((ds) => ds.rebuilding) ? 3000 : false,
  });

  // Fetch org members for email autocomplete (only when create form is open)
  const { data: createMembers = [] } = useQuery<{ email: string; name?: string }[]>({
    queryKey: ["org-members"],
    queryFn: () =>
      fetch("/api/admin/org/members", { credentials: "same-origin" }).then(
        (r) => r.ok ? r.json() as Promise<{ email: string; name?: string }[]> : [],
      ),
    staleTime: 60_000,
    enabled: showCreate,
  });

  const createEmailSuggestions = useMemo(() => {
    if (!createAccessEmail.trim()) return [];
    const q = createAccessEmail.toLowerCase();
    return createMembers
      .filter(
        (m) =>
          m.email &&
          !createAccessList.includes(m.email.toLowerCase()) &&
          (m.email.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q)),
      )
      .slice(0, 5);
  }, [createAccessEmail, createMembers, createAccessList]);

  function addCreateAccessEmail(email?: string) {
    const e = (email ?? createAccessEmail).trim().toLowerCase();
    if (!e || !e.includes("@")) return;
    if (createAccessList.includes(e)) { setCreateAccessEmail(""); setCreateShowSuggestions(false); return; }
    setCreateAccessList((prev) => [...prev, e]);
    setCreateAccessEmail("");
    setCreateShowSuggestions(false);
  }

  function resetCreateForm() {
    setShowCreate(false);
    setName("");
    setDescription("");
    setCreateType("organization");
    setCreateAccessMode("all");
    setCreateAccessList([]);
    setCreateAccessEmail("");
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setPendingAvatar(null);
    setAvatarPreview(undefined);
  }

  const createMutation = useMutation({
    mutationFn: (body: { name: string; description?: string; type?: "organization" | "personal"; accessMode?: string; accessList?: string[] }) =>
      fetch("/api/data-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to create data source");
        return r.json() as Promise<DataSource>;
      }),
    onSuccess: async (ds) => {
      // Upload pending avatar if one was selected
      if (pendingAvatar) {
        const form = new FormData();
        form.append("avatar", pendingAvatar);
        await fetch(`/api/data-sources/${ds.id}/avatar`, {
          method: "POST",
          credentials: "same-origin",
          body: form,
        }).catch(() => {}); // best effort — data source is created either way
      }
      void queryClient.invalidateQueries({ queryKey: ["data-sources"] });
      resetCreateForm();
      onSelect(ds);
    },
  });

  const myEmail = user?.email?.toLowerCase() ?? "";
  const myDSCount = dataSources.filter((ds) => ds.ownerId.toLowerCase() === myEmail).length;

  const filteredDS = useMemo(() => {
    let list = dataSources;
    // Filter by ownership
    if (ownerFilter === "mine") {
      list = list.filter((ds) => ds.ownerId.toLowerCase() === myEmail);
    }
    // Filter by storage type
    if (storageFilter === "network") {
      list = list.filter((ds) => ds.type === "organization");
    } else if (storageFilter === "vault") {
      list = list.filter((ds) => ds.type === "personal");
    }
    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (ds) =>
          ds.name.toLowerCase().includes(q) ||
          ds.description?.toLowerCase().includes(q) ||
          ownerDisplayName(ds).toLowerCase().includes(q),
      );
    }
    // Sort: user's data sources first, then by selected sort
    const dir = sortDir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const aIsMine = a.ownerId.toLowerCase() === myEmail ? 0 : 1;
      const bIsMine = b.ownerId.toLowerCase() === myEmail ? 0 : 1;
      if (aIsMine !== bIsMine) return aIsMine - bIsMine;
      switch (sortBy) {
        case "updated":
          return dir * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
        case "files":
          return dir * ((a.documentCount ?? 0) - (b.documentCount ?? 0));
        case "storage":
          return dir * (a.type ?? "organization").localeCompare(b.type ?? "organization");
        case "access":
          return dir * (a.accessMode ?? "all").localeCompare(b.accessMode ?? "all");
        case "owner":
          return dir * ownerDisplayName(a).localeCompare(ownerDisplayName(b));
        default:
          return dir * a.name.localeCompare(b.name);
      }
    });
  }, [dataSources, ownerFilter, storageFilter, search, myEmail, sortBy, sortDir]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-gray-100">Data Sources</h1>
            <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
              {dataSources.length} data source{dataSources.length !== 1 ? "s" : ""} in your organization
            </p>
          </div>
          {canCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium rounded-xl hover:bg-slate-800 dark:hover:bg-gray-200 transition-colors"
            >
              <Plus className="w-4 h-4" /> New Data Source
            </button>
          )}
        </div>

        {/* Create data source form */}
        {showCreate && (
          <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5 space-y-4 bg-slate-50 dark:bg-gray-900">
            <div className="flex items-center gap-3">
              <AvatarUpload
                avatarUrl={avatarPreview}
                onUpload={async (file) => {
                  setPendingAvatar(file);
                  const url = URL.createObjectURL(file);
                  if (avatarPreview) URL.revokeObjectURL(avatarPreview);
                  setAvatarPreview(url);
                  return url;
                }}
                onRemove={async () => {
                  if (avatarPreview) URL.revokeObjectURL(avatarPreview);
                  setPendingAvatar(null);
                  setAvatarPreview(undefined);
                }}
                size={48}
                fallbackText={name || "S"}
              />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Create Data Source</h2>
            </div>

            {/* Source type selector */}
            {user?.authMode !== "none" && (
              <SourceTypeSelector value={createType} onChange={setCreateType} />
            )}

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (e.g., HR Policies, Engineering Docs)"
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100"
              autoFocus
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 resize-none bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100"
            />

            {/* Access — only for organization sources */}
            {createType === "organization" && <div className="space-y-3 pt-1">
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-slate-500 dark:text-gray-400">Access</label>
                <div className="relative inline-block">
                  <select
                    value={createAccessMode}
                    onChange={(e) => setCreateAccessMode(e.target.value as "all" | "restricted")}
                    className="appearance-none bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-lg px-3 py-1.5 pr-8 text-sm text-slate-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600"
                  >
                    <option value="all">Whole organization</option>
                    <option value="restricted">Restricted by user</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-gray-500" />
                </div>
              </div>

              {createAccessMode === "restricted" && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    Only these users can search this source. Admins always have access.
                  </p>
                  <div className="relative">
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={createAccessEmail}
                        onChange={(e) => { setCreateAccessEmail(e.target.value); setCreateShowSuggestions(true); }}
                        onFocus={() => setCreateShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setCreateShowSuggestions(false), 200)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCreateAccessEmail(); } }}
                        placeholder="user@example.com"
                        className="flex-1 px-3 py-1.5 text-sm border border-slate-200 dark:border-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100"
                      />
                      <button
                        onClick={() => addCreateAccessEmail()}
                        disabled={!createAccessEmail.trim()}
                        className="px-3 py-1.5 text-sm bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Add
                      </button>
                    </div>
                    {createShowSuggestions && createEmailSuggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-12 mt-1 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-lg shadow-lg z-10 overflow-hidden">
                        {createEmailSuggestions.map((m) => (
                          <button
                            key={m.email}
                            onMouseDown={(e) => { e.preventDefault(); addCreateAccessEmail(m.email); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-gray-900 flex items-center gap-2"
                          >
                            <span className="text-slate-800 dark:text-gray-200">{m.email}</span>
                            {m.name && <span className="text-xs text-slate-400 dark:text-gray-500">{m.name}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {createAccessList.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {createAccessList.map((email) => (
                        <span
                          key={email}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-md text-xs text-slate-700 dark:text-gray-300"
                        >
                          {email}
                          <button
                            onClick={() => setCreateAccessList((prev) => prev.filter((e) => e !== email))}
                            className="text-slate-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {createAccessList.length === 0 && (
                    <p className="text-xs text-slate-400 dark:text-gray-500">No users added yet. Only admins can access this data source.</p>
                  )}
                </div>
              )}
            </div>}

            {/* Vault source note */}
            {createType === "personal" && (
              <p className="text-xs text-slate-500 dark:text-gray-400 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" />
                This source will be encrypted and stored locally on your device. Only you can access it.
              </p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={resetCreateForm}
                className="px-3 py-1.5 text-sm text-slate-600 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => createMutation.mutate({
                  name,
                  ...(description && { description }),
                  type: user?.authMode === "none" ? "personal" : createType,
                  ...(createType === "organization" && createAccessMode !== "all" && { accessMode: createAccessMode }),
                  ...(createType === "organization" && createAccessMode === "restricted" && createAccessList.length > 0 && { accessList: createAccessList }),
                })}
                disabled={!name.trim() || createMutation.isPending}
                className="px-4 py-1.5 text-sm bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-xl hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createMutation.isPending ? "Creating..." : "Create"}
              </button>
            </div>
            {createMutation.isError && (
              <p className="text-xs text-red-600 dark:text-red-400">You do not have permission to create sources. Ask an admin to grant access.</p>
            )}
          </div>
        )}

        {/* Search + filter bar */}
        {dataSources.length > 0 && (
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-gray-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search data sources..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 dark:border-gray-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Ownership filter */}
            <div className="flex items-center bg-slate-100 dark:bg-gray-800 rounded-lg p-0.5">
              <button
                onClick={() => setOwnerFilter("all")}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  ownerFilter === "all"
                    ? "bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100 shadow-sm"
                    : "text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300",
                )}
              >
                All ({dataSources.length})
              </button>
              <button
                onClick={() => setOwnerFilter("mine")}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  ownerFilter === "mine"
                    ? "bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100 shadow-sm"
                    : "text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300",
                )}
              >
                Created by me ({myDSCount})
              </button>
            </div>

            {/* Storage filter */}
            <div className="flex items-center bg-slate-100 dark:bg-gray-800 rounded-lg p-0.5">
              <button
                onClick={() => setStorageFilter("all")}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  storageFilter === "all"
                    ? "bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100 shadow-sm"
                    : "text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300",
                )}
              >
                All
              </button>
              <button
                onClick={() => setStorageFilter("network")}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1",
                  storageFilter === "network"
                    ? "bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100 shadow-sm"
                    : "text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300",
                )}
              >
                <Globe className="w-3 h-3" /> Network
              </button>
              <button
                onClick={() => setStorageFilter("vault")}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1",
                  storageFilter === "vault"
                    ? "bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100 shadow-sm"
                    : "text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300",
                )}
              >
                <Lock className="w-3 h-3" /> Vault
              </button>
            </div>
          </div>
        )}

        {/* Data source grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
          </div>
        ) : dataSources.length === 0 ? (
          <div className="text-center py-16">
            <Database className="w-10 h-10 text-slate-200 dark:text-gray-700 mx-auto mb-3" />
            <p className="text-sm text-slate-500 dark:text-gray-400">No data sources yet.</p>
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">Create one to start uploading files.</p>
          </div>
        ) : filteredDS.length === 0 ? (
          <div className="text-center py-12">
            <Search className="w-8 h-8 text-slate-200 dark:text-gray-700 mx-auto mb-3" />
            <p className="text-sm text-slate-500 dark:text-gray-400">No matching data sources.</p>
            <button onClick={() => { setSearch(""); setOwnerFilter("all"); setStorageFilter("all"); }} className="text-xs text-blue-600 hover:underline mt-1">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            {/* Table header — clickable columns for sorting */}
            <div className="grid grid-cols-[1fr_100px_100px_120px_100px] gap-4 px-5 py-2.5 bg-slate-50 dark:bg-gray-900 border-b border-slate-200 dark:border-gray-800 text-[11px] font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
              {([
                ["name", "Name"],
                ["files", "Files"],
                ["storage", "Storage"],
                ["access", "Access"],
                ["owner", "Owner"],
              ] as const).map(([col, label]) => (
                <button
                  key={col}
                  onClick={() => toggleSort(col)}
                  className="flex items-center gap-1 hover:text-slate-700 dark:hover:text-gray-300 transition-colors text-left"
                >
                  {label}
                  {sortBy === col && (
                    sortDir === "asc"
                      ? <ArrowUp className="w-3 h-3" />
                      : <ArrowDown className="w-3 h-3" />
                  )}
                </button>
              ))}
            </div>
            {filteredDS.map((ds, i) => {
              const isMine = ds.ownerId.toLowerCase() === myEmail;
              return (
                <button
                  key={ds.id}
                  onClick={() => onSelect(ds)}
                  className={cn(
                    "w-full grid grid-cols-[1fr_100px_100px_120px_100px] gap-4 px-5 py-3 text-left hover:bg-slate-50 dark:hover:bg-gray-900 transition-colors items-center",
                    i < filteredDS.length - 1 && "border-b border-slate-100 dark:border-gray-800",
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {ds.avatarUrl ? (
                      <div className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden">
                        <img src={ds.avatarUrl} alt={ds.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                        ds.type === "personal"
                          ? "bg-green-50 dark:bg-green-950"
                          : isMine ? "bg-blue-50 dark:bg-blue-950" : "bg-slate-100 dark:bg-gray-800",
                      )}>
                        <Database className={cn("w-3.5 h-3.5",
                          ds.type === "personal"
                            ? "text-green-500 dark:text-green-400"
                            : isMine ? "text-blue-500 dark:text-blue-400" : "text-slate-500 dark:text-gray-400",
                        )} />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-gray-100 truncate">{ds.name}</p>
                      {ds.description && (
                        <p className="text-xs text-slate-400 dark:text-gray-500 truncate">{ds.description}</p>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-gray-400 flex items-center gap-1.5">
                    {ds.documentCount} file{ds.documentCount !== 1 ? "s" : ""}
                    {ds.rebuilding && (
                      <RefreshCw className="w-3 h-3 text-blue-500 dark:text-blue-400 animate-spin" />
                    )}
                  </span>
                  <span className="relative group/storage">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full w-fit",
                        ds.type === "personal"
                          ? "bg-green-50 dark:bg-green-950 text-green-600 dark:text-green-400"
                          : "bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400",
                      )}
                    >
                      {ds.type === "personal" ? (
                        <><Lock className="w-3 h-3" /> Vault</>
                      ) : (
                        <><Globe className="w-3 h-3" /> Network</>
                      )}
                    </span>
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 text-[11px] leading-tight text-white dark:text-gray-100 bg-slate-800 dark:bg-gray-700 rounded-lg shadow-lg whitespace-nowrap opacity-0 pointer-events-none group-hover/storage:opacity-100 transition-opacity z-10">
                      {ds.type === "personal"
                        ? "Encrypted on your device — never leaves your machine"
                        : "Stored on the organization\u2019s network server"}
                    </span>
                  </span>
                  <span className="relative group/access">
                    <span
                      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full w-fit bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400"
                    >
                      {ds.type === "personal" ? (
                        <><Lock className="w-3 h-3" /> Only me</>
                      ) : ds.accessMode === "restricted" ? (
                        <><Lock className="w-3 h-3" /> Restricted</>
                      ) : (
                        <><Globe className="w-3 h-3" /> Whole org</>
                      )}
                    </span>
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 text-[11px] leading-tight text-white dark:text-gray-100 bg-slate-800 dark:bg-gray-700 rounded-lg shadow-lg whitespace-nowrap opacity-0 pointer-events-none group-hover/access:opacity-100 transition-opacity z-10">
                      {ds.type === "personal"
                        ? "Only you can access this source"
                        : ds.accessMode === "restricted"
                          ? "Only specific members have access"
                          : "All members in the organization can access this source"}
                    </span>
                  </span>
                  <span className="text-xs text-slate-500 dark:text-gray-400 truncate">
                    {isMine ? "You" : ownerDisplayName(ds)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Data Source Detail View ──────────────────────────────────────────────────

interface OrgMember {
  email: string;
  name?: string;
  role?: string;
}

function DSDetailView({ ds, onBack }: { ds: DataSource; onBack: () => void }) {
  const user = useUser();
  const canEdit = user?.isAdmin || user?.canCreateDataSources || false;
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteDSConfirm, setDeleteKBConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(ds.name);
  const [editDesc, setEditDesc] = useState(ds.description ?? "");
  const [editType, setEditType] = useState<"organization" | "personal">(ds.type as "organization" | "personal");
  const [showTypeWarning, setShowTypeWarning] = useState(false);
  const [accessEmail, setAccessEmail] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery<DataSourceDetailResponse>({
    queryKey: ["data-sources", ds.id],
    queryFn: () =>
      fetch(`/api/data-sources/${ds.id}`, { credentials: "same-origin" }).then(
        (r) => r.json() as Promise<DataSourceDetailResponse>,
      ),
    refetchInterval: (query) => uploading.some((u) => u.status === "processing") || query.state.data?.rebuilding ? 2000 : false,
  });

  const docs = data?.documents ?? [];

  // Fetch org members for email autocomplete
  const { data: members = [] } = useQuery<OrgMember[]>({
    queryKey: ["org-members"],
    queryFn: () =>
      fetch("/api/admin/org/members", { credentials: "same-origin" }).then(
        (r) => r.json() as Promise<OrgMember[]>,
      ),
    staleTime: 60_000,
  });

  const deleteDSMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/data-sources/${ds.id}`, { method: "DELETE", credentials: "same-origin" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["data-sources"] });
      onBack();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) =>
      fetch(`/api/documents/${docId}`, { method: "DELETE", credentials: "same-origin" }),
    onSuccess: () => {
      setDeleteConfirm(null);
      void queryClient.invalidateQueries({ queryKey: ["data-sources", ds.id] });
      void queryClient.invalidateQueries({ queryKey: ["data-sources"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (body: { name?: string; description?: string; type?: "organization" | "personal"; accessMode?: string; accessList?: string[]; allowSourceViewing?: boolean; allowVaultSync?: boolean; allowExternalAccess?: boolean }) =>
      fetch(`/api/data-sources/${ds.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["data-sources", ds.id] });
      void queryClient.invalidateQueries({ queryKey: ["data-sources"] });
    },
  });

  const currentAccessMode = data?.accessMode ?? ds.accessMode ?? "all";
  const currentAccessList = data?.accessList ?? [];

  function changeAccessMode(newMode: string) {
    updateMutation.mutate({ accessMode: newMode });
  }

  function addAccessEmail(email?: string) {
    const e = (email ?? accessEmail).trim().toLowerCase();
    if (!e || !e.includes("@")) return;
    if (currentAccessList.includes(e)) { setAccessEmail(""); setShowSuggestions(false); return; }
    updateMutation.mutate({ accessList: [...currentAccessList, e] });
    setAccessEmail("");
    setShowSuggestions(false);
  }

  function removeAccessEmail(email: string) {
    updateMutation.mutate({ accessList: currentAccessList.filter((e) => e !== email) });
  }

  // Filter members for autocomplete suggestions
  const emailSuggestions = useMemo(() => {
    if (!accessEmail.trim()) return [];
    const q = accessEmail.toLowerCase();
    return members
      .filter(
        (m) =>
          m.email &&
          !currentAccessList.includes(m.email.toLowerCase()) &&
          (m.email.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q)),
      )
      .slice(0, 5);
  }, [accessEmail, members, currentAccessList]);

  async function uploadFile(file: File) {
    const entry: UploadingFile = { name: file.name, status: "uploading" };
    setUploading((prev) => [...prev, entry]);

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/data-sources/${ds.id}/documents/upload`, {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setUploading((prev) =>
          prev.map((u) => (u.name === file.name ? { ...u, status: "failed", error: err.error ?? "Upload failed" } : u)),
        );
        return;
      }

      const { documentId } = await res.json() as { documentId: string };
      setUploading((prev) =>
        prev.map((u) => (u.name === file.name ? { ...u, docId: documentId, status: "processing" } : u)),
      );

      const poll = setInterval(() => {
        fetch(`/api/documents/${documentId}`, { credentials: "same-origin" })
          .then((r) => r.json() as Promise<Document>)
          .then((doc) => {
            if (doc.status !== "processing") {
              clearInterval(poll);
              setUploading((prev) =>
                prev.map((u) => (u.docId === documentId ? { ...u, status: doc.status } : u)),
              );
              void queryClient.invalidateQueries({ queryKey: ["data-sources", ds.id] });
              void queryClient.invalidateQueries({ queryKey: ["data-sources"] });
              setTimeout(() => {
                setUploading((prev) => prev.filter((u) => u.docId !== documentId));
              }, 3000);
            }
          })
          .catch(() => clearInterval(poll));
      }, 2000);
    } catch {
      setUploading((prev) =>
        prev.map((u) => (u.name === file.name ? { ...u, status: "failed", error: "Upload failed" } : u)),
      );
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      void uploadFile(file);
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback(() => setDragging(false), []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div>
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 mb-3"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Data Sources
          </button>

          {editing ? (
            <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5 space-y-4 bg-slate-50 dark:bg-gray-900">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Edit Data Source</h2>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Name (e.g., HR Policies, Engineering Docs)"
                className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100"
                autoFocus
              />
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 resize-none bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100"
              />

              {/* Source Type (only in org mode, only for owner/admin) */}
              {user?.authMode !== "none" && (user?.isAdmin || ds.ownerId.toLowerCase() === (user?.email ?? "").toLowerCase()) && (
                <div className="space-y-1.5">
                  <SourceTypeSelector
                    value={editType}
                    onChange={(t) => {
                      if (t === "organization" && ds.type === "personal") setShowTypeWarning(true);
                      setEditType(t);
                    }}
                    compact
                  />
                  {/* Migration warning: vault → org */}
                  {showTypeWarning && editType === "organization" && ds.type === "personal" && (
                    <div className="flex items-start gap-2 p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="text-xs text-amber-700 dark:text-amber-300">
                        <p className="font-medium">Moving to Network Source</p>
                        <p className="mt-0.5">This source's data will be moved from your encrypted vault to the organization server. All org members with access will be able to query it.</p>
                      </div>
                    </div>
                  )}
                  {editType === "personal" && ds.type === "organization" && (
                    <p className="text-xs text-slate-500 dark:text-gray-400 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" />
                      Data will be moved to your encrypted vault. Other users will lose access.
                    </p>
                  )}
                </div>
              )}

              {/* Access — only for organization sources */}
              {editType === "organization" && <div className="space-y-3 pt-1">
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-slate-500 dark:text-gray-400">Access</label>
                  <div className="relative inline-block">
                    <select
                      value={currentAccessMode}
                      onChange={(e) => changeAccessMode(e.target.value)}
                      disabled={updateMutation.isPending}
                      className="appearance-none bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-lg px-3 py-1.5 pr-8 text-sm text-slate-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600"
                    >
                      <option value="all">Whole organization</option>
                      <option value="restricted">Restricted by user</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-gray-500" />
                  </div>
                  {updateMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 dark:text-gray-500" />}
                </div>

                {currentAccessMode === "restricted" && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500 dark:text-gray-400">
                      Only these users can search this source. Admins always have access.
                    </p>
                    <div className="relative">
                      <div className="flex gap-2">
                        <input
                          type="email"
                          value={accessEmail}
                          onChange={(e) => { setAccessEmail(e.target.value); setShowSuggestions(true); }}
                          onFocus={() => setShowSuggestions(true)}
                          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAccessEmail(); } }}
                          placeholder="user@example.com"
                          className="flex-1 px-3 py-1.5 text-sm border border-slate-200 dark:border-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100"
                        />
                        <button
                          onClick={() => addAccessEmail()}
                          disabled={!accessEmail.trim() || updateMutation.isPending}
                          className="px-3 py-1.5 text-sm bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Add
                        </button>
                      </div>
                      {showSuggestions && emailSuggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-12 mt-1 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-lg shadow-lg z-10 overflow-hidden">
                          {emailSuggestions.map((m) => (
                            <button
                              key={m.email}
                              onMouseDown={(e) => { e.preventDefault(); addAccessEmail(m.email); }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-gray-900 flex items-center gap-2"
                            >
                              <span className="text-slate-800 dark:text-gray-200">{m.email}</span>
                              {m.name && <span className="text-xs text-slate-400 dark:text-gray-500">{m.name}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {currentAccessList.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {currentAccessList.map((email) => (
                          <span
                            key={email}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-md text-xs text-slate-700 dark:text-gray-300"
                          >
                            {email}
                            <button
                              onClick={() => removeAccessEmail(email)}
                              className="text-slate-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {currentAccessList.length === 0 && (
                      <p className="text-xs text-slate-400 dark:text-gray-500">No users added yet. Only admins can access this data source.</p>
                    )}
                  </div>
                )}
              </div>}

              {/* Security toggles — only for organization sources */}
              {user?.isAdmin && editType === "organization" && (
                <div className="space-y-3 pt-1 border-t border-slate-200 dark:border-gray-800">
                  <label className="text-xs font-medium text-slate-500 dark:text-gray-400 pt-3 block">Security</label>
                  <SecurityToggle
                    label="Allow source document viewing"
                    description="Members can view raw document text via the source viewer. Turn off for sensitive procedural docs."
                    checked={data?.allowSourceViewing ?? ds.allowSourceViewing ?? true}
                    onChange={(v) => updateMutation.mutate({ allowSourceViewing: v })}
                    disabled={updateMutation.isPending}
                  />
                  <SecurityToggle
                    label="Allow device sync (Vault Mode)"
                    description="This data source's chunks can be synced to member devices. Turn off for compensation, legal, or investigation docs."
                    checked={data?.allowVaultSync ?? ds.allowVaultSync ?? true}
                    onChange={(v) => updateMutation.mutate({ allowVaultSync: v })}
                    disabled={updateMutation.isPending}
                  />
                  <SecurityToggle
                    label="Allow external network access"
                    description="Members can access this data source from outside the local network. Turn off for on-premises-only data."
                    checked={data?.allowExternalAccess ?? ds.allowExternalAccess ?? true}
                    onChange={(v) => updateMutation.mutate({ allowExternalAccess: v })}
                    disabled={updateMutation.isPending}
                  />
                  {(data?.allowExternalAccess ?? ds.allowExternalAccess ?? true) && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1.5 pl-1 mt-1">
                      <Network className="w-3 h-3 flex-shrink-0" />
                      For stronger data isolation, consider enabling Mesh Networking to keep sensitive sources on a separate internal node.
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setEditing(false); setEditName(data?.name ?? ds.name); setEditDesc(data?.description ?? ds.description ?? ""); setEditType(ds.type as "organization" | "personal"); setShowTypeWarning(false); }}
                  className="px-3 py-1.5 text-sm text-slate-600 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => updateMutation.mutateAsync({
                    name: editName,
                    description: editDesc,
                    ...(editType !== ds.type && { type: editType }),
                  }).then(() => { setEditing(false); setShowTypeWarning(false); })}
                  disabled={!editName.trim() || updateMutation.isPending}
                  className="px-4 py-1.5 text-sm bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-xl hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {updateMutation.isPending ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              {(user?.isAdmin || user?.canCreateDataSources) && (
                <AvatarUpload
                  avatarUrl={data?.avatarUrl ?? ds.avatarUrl}
                  onUpload={async (file) => {
                    const form = new FormData();
                    form.append("avatar", file);
                    const res = await fetch(`/api/data-sources/${ds.id}/avatar`, {
                      method: "POST",
                      credentials: "same-origin",
                      body: form,
                    });
                    if (!res.ok) throw new Error("Upload failed");
                    const result = await res.json() as { avatarUrl: string };
                    void queryClient.invalidateQueries({ queryKey: ["data-sources", ds.id] });
                    void queryClient.invalidateQueries({ queryKey: ["data-sources"] });
                    return result.avatarUrl;
                  }}
                  onRemove={async () => {
                    await fetch(`/api/data-sources/${ds.id}/avatar`, { method: "DELETE", credentials: "same-origin" });
                    void queryClient.invalidateQueries({ queryKey: ["data-sources", ds.id] });
                    void queryClient.invalidateQueries({ queryKey: ["data-sources"] });
                  }}
                  size={52}
                  fallbackText={(data?.name ?? ds.name).slice(0, 2)}
                />
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold text-slate-900 dark:text-gray-100">{data?.name ?? ds.name}</h1>
                  {ds.type === "personal" && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400">
                      <Lock className="w-3 h-3" />
                      Vault
                    </span>
                  )}
                  {data?.rebuilding && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      Syncing
                    </span>
                  )}
                </div>
                {(data?.description ?? ds.description) && (
                  <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">{data?.description ?? ds.description}</p>
                )}
                {/* Read-only access indicator for non-editors */}
                {!canEdit && (
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-400 dark:text-gray-500">
                    {currentAccessMode === "all" ? (
                      <><Globe className="w-3.5 h-3.5" /> Shared with whole organization</>
                    ) : (
                      <><Lock className="w-3.5 h-3.5" /> Restricted access</>
                    )}
                  </div>
                )}
              </div>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setEditing(true); setEditName(data?.name ?? ds.name); setEditDesc(data?.description ?? ds.description ?? ""); }}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 border border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-600 rounded-lg px-3 py-1.5 transition-colors"
                    title="Edit"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteKBConfirm(true)}
                    className="p-2 text-slate-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg transition-colors"
                    title="Delete data source"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Delete data source confirmation */}
          {canEdit && deleteDSConfirm && (
            <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 rounded-xl p-4 flex items-center gap-3 mt-4">
              <AlertTriangle className="w-5 h-5 text-red-500 dark:text-red-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800 dark:text-red-200">Delete "{data?.name ?? ds.name}"?</p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">This will permanently delete this source and all its files.</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setDeleteKBConfirm(false)}
                  className="px-3 py-1.5 text-sm text-slate-600 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteDSMutation.mutate()}
                  disabled={deleteDSMutation.isPending}
                  className="px-3 py-1.5 text-sm bg-red-600 dark:bg-red-500 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-600 disabled:opacity-50"
                >
                  {deleteDSMutation.isPending ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Rebuild in progress banner */}
        {data?.rebuilding && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900">
            <RefreshCw className="w-4 h-4 text-blue-500 dark:text-blue-400 animate-spin flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Index syncing</p>
              <p className="text-xs text-blue-600 dark:text-blue-400">Search results may be temporarily incomplete while the index rebuilds.</p>
            </div>
          </div>
        )}

        {/* Upload zone — editors only */}
        {canEdit && <div
          className={cn(
            "border-2 border-dashed rounded-2xl p-8 text-center transition-colors cursor-pointer",
            dragging ? "border-slate-400 dark:border-gray-500 bg-slate-50 dark:bg-gray-900" : "border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-600 hover:bg-slate-50 dark:hover:bg-gray-900",
          )}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-8 h-8 text-slate-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-600 dark:text-gray-400">
            Drop files here or <span className="text-slate-900 dark:text-gray-100 underline">browse</span>
          </p>
          <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">PDF, DOCX, TXT, MD -- max 50MB</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>}

        {/* Upload progress */}
        {uploading.length > 0 && (
          <div className="space-y-2">
            {uploading.map((u, i) => (
              <div key={i} className="flex items-center gap-3 bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-xl px-4 py-3">
                <FileText className="w-4 h-4 text-slate-400 dark:text-gray-500 flex-shrink-0" />
                <span className="text-sm text-slate-700 dark:text-gray-300 flex-1 truncate">{u.name}</span>
                {u.status === "uploading" && <Loader2 className="w-4 h-4 text-slate-400 dark:text-gray-500 animate-spin" />}
                {u.status === "processing" && (
                  <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Extracting
                  </span>
                )}
                {u.status === "ready" && <CheckCircle className="w-4 h-4 text-green-500" />}
                {u.status === "failed" && (
                  <span className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> {u.error ?? "Failed"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* File list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 dark:text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading files...
          </div>
        ) : docs.length === 0 && uploading.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="w-10 h-10 text-slate-200 dark:text-gray-700 mx-auto mb-3" />
            <p className="text-sm text-slate-500 dark:text-gray-400">No files in this source.</p>
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">Drop files above to get started.</p>
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-gray-900 border-b border-slate-200 dark:border-gray-800">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wide hidden sm:table-cell">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                {docs.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50 dark:hover:bg-gray-900 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            if (doc.status === "ready") {
                              setViewingDoc({ id: doc.id, name: doc.name });
                            } else {
                              // For non-ready docs, open the raw file in a new tab
                              window.open(`/api/documents/${doc.id}/file`, "_blank");
                            }
                          }}
                          className="font-medium truncate block max-w-xs text-left text-slate-800 dark:text-gray-200 hover:text-slate-900 dark:hover:text-gray-100 hover:underline cursor-pointer"
                          title={doc.status === "ready" ? "View file content" : "Download original file"}
                        >
                          {doc.name}
                        </button>
                        {doc.isStale && (
                          <span className="relative group/stale flex-shrink-0">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 text-[11px] leading-tight text-white dark:text-gray-100 bg-slate-800 dark:bg-gray-700 rounded-lg shadow-lg whitespace-nowrap opacity-0 pointer-events-none group-hover/stale:opacity-100 transition-opacity z-10">
                              File may be outdated
                            </span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="uppercase text-xs font-medium text-slate-500 dark:text-gray-400">{doc.type}</span>
                    </td>
                    <td className="px-4 py-3">
                      {doc.status === "pii_review" && doc.piiWarnings && doc.piiWarnings.length > 0 ? (
                        <PIIReasonTooltip warnings={doc.piiWarnings} />
                      ) : (
                        <StatusBadge status={doc.status} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canEdit && doc.status === "pii_review" ? (
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={async () => {
                              await fetch(`/api/documents/${doc.id}/approve-pii`, { method: "POST", credentials: "same-origin" });
                              void queryClient.invalidateQueries({ queryKey: ["data-sources", ds.id] });
                            }}
                            className="text-slate-300 dark:text-gray-600 hover:text-green-600 dark:hover:text-green-400 transition-colors p-1"
                            title="Approve file"
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                          <button
                            onClick={async () => {
                              await fetch(`/api/documents/${doc.id}/reject-pii`, { method: "POST", credentials: "same-origin" });
                              void queryClient.invalidateQueries({ queryKey: ["data-sources", ds.id] });
                            }}
                            className="text-slate-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors p-1"
                            title="Reject file"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      ) : canEdit && (deleteConfirm === doc.id ? (
                        <div className="flex items-center gap-2 justify-end">
                          <span className="text-xs text-slate-500 dark:text-gray-400">Delete?</span>
                          <button
                            onClick={() => deleteMutation.mutate(doc.id)}
                            disabled={deleteMutation.isPending}
                            className="text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(doc.id)}
                          className="text-slate-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors p-1"
                          title="Delete file"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* File viewer panel */}
      {viewingDoc && (
        <SourcePanel
          documentId={viewingDoc.id}
          documentName={viewingDoc.name}
          sectionPath={[]}
          pageNumber={0}
          onClose={() => setViewingDoc(null)}
        />
      )}
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export function DataSourcePanel() {
  const [selectedDS, setSelectedDS] = useState<DataSource | null>(null);

  if (selectedDS) {
    return <DSDetailView ds={selectedDS} onBack={() => setSelectedDS(null)} />;
  }
  return <DSListView onSelect={setSelectedDS} />;
}
