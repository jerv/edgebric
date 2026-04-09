import { useState } from "react";
import Logo from "../shared/Logo";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  EyeOff,
  ShieldCheck,
  Database,
  Building2,
  User,
  Users,
  ChevronDown,
  LogOut,
  MessageSquare,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/contexts/UserContext";
import { usePrivacy } from "@/contexts/PrivacyContext";
import { DeleteConversationDialog } from "./DeleteConversationDialog";
import { GroupChatSetupDialog } from "@/components/groupChat/GroupChatSetupDialog";
import type { Conversation, GroupChat } from "@edgebric/types";

interface ConversationPreview extends Conversation {
  preview?: string;
  hasUnreadNotification?: boolean;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  adminOnly?: boolean;
  disabled?: boolean;
  search?: Record<string, string>;
  badge?: number;
}

// ─── Unified sidebar item ─────────────────────────────────────────────────────

type SidebarItem =
  | { type: "conversation"; id: string; label: string; updatedAt: Date; hasUnread: boolean }
  | { type: "group-chat"; id: string; label: string; updatedAt: Date; status: string; memberCount: number };

function buildUnifiedList(
  conversations: ConversationPreview[] | undefined,
  groupChats: GroupChat[] | undefined,
): SidebarItem[] {
  const items: SidebarItem[] = [];

  for (const conv of conversations ?? []) {
    items.push({
      type: "conversation",
      id: conv.id,
      label: conv.preview || "New conversation",
      updatedAt: new Date(conv.updatedAt),
      hasUnread: !!conv.hasUnreadNotification,
    });
  }

  for (const gc of groupChats ?? []) {
    items.push({
      type: "group-chat",
      id: gc.id,
      label: gc.name,
      updatedAt: new Date(gc.updatedAt),
      status: gc.status,
      memberCount: gc.members.length,
    });
  }

  // Sort by most recent first
  items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return items;
}

// ─── Date grouping ───────────────────────────────────────────────────────────

interface DateGroup {
  label: string;
  items: SidebarItem[];
}

function groupByDate(items: SidebarItem[]): DateGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const weekStart = new Date(todayStart.getTime() - 7 * 86_400_000);
  const monthStart = new Date(todayStart.getTime() - 30 * 86_400_000);

  const groups: Record<string, SidebarItem[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 days": [],
    "Previous 30 days": [],
    Older: [],
  };

  for (const item of items) {
    const d = item.updatedAt;
    if (d >= todayStart) groups["Today"]!.push(item);
    else if (d >= yesterdayStart) groups["Yesterday"]!.push(item);
    else if (d >= weekStart) groups["Previous 7 days"]!.push(item);
    else if (d >= monthStart) groups["Previous 30 days"]!.push(item);
    else groups["Older"]!.push(item);
  }

  return ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"]
    .filter((label) => groups[label]!.length > 0)
    .map((label) => ({ label, items: groups[label]! }));
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

interface SidebarProps {
  onNavigate?: () => void;
}


