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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/contexts/UserContext";
import type { Document, KnowledgeBase } from "@edgebric/types";

/** Format an email into a display name: "john.doe@co.com" → "John D." */
function emailToDisplayName(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.replace(/[._]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return email;
  const first = parts[0]!;
  const firstCap = first.charAt(0).toUpperCase() + first.slice(1);
  if (parts.length === 1) return firstCap;
  return `${firstCap} ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.`;
}

type KBFilter = "all" | "mine";

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Document["status"] }) {
  const config: Record<string, { bg: string; dot: string; label: string }> = {
    ready: { bg: "bg-green-50 text-green-700", dot: "bg-green-500", label: "Ready" },
    processing: { bg: "bg-amber-50 text-amber-700", dot: "bg-amber-500 animate-pulse", label: "Processing" },
    failed: { bg: "bg-red-50 text-red-700", dot: "bg-red-500", label: "Failed" },
    pii_review: { bg: "bg-orange-50 text-orange-700", dot: "bg-orange-500", label: "PII Review" },
    rejected: { bg: "bg-red-50 text-red-600", dot: "bg-red-400", label: "Rejected" },
  };
  const c = config[status] ?? config.failed!;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium", c.bg)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", c.dot)} />
      {c.label}
    </span>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface UploadingFile {
  name: string;
  docId?: string;
  status: "uploading" | "processing" | "ready" | "failed" | "pii_review" | "rejected";
  error?: string;
}

interface KBDetailResponse extends KnowledgeBase {
  documents: (Document & { isStale?: boolean })[];
  accessList?: string[];
}

// ─── KB List View ────────────────────────────────────────────────────────────

