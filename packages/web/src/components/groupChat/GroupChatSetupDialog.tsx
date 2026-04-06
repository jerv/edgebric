import { useState, useRef, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Search, UserPlus, Users, ChevronDown, Database, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DataSource, GroupChat } from "@edgebric/types";

interface SearchResult {
  email: string;
  name: string | null;
  picture: string | null;
}

interface Props {
  /** If set, this is a convert-from-solo-chat flow. */
  convertFromConversationId?: string;
  /** Prefilled chat name (e.g. from solo chat title). */
  defaultName?: string;
  onClose: () => void;
}

type ExpirationMode = "never" | "expires";

export function GroupChatSetupDialog({ convertFromConversationId, defaultName, onClose }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isConvert = !!convertFromConversationId;

  // Fields
  const [name, setName] = useState(defaultName ?? "");
  const [expirationMode, setExpirationMode] = useState<ExpirationMode>("never");
  const [expDays, setExpDays] = useState(7);
  const [expHours, setExpHours] = useState(0);

  // Members
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<SearchResult[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const memberInputRef = useRef<HTMLInputElement>(null);

  // Sources
  const [showSources, setShowSources] = useState(false);
  const [selectedDSIds, setSelectedDSIds] = useState<string[]>([]);

  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedEmails = new Set(selectedUsers.map((u) => u.email.toLowerCase()));

  // Fetch data sources for source sharing
  const { data: dataSources } = useQuery<DataSource[]>({
    queryKey: ["data-sources"],
    queryFn: () =>
      fetch("/api/data-sources", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) return [];
        return r.json() as Promise<DataSource[]>;
      }),
  });
  const activeDS = (dataSources ?? []).filter((ds) => ds.status === "active");

  // Member search with debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = memberQuery.trim();
    if (q.length < 2) {
      setMemberResults([]);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/group-chats/members/search?q=${encodeURIComponent(q)}`, {
          credentials: "same-origin",
        });
        if (res.ok) {
          const data = (await res.json()) as SearchResult[];
          setMemberResults(data);
        }
      } catch {
        // non-critical
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [memberQuery]);

  function addUser(user: SearchResult) {
    if (!selectedEmails.has(user.email.toLowerCase())) {
      setSelectedUsers((prev) => [...prev, user]);
    }
    setMemberQuery("");
    setMemberResults([]);
    memberInputRef.current?.focus();
  }

  function removeUser(email: string) {
    setSelectedUsers((prev) => prev.filter((u) => u.email.toLowerCase() !== email.toLowerCase()));
  }

  function toggleDS(id: string) {
    setSelectedDSIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function computeExpiration(): { expiration: string; expiresInMs?: number } {
    if (expirationMode === "never") return { expiration: "never" };
    const ms = (expDays * 24 + expHours) * 60 * 60 * 1000;
    if (ms <= 0) return { expiration: "never" };
    return { expiration: "custom", expiresInMs: ms };
  }

  async function handleSubmit() {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);

    const { expiration, expiresInMs } = computeExpiration();

    try {
      if (isConvert) {
        // Convert solo -> group
        const res = await fetch(`/api/conversations/${convertFromConversationId}/convert-to-group`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            inviteEmails: selectedUsers.map((u) => u.email.toLowerCase()),
            expiration,
            expiresInMs,
            shareDataSourceIds: selectedDSIds.length > 0 ? selectedDSIds : undefined,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Failed" }));
          setError(body.error ?? "Failed to convert to group chat");
          return;
        }

        const data = (await res.json()) as { groupChatId: string };
        void queryClient.invalidateQueries({ queryKey: ["conversations"] });
        void queryClient.invalidateQueries({ queryKey: ["group-chats"] });
        onClose();
        void navigate({ to: "/group-chats/$id", params: { id: data.groupChatId } });
      } else {
        // Create new group chat
        const res = await fetch("/api/group-chats", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            expiration,
            expiresInMs,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Failed" }));
          setError(body.error ?? "Failed to create group chat");
          return;
        }

        const chat = (await res.json()) as GroupChat;

        // Add members
        for (const user of selectedUsers) {
          await fetch(`/api/group-chats/${chat.id}/members`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: user.email.toLowerCase() }),
          }).catch(() => {});
        }

        // Share data sources
        for (const dsId of selectedDSIds) {
          void fetch(`/api/group-chats/${chat.id}/shared-data-sources`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataSourceId: dsId, allowSourceViewing: true }),
          });
        }

        void queryClient.invalidateQueries({ queryKey: ["group-chats"] });
        onClose();
        void navigate({ to: "/group-chats/$id", params: { id: chat.id } });
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  const filteredResults = memberResults.filter(
    (r) => !selectedEmails.has(r.email.toLowerCase()),
  );

  const canSubmit = name.trim() && (isConvert ? selectedUsers.length > 0 : true);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-950 rounded-2xl shadow-xl p-6 max-w-md w-full mx-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-500 dark:text-gray-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-gray-100">
              {isConvert ? "Invite to Chat" : "New Group Chat"}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 -m-1 text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isConvert && (
          <p className="text-xs text-slate-500 dark:text-gray-400 mb-4">
            Adding people will convert this into a group chat. All existing messages will be visible to new members.
          </p>
        )}

        <div className="space-y-4">
          {/* Chat name */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 Benefits Review"
              maxLength={100}
              className="w-full border border-slate-200 dark:border-gray-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-gray-100 bg-white dark:bg-gray-950 placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-gray-600"
              autoFocus={!isConvert}
            />
          </div>

          {/* Members */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">
              Members
              {!isConvert && <span className="font-normal text-slate-400 dark:text-gray-500 ml-1">(optional)</span>}
            </label>

            {/* Selected users as chips */}
            {selectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedUsers.map((user) => (
                  <span
                    key={user.email}
                    className="inline-flex items-center gap-1 bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-300 rounded-full pl-2.5 pr-1.5 py-1 text-xs"
                  >
                    {user.name ?? user.email}
                    <button
                      onClick={() => removeUser(user.email)}
                      className="text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300 p-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Search input */}
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-gray-500" />
                <input
                  ref={memberInputRef}
                  type="text"
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  placeholder="Search by name or email..."
                  className="w-full border border-slate-200 dark:border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-gray-100 bg-white dark:bg-gray-950 placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-gray-600"
                  autoFocus={isConvert}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && filteredResults.length > 0) {
                      addUser(filteredResults[0]!);
                    }
                  }}
                />
              </div>

              {/* Autocomplete dropdown */}
              {filteredResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                  {filteredResults.map((user) => (
                    <button
                      key={user.email}
                      onClick={() => addUser(user)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-gray-900 transition-colors"
                    >
                      {user.picture ? (
                        <img src={user.picture} alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-medium text-slate-500 dark:text-gray-400">
                            {(user.name ?? user.email)[0]?.toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        {user.name && (
                          <p className="text-sm font-medium text-slate-900 dark:text-gray-100 truncate">{user.name}</p>
                        )}
                        <p className={cn("text-xs truncate", user.name ? "text-slate-500 dark:text-gray-400" : "text-sm text-slate-900 dark:text-gray-100")}>
                          {user.email}
                        </p>
                      </div>
                      <UserPlus className="w-3.5 h-3.5 text-slate-300 dark:text-gray-600 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {memberQuery.trim().length >= 2 && filteredResults.length === 0 && !searching && memberResults.length === 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-lg shadow-lg z-10 px-3 py-3">
                  <p className="text-xs text-slate-500 dark:text-gray-400 text-center">
                    No users found matching &ldquo;{memberQuery}&rdquo;.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Expiration */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">Expiration</label>
            <div className="relative inline-block">
              <select
                value={expirationMode}
                onChange={(e) => setExpirationMode(e.target.value as ExpirationMode)}
                className="appearance-none bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-lg px-3 py-2 pr-8 text-sm text-slate-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-gray-600"
              >
                <option value="never">Never expires</option>
                <option value="expires">Set expiration</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-gray-500" />
            </div>

            {expirationMode === "expires" && (
              <div className="flex items-center gap-3 mt-2">
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={expDays}
                    onChange={(e) => setExpDays(Math.max(0, Math.min(365, parseInt(e.target.value) || 0)))}
                    className="w-16 border border-slate-200 dark:border-gray-800 rounded-lg px-2 py-1.5 text-sm text-center bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-gray-600"
                  />
                  <span className="text-xs text-slate-500 dark:text-gray-400">days</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={expHours}
                    onChange={(e) => setExpHours(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))}
                    className="w-16 border border-slate-200 dark:border-gray-800 rounded-lg px-2 py-1.5 text-sm text-center bg-white dark:bg-gray-950 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-gray-600"
                  />
                  <span className="text-xs text-slate-500 dark:text-gray-400">hours</span>
                </div>
              </div>
            )}

            {expirationMode === "expires" && (
              <p className="text-xs text-slate-400 dark:text-gray-500 mt-1.5">
                After expiration, shared data sources are no longer queryable and the chat becomes read-only.
              </p>
            )}
          </div>

          {/* Source sharing — click to expand */}
          {activeDS.length > 0 && (
            <div>
              <button
                onClick={() => setShowSources(!showSources)}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-gray-300 hover:text-slate-900 dark:hover:text-gray-100 transition-colors"
              >
                <Database className="w-3.5 h-3.5 text-slate-400 dark:text-gray-500" />
                Share Data Sources
                <span className="font-normal text-slate-400 dark:text-gray-500">
                  {selectedDSIds.length > 0 ? `(${selectedDSIds.length} selected)` : "(optional)"}
                </span>
                <ChevronDown className={cn("w-3 h-3 text-slate-400 dark:text-gray-500 transition-transform", showSources && "rotate-180")} />
              </button>

              {showSources && (
                <div className="mt-2 border border-slate-200 dark:border-gray-800 rounded-lg overflow-hidden">
                  <div className="max-h-48 overflow-y-auto p-1 space-y-0.5">
                    {activeDS.map((ds) => {
                      const isOrgWide = ds.type === "organization" && ds.accessMode === "all";
                      const isSelected = selectedDSIds.includes(ds.id);
                      return (
                        <button
                          key={ds.id}
                          onClick={() => !isOrgWide && toggleDS(ds.id)}
                          disabled={isOrgWide}
                          className={cn(
                            "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                            isOrgWide
                              ? "opacity-40 cursor-not-allowed"
                              : isSelected
                                ? "bg-slate-100 dark:bg-gray-800 text-slate-900 dark:text-gray-100"
                                : "text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900",
                          )}
                        >
                          <Database className="w-3.5 h-3.5 text-slate-400 dark:text-gray-500 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <span className="text-xs truncate block">{ds.name}</span>
                            {isOrgWide && (
                              <span className="text-xs text-slate-400 dark:text-gray-500 block">Shared org-wide — always included</span>
                            )}
                          </div>
                          {isSelected && !isOrgWide && <Check className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="flex items-center gap-2 mt-5">
          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || loading}
            className="bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg px-4 py-2 text-xs font-medium hover:bg-slate-700 dark:hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            {loading
              ? (isConvert ? "Converting..." : "Creating...")
              : isConvert
                ? `Start Group Chat${selectedUsers.length > 0 ? ` (${selectedUsers.length} invited)` : ""}`
                : "Create"
            }
          </button>
          <button
            onClick={onClose}
            className="text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 px-4 py-2 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
