import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Key, Plus, Trash2, Copy, Check, AlertTriangle, Loader2, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ApiKeyInfo {
  id: string;
  name: string;
  permission: "read" | "read-write" | "admin";
  sourceScope: string;
  rateLimit: number;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

interface CreateKeyResponse extends ApiKeyInfo {
  rawKey: string;
}

const PERMISSION_LABELS: Record<string, string> = {
  read: "Read only",
  "read-write": "Read & Write",
  admin: "Admin",
};

const PERMISSION_COLORS: Record<string, string> = {
  read: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "read-write": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  admin: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

interface SourceInfo {
  id: string;
  name: string;
}

export function ApiKeysTab() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyPerm, setNewKeyPerm] = useState<"read" | "read-write" | "admin">("read");
  const [newKeyScopeMode, setNewKeyScopeMode] = useState<"all" | "selected">("all");
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyInfo | null>(null);

  const { data: keys = [], isLoading } = useQuery<ApiKeyInfo[]>({
    queryKey: ["admin", "api-keys"],
    queryFn: () =>
      fetch("/api/admin/api-keys", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ApiKeyInfo[]>;
      }),
  });

  const { data: sources = [] } = useQuery<SourceInfo[]>({
    queryKey: ["data-sources"],
    queryFn: () =>
      fetch("/api/data-sources", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) return [] as SourceInfo[];
        return r.json() as Promise<SourceInfo[]>;
      }),
  });

  const createMutation = useMutation({
    mutationFn: async (body: { name: string; permission: string; sourceScope: string | string[] }) => {
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Failed to create key");
      }
      return res.json() as Promise<CreateKeyResponse>;
    },
    onSuccess: (data) => {
      setCreatedKey(data.rawKey);
      setNewKeyName("");
      setNewKeyScopeMode("all");
      setSelectedSourceIds(new Set());
      void queryClient.invalidateQueries({ queryKey: ["admin", "api-keys"] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/api-keys/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Failed to revoke");
    },
    onSuccess: () => {
      setRevokeTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "api-keys"] });
    },
  });

  async function copyKey(key: string) {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const activeKeys = keys.filter((k) => !k.revoked);
  const revokedKeys = keys.filter((k) => k.revoked);

  return (
    <div className="space-y-6">
      {/* Header + create button */}
      <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-slate-500 dark:text-gray-400" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">API Keys</h3>
          </div>
          {!showCreate && !createdKey && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-slate-800 dark:hover:bg-gray-200 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Create key
            </button>
          )}
        </div>

        <p className="text-xs text-slate-400 dark:text-gray-500">
          API keys allow AI agents and integrations to access your Edgebric instance programmatically.
        </p>

        {/* Create key form */}
        {showCreate && !createdKey && (
          <div className="border border-slate-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">Key name</label>
              <input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. Claude agent, OpenClaw skill"
                autoFocus
                className="w-full px-3 py-1.5 text-sm border border-slate-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">Permission</label>
              <select
                value={newKeyPerm}
                onChange={(e) => setNewKeyPerm(e.target.value as typeof newKeyPerm)}
                className="w-full px-3 py-1.5 text-sm border border-slate-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600"
              >
                <option value="read">Read only -- search and query</option>
                <option value="read-write">Read & Write -- search, query, upload, delete documents</option>
                <option value="admin">Admin -- full access including source management</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">Source access</label>
              <div className="flex gap-3 mb-2">
                <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="radio" name="scopeMode" value="all"
                    checked={newKeyScopeMode === "all"}
                    onChange={() => setNewKeyScopeMode("all")}
                    className="accent-slate-900 dark:accent-gray-100"
                  />
                  All sources
                </label>
                <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="radio" name="scopeMode" value="selected"
                    checked={newKeyScopeMode === "selected"}
                    onChange={() => setNewKeyScopeMode("selected")}
                    className="accent-slate-900 dark:accent-gray-100"
                  />
                  Specific sources
                </label>
              </div>
              {newKeyScopeMode === "selected" && (
                <div className="border border-slate-200 dark:border-gray-800 rounded-lg max-h-40 overflow-y-auto">
                  {sources.length === 0 ? (
                    <p className="text-xs text-slate-400 dark:text-gray-500 p-3">No data sources available.</p>
                  ) : (
                    sources.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-gray-800/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedSourceIds.has(s.id)}
                          onChange={(e) => {
                            const next = new Set(selectedSourceIds);
                            if (e.target.checked) next.add(s.id);
                            else next.delete(s.id);
                            setSelectedSourceIds(next);
                          }}
                          className="accent-slate-900 dark:accent-gray-100"
                        />
                        <span className="text-xs text-slate-700 dark:text-gray-300 truncate">{s.name}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Security warning */}
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                This key gives <strong>{PERMISSION_LABELS[newKeyPerm]?.toLowerCase()}</strong> access to{" "}
                <strong>{newKeyScopeMode === "all" ? "all sources" : `${selectedSourceIds.size} selected source${selectedSourceIds.size !== 1 ? "s" : ""}`}</strong>.
                Any application with this key can access this data. Edgebric is not responsible for how third-party applications use your data.
              </p>
            </div>

            {createMutation.isError && (
              <p className="text-xs text-red-600 dark:text-red-400">{createMutation.error.message}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => {
                  const scope = newKeyScopeMode === "all" ? "all" : [...selectedSourceIds];
                  createMutation.mutate({ name: newKeyName.trim(), permission: newKeyPerm, sourceScope: scope });
                }}
                disabled={!newKeyName.trim() || createMutation.isPending || (newKeyScopeMode === "selected" && selectedSourceIds.size === 0)}
                className="px-3 py-1.5 text-sm bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50"
              >
                {createMutation.isPending ? "Creating..." : "Create key"}
              </button>
              <button
                onClick={() => { setShowCreate(false); setNewKeyName(""); }}
                className="px-3 py-1.5 text-sm text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Show created key (once) */}
        {createdKey && (
          <div className="border border-green-200 dark:border-green-800/30 bg-green-50 dark:bg-green-900/10 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
              <p className="text-sm font-medium text-green-700 dark:text-green-400">API key created</p>
            </div>
            <p className="text-xs text-green-600 dark:text-green-400">
              Copy this key now. You won't be able to see it again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-white dark:bg-gray-900 border border-green-200 dark:border-green-800/30 rounded px-3 py-2 text-slate-900 dark:text-gray-100 select-all break-all">
                {createdKey}
              </code>
              <button
                onClick={() => void copyKey(createdKey)}
                className="flex items-center gap-1 px-3 py-2 text-sm border border-green-200 dark:border-green-800/30 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/20 transition-colors text-green-700 dark:text-green-400"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button
              onClick={() => { setCreatedKey(null); setShowCreate(false); }}
              className="text-xs text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300"
            >
              Done
            </button>
          </div>
        )}
      </div>

      {/* Active keys list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400 dark:text-gray-500" />
        </div>
      ) : activeKeys.length === 0 && !showCreate && !createdKey ? (
        <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-8 text-center space-y-2">
          <Key className="w-8 h-8 text-slate-300 dark:text-gray-600 mx-auto" />
          <p className="text-sm text-slate-500 dark:text-gray-400">No API keys yet</p>
          <p className="text-xs text-slate-400 dark:text-gray-500">
            Create an API key to allow AI agents and integrations to access your knowledge base.
          </p>
        </div>
      ) : activeKeys.length > 0 ? (
        <div className="border border-slate-200 dark:border-gray-800 rounded-2xl divide-y divide-slate-100 dark:divide-gray-800">
          {activeKeys.map((key) => (
            <div key={key.id} className="px-5 py-3 flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-900 dark:text-gray-100 truncate">{key.name}</p>
                  <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", PERMISSION_COLORS[key.permission])}>
                    {PERMISSION_LABELS[key.permission]}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-0.5">
                  Created {new Date(key.createdAt).toLocaleDateString()}
                  {key.lastUsedAt && <> &middot; Last used {new Date(key.lastUsedAt).toLocaleDateString()}</>}
                  {key.sourceScope !== "all" && <> &middot; Scoped to {(() => { try { return (JSON.parse(key.sourceScope) as string[]).length; } catch { return "?"; } })()} sources</>}
                </p>
              </div>
              <button
                onClick={() => setRevokeTarget(key)}
                className="flex items-center gap-1 text-xs text-slate-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Revoke
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Revoked keys (collapsed) */}
      {revokedKeys.length > 0 && (
        <details className="group">
          <summary className="text-xs text-slate-400 dark:text-gray-500 cursor-pointer hover:text-slate-600 dark:hover:text-gray-400">
            {revokedKeys.length} revoked {revokedKeys.length === 1 ? "key" : "keys"}
          </summary>
          <div className="mt-2 border border-slate-100 dark:border-gray-800 rounded-xl divide-y divide-slate-50 dark:divide-gray-800 opacity-60">
            {revokedKeys.map((key) => (
              <div key={key.id} className="px-4 py-2 flex items-center gap-3">
                <p className="text-xs text-slate-500 dark:text-gray-400 line-through truncate flex-1">{key.name}</p>
                <span className="text-[10px] text-slate-400 dark:text-gray-500">Revoked</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Revoke confirmation modal */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 max-w-sm w-full mx-4 space-y-4 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Revoke API key</h3>
            <p className="text-xs text-slate-500 dark:text-gray-400">
              Are you sure you want to revoke <strong>{revokeTarget.name}</strong>? Any agents or integrations using this key will immediately lose access.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRevokeTarget(null)}
                className="px-3 py-1.5 text-sm text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={() => revokeMutation.mutate(revokeTarget.id)}
                disabled={revokeMutation.isPending}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {revokeMutation.isPending ? "Revoking..." : "Revoke key"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