function KBListView({ onSelect }: { onSelect: (kb: KnowledgeBase) => void }) {
  const user = useUser();
  const canCreate = user?.canCreateKBs ?? user?.isAdmin ?? false;
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<KBFilter>("all");

  const { data: kbs = [], isLoading } = useQuery<KnowledgeBase[]>({
    queryKey: ["knowledge-bases"],
    queryFn: () =>
      fetch("/api/knowledge-bases", { credentials: "same-origin" }).then((r) => r.json() as Promise<KnowledgeBase[]>),
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      fetch("/api/knowledge-bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to create KB");
        return r.json() as Promise<KnowledgeBase>;
      }),
    onSuccess: (kb) => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      setShowCreate(false);
      setName("");
      setDescription("");
      onSelect(kb);
    },
  });

  const myEmail = user?.email?.toLowerCase() ?? "";
  const myKBCount = kbs.filter((kb) => kb.ownerId.toLowerCase() === myEmail).length;

  const filteredKBs = useMemo(() => {
    let list = kbs;
    // Filter by ownership
    if (filter === "mine") {
      list = list.filter((kb) => kb.ownerId.toLowerCase() === myEmail);
    }
    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (kb) =>
          kb.name.toLowerCase().includes(q) ||
          kb.description?.toLowerCase().includes(q) ||
          emailToDisplayName(kb.ownerId).toLowerCase().includes(q),
      );
    }
    // Sort: user's KBs first, then by name
    return list.sort((a, b) => {
      const aIsMine = a.ownerId.toLowerCase() === myEmail ? 0 : 1;
      const bIsMine = b.ownerId.toLowerCase() === myEmail ? 0 : 1;
      if (aIsMine !== bIsMine) return aIsMine - bIsMine;
      return a.name.localeCompare(b.name);
    });
  }, [kbs, filter, search, myEmail]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Library</h1>
            <p className="text-sm text-slate-500 mt-1">
              {kbs.length} knowledge base{kbs.length !== 1 ? "s" : ""} in your organization
            </p>
          </div>
          {canCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 transition-colors"
            >
              <Plus className="w-4 h-4" /> New KB
            </button>
          )}
        </div>

        {/* Create KB form */}
        {showCreate && (
          <div className="border border-slate-200 rounded-2xl p-5 space-y-4 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-900">Create Knowledge Base</h2>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (e.g., HR Policies, Engineering Docs)"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowCreate(false); setName(""); setDescription(""); }}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={() => createMutation.mutate({ name, ...(description && { description }) })}
                disabled={!name.trim() || createMutation.isPending}
                className="px-4 py-1.5 text-sm bg-slate-900 text-white rounded-xl hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createMutation.isPending ? "Creating..." : "Create"}
              </button>
            </div>
            {createMutation.isError && (
              <p className="text-xs text-red-600">You do not have permission to create knowledge bases. Ask an admin to grant access.</p>
            )}
          </div>
        )}

        {/* Search + filter bar */}
        {kbs.length > 0 && (
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search knowledge bases..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter tabs */}
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setFilter("all")}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  filter === "all"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700",
                )}
              >
                All ({kbs.length})
              </button>
              <button
                onClick={() => setFilter("mine")}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  filter === "mine"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700",
                )}
              >
                Created by me ({myKBCount})
              </button>
            </div>
          </div>
        )}

        {/* KB grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
          </div>
        ) : kbs.length === 0 ? (
          <div className="text-center py-16">
            <Database className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No knowledge bases yet.</p>
            <p className="text-xs text-slate-400 mt-1">Create one to start uploading documents.</p>
          </div>
        ) : filteredKBs.length === 0 ? (
          <div className="text-center py-12">
            <Search className="w-8 h-8 text-slate-200 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No matching knowledge bases.</p>
            <button onClick={() => { setSearch(""); setFilter("all"); }} className="text-xs text-blue-600 hover:underline mt-1">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredKBs.map((kb) => {
              const isMine = kb.ownerId.toLowerCase() === myEmail;
              return (
                <button
                  key={kb.id}
                  onClick={() => onSelect(kb)}
                  className="text-left border border-slate-200 rounded-2xl p-5 hover:border-slate-300 hover:bg-slate-50 transition-colors group"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className={cn(
                      "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0",
                      isMine ? "bg-blue-50" : "bg-slate-100",
                    )}>
                      <Database className={cn("w-4 h-4", isMine ? "text-blue-500" : "text-slate-500")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-slate-900 truncate">{kb.name}</h3>
                      <p className="text-xs text-slate-400">
                        {kb.documentCount} document{kb.documentCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  {kb.description && (
                    <p className="text-xs text-slate-500 line-clamp-2 mb-3">{kb.description}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full",
                        kb.accessMode === "restricted"
                          ? "bg-green-50 text-green-600"
                          : "bg-amber-50 text-amber-600",
                      )}
                    >
                      {kb.accessMode === "restricted" ? (
                        <><Lock className="w-3 h-3" /> Restricted</>
                      ) : (
                        <><Globe className="w-3 h-3" /> Whole org</>
                      )}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {isMine ? "You" : emailToDisplayName(kb.ownerId)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── KB Detail View ──────────────────────────────────────────────────────────

interface OrgMember {
  email: string;
  name?: string;
  role?: string;
}

function KBDetailView({ kb, onBack }: { kb: KnowledgeBase; onBack: () => void }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteKBConfirm, setDeleteKBConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(kb.name);
  const [editDesc, setEditDesc] = useState(kb.description ?? "");
  const [accessEmail, setAccessEmail] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const { data, isLoading } = useQuery<KBDetailResponse>({
    queryKey: ["knowledge-bases", kb.id],
    queryFn: () =>
      fetch(`/api/knowledge-bases/${kb.id}`, { credentials: "same-origin" }).then(
        (r) => r.json() as Promise<KBDetailResponse>,
      ),
    refetchInterval: uploading.some((u) => u.status === "processing") ? 2000 : false,
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

  const deleteKBMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/knowledge-bases/${kb.id}`, { method: "DELETE", credentials: "same-origin" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      onBack();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) =>
      fetch(`/api/documents/${docId}`, { method: "DELETE", credentials: "same-origin" }),
    onSuccess: () => {
      setDeleteConfirm(null);
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases", kb.id] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (body: { name?: string; description?: string; accessMode?: string; accessList?: string[] }) =>
      fetch(`/api/knowledge-bases/${kb.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases", kb.id] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
    },
  });

  const currentAccessMode = data?.accessMode ?? kb.accessMode ?? "all";
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
      const res = await fetch(`/api/knowledge-bases/${kb.id}/documents/upload`, {
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
              void queryClient.invalidateQueries({ queryKey: ["knowledge-bases", kb.id] });
              void queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
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
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-3"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Library
          </button>

          {editing ? (
            <div className="space-y-3">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full text-xl font-semibold text-slate-900 px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
              />

              {/* Access mode dropdown inside edit */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Access</label>
                <div className="relative inline-block">
                  <select
                    value={currentAccessMode}
                    onChange={(e) => changeAccessMode(e.target.value)}
                    disabled={updateMutation.isPending}
                    className="appearance-none bg-white border border-slate-200 rounded-lg px-3 py-1.5 pr-8 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  >
                    <option value="all">Whole organization</option>
                    <option value="restricted">Restricted by user</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                </div>
              </div>

              {/* Restricted email list inside edit */}
              {currentAccessMode === "restricted" && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">
                    Only these users can search this knowledge base. Admins always have access.
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
                        className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
                      />
                      <button
                        onClick={() => addAccessEmail()}
                        disabled={!accessEmail.trim() || updateMutation.isPending}
                        className="px-3 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Add
                      </button>
                    </div>
                    {showSuggestions && emailSuggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-12 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 overflow-hidden">
                        {emailSuggestions.map((m) => (
                          <button
                            key={m.email}
                            onMouseDown={(e) => { e.preventDefault(); addAccessEmail(m.email); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"
                          >
                            <span className="text-slate-800">{m.email}</span>
                            {m.name && <span className="text-xs text-slate-400">{m.name}</span>}
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
                          className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 rounded-md text-xs text-slate-700"
                        >
                          {email}
                          <button
                            onClick={() => removeAccessEmail(email)}
                            className="text-slate-400 hover:text-red-500 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {currentAccessList.length === 0 && (
                    <p className="text-xs text-slate-400">No users added yet. Only admins can access this KB.</p>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => updateMutation.mutateAsync({ name: editName, description: editDesc }).then(() => setEditing(false))}
                  disabled={!editName.trim() || updateMutation.isPending}
                  className="px-3 py-1.5 text-sm bg-slate-900 text-white rounded-xl hover:bg-slate-800 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => { setEditing(false); setEditName(kb.name); setEditDesc(kb.description ?? ""); }}
                  className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold text-slate-900">{data?.name ?? kb.name}</h1>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full",
                      currentAccessMode === "restricted"
                        ? "bg-green-50 text-green-600"
                        : "bg-amber-50 text-amber-600",
                    )}
                  >
                    {currentAccessMode === "restricted" ? (
                      <><Lock className="w-3 h-3" /> Restricted by user</>
                    ) : (
                      <><Globe className="w-3 h-3" /> Whole org</>
                    )}
                  </span>
                </div>
                {(data?.description ?? kb.description) && (
                  <p className="text-sm text-slate-500 mt-1">{data?.description ?? kb.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-1.5 transition-colors"
                  title="Edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </button>
                <button
                  onClick={() => setDeleteKBConfirm(true)}
                  className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="Delete knowledge base"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Delete KB confirmation */}
          {deleteKBConfirm && (
            <div className="border border-red-200 bg-red-50 rounded-xl p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800">Delete "{data?.name ?? kb.name}"?</p>
                <p className="text-xs text-red-600 mt-0.5">This will permanently delete this knowledge base and all its documents.</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setDeleteKBConfirm(false)}
                  className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteKBMutation.mutate()}
                  disabled={deleteKBMutation.isPending}
                  className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteKBMutation.isPending ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Upload zone */}
        <div
          className={cn(
            "border-2 border-dashed rounded-2xl p-8 text-center transition-colors cursor-pointer",
            dragging ? "border-slate-400 bg-slate-50" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
          )}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-600">
            Drop files here or <span className="text-slate-900 underline">browse</span>
          </p>
          <p className="text-xs text-slate-400 mt-1">PDF, DOCX, TXT, MD -- max 50MB</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {/* Upload progress */}
        {uploading.length > 0 && (
          <div className="space-y-2">
            {uploading.map((u, i) => (
              <div key={i} className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <span className="text-sm text-slate-700 flex-1 truncate">{u.name}</span>
                {u.status === "uploading" && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
                {u.status === "processing" && (
                  <span className="text-xs text-amber-600 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Extracting
                  </span>
                )}
                {u.status === "ready" && <CheckCircle className="w-4 h-4 text-green-500" />}
                {u.status === "failed" && (
                  <span className="text-xs text-red-600 flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> {u.error ?? "Failed"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Document list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading documents...
          </div>
        ) : docs.length === 0 && uploading.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No documents in this knowledge base.</p>
            <p className="text-xs text-slate-400 mt-1">Drop files above to get started.</p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide hidden sm:table-cell">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {docs.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 truncate block max-w-xs">{doc.name}</span>
                        {doc.isStale && (
                          <span title="Document may be outdated" className="flex-shrink-0">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="uppercase text-xs font-medium text-slate-500">{doc.type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={doc.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {deleteConfirm === doc.id ? (
                        <div className="flex items-center gap-2 justify-end">
                          <span className="text-xs text-slate-500">Delete?</span>
                          <button
                            onClick={() => deleteMutation.mutate(doc.id)}
                            disabled={deleteMutation.isPending}
                            className="text-xs text-red-600 hover:text-red-800 font-medium"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-xs text-slate-500 hover:text-slate-700"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(doc.id)}
                          className="text-slate-300 hover:text-red-500 transition-colors p-1"
                          title="Delete document"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export function KnowledgeBasePanel() {
  const [selectedKB, setSelectedKB] = useState<KnowledgeBase | null>(null);

  if (selectedKB) {
    return <KBDetailView kb={selectedKB} onBack={() => setSelectedKB(null)} />;
  }
  return <KBListView onSelect={setSelectedKB} />;
}
