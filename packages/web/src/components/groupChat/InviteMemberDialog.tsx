import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, AlertTriangle, Search, UserMinus, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/contexts/UserContext";
import type { GroupChatMember } from "@edgebric/types";

interface SearchResult {
  email: string;
  name: string | null;
  picture: string | null;
}

interface Props {
  groupChatId: string;
  existingMembers: GroupChatMember[];
  creatorEmail: string;
  isActive: boolean;
  onClose: () => void;
}

export function InviteMemberDialog({ groupChatId, existingMembers, creatorEmail, isActive, onClose }: Props) {
  const user = useUser();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<SearchResult | null>(null);
  const [step, setStep] = useState<"input" | "confirm">("input");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  const isCreator = user?.email?.toLowerCase() === creatorEmail.toLowerCase();
  const existingEmails = new Set(existingMembers.map((m) => m.userEmail.toLowerCase()));

  async function handleRemoveMember(email: string) {
    setRemovingEmail(email);
    try {
      const res = await fetch(`/api/group-chats/${groupChatId}/members/${encodeURIComponent(email)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (res.ok) {
        void queryClient.invalidateQueries({ queryKey: ["group-chat", groupChatId] });
      }
    } catch { /* ignore */ }
    setRemovingEmail(null);
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
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
          setResults(data);
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
  }, [query]);

  function selectUser(user: SearchResult) {
    setSelectedUser(user);
    setQuery(user.name ? `${user.name} (${user.email})` : user.email);
    setResults([]);
  }

  function handleNext() {
    // If user typed a raw email without selecting from results
    if (!selectedUser && query.includes("@")) {
      setSelectedUser({ email: query.trim().toLowerCase(), name: null, picture: null });
    }
    if (!selectedUser && !query.includes("@")) return;
    setStep("confirm");
  }

  const inviteEmail = selectedUser?.email ?? query.trim().toLowerCase();

  async function handleInvite() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/group-chats/${groupChatId}/members`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to invite" }));
        setError(body.error ?? "Failed to invite member");
        setStep("input");
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ["group-chat", groupChatId] });
      onClose();
    } catch {
      setError("Network error");
      setStep("input");
    } finally {
      setLoading(false);
    }
  }

  // Filter out already-existing members from results
  const filteredResults = results.filter((r) => !existingEmails.has(r.email.toLowerCase()));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-950 rounded-2xl shadow-xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Members</h2>
          <button onClick={onClose} className="p-2 -m-1 text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Current members list */}
        {existingMembers.length > 0 && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">
              Current Members ({existingMembers.length})
            </label>
            <div className="border border-slate-200 dark:border-gray-800 rounded-lg divide-y divide-slate-100 dark:divide-gray-800 max-h-48 overflow-y-auto">
              {existingMembers.map((member) => {
                const isMemberCreator = member.role === "creator";
                const canRemove = isCreator && !isMemberCreator && isActive;
                const isSelf = member.userEmail.toLowerCase() === user?.email?.toLowerCase();
                return (
                  <div key={member.userEmail} className="flex items-center gap-2.5 px-3 py-2.5">
                    {member.picture ? (
                      <img src={member.picture} alt="" className="w-6 h-6 rounded-full flex-shrink-0" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-slate-500 dark:text-gray-400">
                          {(member.userName ?? member.userEmail)[0]?.toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-slate-900 dark:text-gray-100 truncate">
                        {member.userName ?? member.userEmail}
                        {isSelf && <span className="text-slate-400 dark:text-gray-500 font-normal ml-1">(you)</span>}
                      </p>
                      {member.userName && (
                        <p className="text-xs text-slate-400 dark:text-gray-500 truncate">{member.userEmail}</p>
                      )}
                    </div>
                    {isMemberCreator ? (
                      <span className="flex items-center gap-0.5 text-xs text-slate-400 dark:text-gray-500 flex-shrink-0">
                        <Crown className="w-3 h-3" />
                        Owner
                      </span>
                    ) : canRemove ? (
                      <button
                        onClick={() => void handleRemoveMember(member.userEmail)}
                        disabled={removingEmail === member.userEmail}
                        className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors flex-shrink-0 disabled:opacity-50 py-1 px-1.5"
                        title={`Remove ${member.userName ?? member.userEmail}`}
                      >
                        <UserMinus className="w-3 h-3" />
                        Remove
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {isCreator && isActive && step === "input" && (
          <>
            <div className="relative">
              <label className="block text-xs font-medium text-slate-700 dark:text-gray-300 mb-1">
                Invite new member
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-gray-500" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelectedUser(null);
                  }}
                  placeholder="Name or email..."
                  className="w-full border border-slate-200 dark:border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-gray-100 bg-white dark:bg-gray-950 placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:focus:ring-gray-600"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (selectedUser || query.includes("@"))) {
                      handleNext();
                    }
                  }}
                />
              </div>

              {/* Autocomplete dropdown */}
              {filteredResults.length > 0 && !selectedUser && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                  {filteredResults.map((user) => (
                    <button
                      key={user.email}
                      onClick={() => selectUser(user)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-gray-900 transition-colors"
                    >
                      {user.picture ? (
                        <img
                          src={user.picture}
                          alt=""
                          className="w-7 h-7 rounded-full flex-shrink-0"
                        />
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
                    </button>
                  ))}
                </div>
              )}

              {/* "No results" when searching with enough chars but nothing found */}
              {query.trim().length >= 2 && filteredResults.length === 0 && !selectedUser && !searching && results.length === 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-lg shadow-lg z-10 px-3 py-3">
                  <p className="text-xs text-slate-500 dark:text-gray-400 text-center">
                    No users found. You can type a full email address to invite.
                  </p>
                </div>
              )}
            </div>

            {error && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{error}</p>}

            <div className="flex items-center gap-2 mt-5">
              <button
                onClick={handleNext}
                disabled={!selectedUser && !query.includes("@")}
                className="bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg px-4 py-2 text-xs font-medium hover:bg-slate-700 dark:hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                Next
              </button>
              <button onClick={onClose} className="text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 px-4 py-2">
                Cancel
              </button>
            </div>
          </>
        )}

        {isCreator && isActive && step === "confirm" && (
          <>
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">Confirm invitation</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                    Are you sure you want to add{" "}
                    <strong>{selectedUser?.name ? `${selectedUser.name} (${inviteEmail})` : inviteEmail}</strong>{" "}
                    to this group chat?
                    They will gain access to query all shared sources. This cannot be undone
                    until the chat expires or you remove them.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleInvite()}
                disabled={loading}
                className="bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg px-4 py-2 text-xs font-medium hover:bg-slate-700 dark:hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                {loading ? "Inviting..." : "Confirm Invite"}
              </button>
              <button
                onClick={() => setStep("input")}
                className="text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 px-4 py-2"
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