export function Sidebar({ onNavigate }: SidebarProps) {
  const user = useUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const searchParams = new URLSearchParams(routerState.location.search);
  const activeConvId = currentPath === "/" ? searchParams.get("c") : null;
  const activeGroupChatId = currentPath.startsWith("/group-chats/") ? currentPath.split("/")[2] : null;
  const [deletingConvId, setDeletingConvId] = useState<string | null>(null);
  const [newChatConfirmOpen, setNewChatConfirmOpen] = useState(false);
  const [showNewChatMenu, setShowNewChatMenu] = useState(false);
  const [showCreateGroupChat, setShowCreateGroupChat] = useState(false);
  const [leavingGroupChatId, setLeavingGroupChatId] = useState<string | null>(null);
  const privacy = usePrivacy();
  const isPrivacyActive = privacy.level !== "standard";
  const isAdmin = !!user?.isAdmin;
  const isSolo = user?.authMode === "none";

  function handleDeleteDone() {
    const wasActive = deletingConvId === activeConvId;
    setDeletingConvId(null);
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    if (wasActive) {
      window.history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }

  async function handleLeaveGroupChat() {
    if (!leavingGroupChatId || !user?.email) return;
    try {
      await fetch(`/api/group-chats/${leavingGroupChatId}/members/${encodeURIComponent(user.email)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      void queryClient.invalidateQueries({ queryKey: ["group-chats"] });
      if (activeGroupChatId === leavingGroupChatId) {
        void navigate({ to: "/" });
      }
    } catch { /* ignore */ }
    setLeavingGroupChatId(null);
  }

  const { data: conversations } = useQuery<ConversationPreview[]>({
    queryKey: ["conversations"],
    queryFn: () =>
      fetch("/api/conversations", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) return [];
        return r.json() as Promise<ConversationPreview[]>;
      }),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const { data: groupChats } = useQuery<GroupChat[]>({
    queryKey: ["group-chats"],
    queryFn: () =>
      fetch("/api/group-chats", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) return [];
        return r.json() as Promise<GroupChat[]>;
      }),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  // Unread group chat IDs (refreshed by SSE events)
  const { data: unreadGCIds } = useQuery<Set<string>>({
    queryKey: ["unread-group-chats"],
    queryFn: async () => {
      const r = await fetch("/api/notifications/unread-group-chats", { credentials: "same-origin" });
      if (!r.ok) return new Set<string>();
      const data = (await r.json()) as { ids: string[] };
      return new Set(data.ids);
    },
    staleTime: 5_000,
    refetchInterval: 60_000,
  });

  // Bot thinking state (set directly by SSE hook via queryClient.setQueryData)
  const { data: thinkingChatIds } = useQuery<Set<string>>({
    queryKey: ["bot-thinking"],
    queryFn: () => Promise.resolve(new Set<string>()),
    staleTime: Infinity,
  });

  // Health status for Service nav icon
  const { data: healthStatus } = useQuery<{ status: string; aiReady: boolean }>({
    queryKey: ["health-sidebar"],
    queryFn: () =>
      fetch("/api/health", { credentials: "same-origin" }).then((r) => r.json() as Promise<{ status: string; aiReady: boolean }>),
    refetchInterval: 15_000,
    staleTime: 10_000,
    enabled: isAdmin,
  });

  // PII warning count for sidebar badge on Data Sources
  const { data: piiSummary } = useQuery<{ summary: Record<string, number>; total: number }>({
    queryKey: ["pii-summary"],
    queryFn: () =>
      fetch("/api/data-sources/pii-summary", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) return { summary: {}, total: 0 };
        return r.json() as Promise<{ summary: Record<string, number>; total: number }>;
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const ServiceIcon = ({ className }: { className?: string }) => {
    const dotColor = !healthStatus
      ? "bg-gray-400"
      : healthStatus.status === "healthy" && healthStatus.aiReady
        ? "bg-emerald-500"
        : healthStatus.status === "healthy" || healthStatus.status === "degraded"
          ? "bg-amber-500"
          : "bg-red-500";
    return (
      <div className={cn("relative", className)}>
        <Activity className="w-4 h-4" />
        <span className={cn("absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-white dark:border-gray-950", dotColor)} />
      </div>
    );
  };

  const DataSourcesIcon = ({ className }: { className?: string }) => {
    const hasPiiWarnings = (piiSummary?.total ?? 0) > 0;
    return (
      <div className={cn("relative", className)}>
        <Database className="w-4 h-4" />
        {hasPiiWarnings && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 border border-white dark:border-gray-950" />
        )}
      </div>
    );
  };

  const adminNavItems: NavItem[] = [
    { href: "/library", label: "Data Sources", icon: DataSourcesIcon },
    { href: "/service", label: "Service", icon: ServiceIcon, adminOnly: true },
  ];

  const filteredAdminItems = adminNavItems.filter((item) => !item.adminOnly || isAdmin);
  const isOnChat = currentPath === "/";

  // Build unified list of conversations + group chats
  const unifiedItems = buildUnifiedList(conversations, groupChats);
  const dateGroups = groupByDate(unifiedItems);
  const hasItems = unifiedItems.length > 0;

  return (
    <nav className="flex flex-col h-full py-4">
      {/* Logo + Org name */}
      <Link
        to="/"
        onClick={onNavigate}
        className="mb-3 overflow-hidden flex items-center justify-center gap-2 px-3"
      >
        <Logo className="w-9 h-9 rounded-md flex-shrink-0" />
        <span className="font-bold text-slate-900 dark:text-gray-100 text-3xl tracking-tight">Edgebric</span>
      </Link>

      {/* New Chat button */}
      <div className="px-2 mb-1">
        {isPrivacyActive ? (
          <button
            onClick={() => {
              if (privacy.privacyMessages.length > 0) {
                setNewChatConfirmOpen(true);
              } else {
                privacy.setPrivacyMessages([]);
                window.history.pushState({}, "", "/");
                window.dispatchEvent(new PopStateEvent("popstate"));
                onNavigate?.();
              }
            }}
            className={cn(
              "flex items-center w-full rounded-lg text-sm transition-colors gap-2 px-3 py-2",
              "text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 hover:text-slate-900 dark:hover:text-gray-100",
            )}
          >
            <Plus className="w-4 h-4 flex-shrink-0" />
            <span>New Chat</span>
          </button>
        ) : (
          <div className="relative">
            <button
              onClick={() => {
                window.history.pushState({}, "", "/");
                window.dispatchEvent(new PopStateEvent("popstate"));
                onNavigate?.();
              }}
              className={cn(
                "flex items-center w-full rounded-lg text-sm transition-colors gap-2 px-3 py-2",
                isOnChat && !activeConvId
                  ? "bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900"
                  : "text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 hover:text-slate-900 dark:hover:text-gray-100",
              )}
            >
              <Plus className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 text-left">New Chat</span>
              <span
                role="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowNewChatMenu((v) => !v);
                }}
                className="p-1.5 md:p-0.5 rounded hover:bg-white/20 dark:hover:bg-black/20 transition-colors"
                title="More options"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </span>
            </button>
            {showNewChatMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowNewChatMenu(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-xl shadow-lg py-1 w-full min-w-[180px] overflow-hidden">
                  <button
                    onClick={() => {
                      setShowNewChatMenu(false);
                      window.history.pushState({}, "", "/");
                      window.dispatchEvent(new PopStateEvent("popstate"));
                      onNavigate?.();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 md:py-2 text-xs text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-900 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Chat
                  </button>
                  <button
                    onClick={() => {
                      if (isSolo) return;
                      setShowNewChatMenu(false);
                      setShowCreateGroupChat(true);
                    }}
                    disabled={isSolo}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2.5 md:py-2 text-xs transition-colors",
                      isSolo
                        ? "text-slate-300 dark:text-gray-600 cursor-not-allowed"
                        : "text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-900",
                    )}
                  >
                    <Users className="w-3.5 h-3.5" />
                    New Group Chat
                    {isSolo && <span className="ml-auto text-[10px] text-slate-400 dark:text-gray-500">Org</span>}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Privacy mode label */}
      {isPrivacyActive && (
        <div className="px-5 mb-1">
          <div className={cn(
            "flex items-center gap-2 text-xs font-medium py-2",
            privacy.level === "vault" ? "text-emerald-700" : "text-slate-600 dark:text-gray-400",
          )}>
            {privacy.level === "vault" ? (
              <ShieldCheck className="w-3.5 h-3.5" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
            {privacy.level === "vault" ? "Vault Mode" : "Private Mode"}
          </div>
        </div>
      )}

      {/* Unified conversation + group chat list */}
      {!isPrivacyActive && hasItems && (
        <div className="flex-1 overflow-y-auto px-2 min-h-0 scrollbar-thin">
          {dateGroups.map((group) => (
            <div key={group.label}>
              <div className="px-3 pt-3 pb-1 text-xs font-medium text-slate-400 dark:text-gray-500 uppercase tracking-wider select-none">
                {group.label}
              </div>
              {group.items.map((item) => {
                if (item.type === "conversation") {
                  const isActive = isOnChat && activeConvId === item.id;
                  return (
                    <div
                      key={`c-${item.id}`}
                      className={cn(
                        "flex items-center rounded-lg transition-colors px-3 py-2 md:py-1.5 group",
                        isActive
                          ? "bg-slate-100 dark:bg-gray-800 text-slate-900 dark:text-gray-100"
                          : "text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900 hover:text-slate-700 dark:hover:text-gray-200",
                      )}
                    >
                      {thinkingChatIds?.has(item.id) ? (
                        <span className="flex items-center gap-0.5 flex-shrink-0 mr-1.5">
                          <span className="w-1 h-1 rounded-full bg-blue-500 animate-bounce [animation-delay:0ms]" />
                          <span className="w-1 h-1 rounded-full bg-blue-500 animate-bounce [animation-delay:150ms]" />
                          <span className="w-1 h-1 rounded-full bg-blue-500 animate-bounce [animation-delay:300ms]" />
                        </span>
                      ) : (
                        <MessageSquare className="w-3 h-3 flex-shrink-0 mr-1.5 text-slate-400 dark:text-gray-500" />
                      )}
                      <span
                        className="flex-1 min-w-0 cursor-pointer flex items-center gap-1.5"
                        onClick={() => {
                          window.history.pushState({}, "", `/?c=${item.id}`);
                          window.dispatchEvent(new PopStateEvent("popstate"));
                          onNavigate?.();
                        }}
                      >
                        {item.hasUnread && (
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                        )}
                        <span className="block truncate text-xs">{item.label}</span>
                      </span>
                      <button
                        onClick={() => setDeletingConvId(item.id)}
                        className="ml-1 p-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 text-slate-300 dark:text-gray-600 hover:text-red-400 transition-opacity flex-shrink-0"
                        title="Remove conversation"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                }

                // Group chat item
                const isActive = activeGroupChatId === item.id;
                const hasUnread = !isActive && unreadGCIds?.has(item.id);
                const isThinkingChat = thinkingChatIds?.has(item.id);
                return (
                  <div
                    key={`gc-${item.id}`}
                    className={cn(
                      "flex items-center rounded-lg transition-colors px-3 py-2 md:py-1.5 group cursor-pointer",
                      isActive
                        ? "bg-slate-100 dark:bg-gray-800 text-slate-900 dark:text-gray-100"
                        : "text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-900 hover:text-slate-700 dark:hover:text-gray-200",
                    )}
                    onClick={() => {
                      void navigate({ to: "/group-chats/$id", params: { id: item.id } });
                      onNavigate?.();
                    }}
                  >
                    {isThinkingChat ? (
                      <span className="flex items-center gap-0.5 flex-shrink-0 mr-1.5">
                        <span className="w-1 h-1 rounded-full bg-blue-500 animate-bounce [animation-delay:0ms]" />
                        <span className="w-1 h-1 rounded-full bg-blue-500 animate-bounce [animation-delay:150ms]" />
                        <span className="w-1 h-1 rounded-full bg-blue-500 animate-bounce [animation-delay:300ms]" />
                      </span>
                    ) : (
                      <Users className="w-3 h-3 flex-shrink-0 mr-1.5 text-slate-400 dark:text-gray-500" />
                    )}
                    <span className="flex-1 min-w-0 flex items-center gap-1.5">
                      {hasUnread && (
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                      )}
                      <span className={cn("block truncate text-xs", hasUnread && "font-medium")}>{item.label}</span>
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setLeavingGroupChatId(item.id);
                      }}
                      className="ml-1 p-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 text-slate-300 dark:text-gray-600 hover:text-red-400 transition-opacity flex-shrink-0"
                      title="Leave group chat"
                    >
                      <LogOut className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* When collapsed, no items, or privacy mode, fill remaining space */}
      {(isPrivacyActive || !hasItems) && (
        <div className="flex-1" />
      )}

      {/* Admin nav items */}
      {filteredAdminItems.length > 0 && (
        <div className="px-2 border-t border-slate-100 dark:border-gray-800 pt-2 mt-2 space-y-0.5">
          {filteredAdminItems.map((item, _idx) => {
            const itemTab = item.search?.["tab"];
            const currentTab = searchParams.get("tab");
            const isActive = itemTab
              ? currentPath.startsWith(item.href) && currentTab === itemTab
              : currentPath === item.href || currentPath.startsWith(item.href + "/");
            const Icon = item.icon;

            return (
              <Link
                key={`${item.href}-${item.label}`}
                to={item.href}
                search={item.search ?? {}}
                onClick={onNavigate}
                className={cn(
                  "flex items-center rounded-lg text-sm transition-colors gap-3 px-3 py-2",
                  isActive
                    ? "bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900"
                    : "text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 hover:text-slate-900 dark:hover:text-gray-100",
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{item.label}</span>
                {item.badge && item.badge > 0 ? (
                  <span className={cn(
                    "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold leading-none rounded-full",
                    isActive ? "bg-white/20 text-white dark:bg-black/20 dark:text-gray-900" : "bg-blue-500 text-white",
                  )}>
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      )}

      {/* Bottom: Organization + Account */}
      <div className="px-2 border-t border-slate-100 dark:border-gray-800 pt-2 mt-2 space-y-0.5">
        {!isSolo && (
          <Link
            to="/organization"
            search={{ tab: "general" }}
            onClick={onNavigate}
            className={cn(
              "flex items-center rounded-lg text-sm transition-colors gap-3 px-3 py-2",
              currentPath.startsWith("/organization")
                ? "bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900"
                : "text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 hover:text-slate-900 dark:hover:text-gray-100",
            )}
          >
            <Building2 className="w-4 h-4 flex-shrink-0" />
            <span>Organization</span>
          </Link>
        )}

        <Link
          to="/account"
          search={{ tab: "general" }}
          onClick={onNavigate}
          className={cn(
            "flex items-center rounded-lg text-sm transition-colors gap-3 px-3 py-2",
            currentPath.startsWith("/account")
              ? "bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900"
              : "text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 hover:text-slate-900 dark:hover:text-gray-100",
          )}
        >
          <User className="w-4 h-4 flex-shrink-0" />
          <span>Account</span>
        </Link>
      </div>

      {deletingConvId && (
        <DeleteConversationDialog
          conversationId={deletingConvId}
          onClose={() => setDeletingConvId(null)}
          onDone={handleDeleteDone}
        />
      )}

      {newChatConfirmOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setNewChatConfirmOpen(false); }}
        >
          <div className="bg-white dark:bg-gray-950 rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100 mb-2">Start a new chat?</h3>
            <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed mb-5">
              Your current conversation will be permanently lost.
              {privacy.level === "vault" ? " Vault" : " Private"} conversations are never saved.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  privacy.setPrivacyMessages([]);
                  setNewChatConfirmOpen(false);
                  window.history.pushState({}, "", "/");
                  window.dispatchEvent(new PopStateEvent("popstate"));
                  onNavigate?.();
                }}
                className="bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg px-4 py-2 text-xs font-medium hover:bg-slate-700 dark:hover:bg-gray-300 transition-colors"
              >
                New Chat
              </button>
              <button
                onClick={() => setNewChatConfirmOpen(false)}
                className="text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 px-4 py-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {leavingGroupChatId && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setLeavingGroupChatId(null); }}
        >
          <div className="bg-white dark:bg-gray-950 rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100 mb-2">Leave group chat?</h3>
            <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed mb-5">
              You will lose access to this group chat and its shared data sources.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleLeaveGroupChat()}
                className="bg-red-600 text-white rounded-lg px-4 py-2 text-xs font-medium hover:bg-red-500 transition-colors"
              >
                Leave
              </button>
              <button
                onClick={() => setLeavingGroupChatId(null)}
                className="text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 px-4 py-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateGroupChat && (
        <GroupChatSetupDialog onClose={() => setShowCreateGroupChat(false)} />
      )}
    </nav>
  );
}
