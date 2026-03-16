import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart2,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  EyeOff,
  ShieldCheck,
  Database,
  Building2,
  User,
  MessageSquareMore,
  HelpCircle,
  Users,
  ChevronDown,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/contexts/UserContext";
import { usePrivacy } from "@/contexts/PrivacyContext";
import { DeleteConversationDialog } from "./DeleteConversationDialog";
import { CreateGroupChatDialog } from "@/components/groupChat/CreateGroupChatDialog";
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
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}

export function Sidebar({ collapsed = false, onToggleCollapse, onNavigate }: SidebarProps) {
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

  const adminNavItems: NavItem[] = [
    { href: "/library", label: "Library", icon: Database },
    { href: "/analytics", label: "Analytics", icon: BarChart2, adminOnly: true, search: { tab: "overview" } },
    { href: "/escalations", label: "Escalations", icon: MessageSquareMore, adminOnly: true, badge: unreadCount },
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
        className={cn("mb-1 overflow-hidden block", collapsed ? "px-0 text-center" : "px-4")}
      >
        {collapsed ? (
          <span className="font-bold text-slate-900 text-base">E</span>
        ) : (
          <span className="font-semibold text-slate-900 text-base">Edgebric</span>
        )}
      </Link>
      {!collapsed && user?.orgName && (
        <div className="px-4 mb-3 text-[11px] text-slate-400 truncate">{user.orgName}</div>
      )}

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
            title={collapsed ? "New Chat" : undefined}
            className={cn(
              "flex items-center w-full rounded-lg text-sm transition-colors",
              collapsed ? "justify-center px-0 py-2" : "gap-2 px-3 py-2",
              "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <Plus className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>New Chat</span>}
          </button>
        ) : (
          <div className="relative">
            <Link
              to="/"
              onClick={onNavigate}
              title={collapsed ? "New Chat" : undefined}
              className={cn(
                "flex items-center rounded-lg text-sm transition-colors",
                collapsed ? "justify-center px-0 py-2" : "gap-2 px-3 py-2",
                isOnChat && !activeConvId
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <Plus className="w-4 h-4 flex-shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1">New Chat</span>
                  <span
                    role="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowNewChatMenu((v) => !v);
                    }}
                    className="p-0.5 rounded hover:bg-white/20 transition-colors"
                    title="More options"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </span>
                </>
              )}
            </Link>
            {showNewChatMenu && !collapsed && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowNewChatMenu(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-full min-w-[180px]">
                  <button
                    onClick={() => {
                      setShowNewChatMenu(false);
                      window.history.pushState({}, "", "/");
                      window.dispatchEvent(new PopStateEvent("popstate"));
                      onNavigate?.();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Chat
                  </button>
                  <button
                    onClick={() => {
                      setShowNewChatMenu(false);
                      setShowCreateGroupChat(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <Users className="w-3.5 h-3.5" />
                    New Group Chat
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Privacy mode label */}
      {isPrivacyActive && !collapsed && (
        <div className="px-5 mb-1">
          <div className={cn(
            "flex items-center gap-2 text-xs font-medium py-2",
            privacy.level === "vault" ? "text-emerald-700" : "text-slate-600",
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
      {!isPrivacyActive && !collapsed && hasItems && (
        <div className="flex-1 overflow-y-auto px-2 min-h-0 scrollbar-thin">
          {dateGroups.map((group) => (
            <div key={group.label}>
              <div className="px-3 pt-3 pb-1 text-[11px] font-medium text-slate-400 uppercase tracking-wider select-none">
                {group.label}
              </div>
              {group.items.map((item) => {
                if (item.type === "conversation") {
                  const isActive = isOnChat && activeConvId === item.id;
                  return (
                    <div
                      key={`c-${item.id}`}
                      className={cn(
                        "flex items-center rounded-lg transition-colors px-3 py-1.5 group",
                        isActive
                          ? "bg-slate-100 text-slate-900"
                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
                      )}
                    >
                      <span
                        className="flex-1 min-w-0 cursor-pointer flex items-center gap-1.5"
                        onClick={() => {
                          window.history.pushState({}, "", `/?c=${item.id}`);
                          window.dispatchEvent(new PopStateEvent("popstate"));
                          onNavigate?.();
                        }}
                      >
                        {item.hasUnread && (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                        )}
                        <span className="block truncate text-xs">{item.label}</span>
                      </span>
                      <button
                        onClick={() => setDeletingConvId(item.id)}
                        className="ml-1 p-0.5 opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-opacity flex-shrink-0"
                        title="Remove conversation"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                }

                // Group chat item
                const isActive = activeGroupChatId === item.id;
                return (
                  <div
                    key={`gc-${item.id}`}
                    className={cn(
                      "flex items-center rounded-lg transition-colors px-3 py-1.5 group cursor-pointer",
                      isActive
                        ? "bg-slate-100 text-slate-900"
                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
                    )}
                    onClick={() => {
                      void navigate({ to: "/group-chats/$id", params: { id: item.id } });
                      onNavigate?.();
                    }}
                  >
                    <Users className="w-3 h-3 flex-shrink-0 mr-1.5 text-slate-400" />
                    <span className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span className="block truncate text-xs">{item.label}</span>
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setLeavingGroupChatId(item.id);
                      }}
                      className="ml-1 p-0.5 opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-opacity flex-shrink-0"
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
      {(isPrivacyActive || collapsed || !hasItems) && (
        <div className="flex-1" />
      )}

      {/* Admin nav items */}
      {filteredAdminItems.length > 0 && (
        <div className="px-2 border-t border-slate-100 pt-2 mt-2 space-y-0.5">
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
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center rounded-lg text-sm transition-colors",
                  collapsed ? "justify-center px-0 py-2" : "gap-3 px-3 py-2",
                  isActive
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1">{item.label}</span>
                    {item.badge && item.badge > 0 ? (
                      <span className={cn(
                        "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold leading-none rounded-full",
                        isActive ? "bg-white/20 text-white" : "bg-blue-500 text-white",
                      )}>
                        {item.badge}
                      </span>
                    ) : null}
                  </>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* Bottom: Organization + Account + collapse toggle */}
      <div className="px-2 border-t border-slate-100 pt-2 mt-2 space-y-0.5">
        <Link
          to="/organization"
          search={{ tab: "general" }}
          onClick={onNavigate}
          title={collapsed ? "Organization" : undefined}
          className={cn(
            "flex items-center rounded-lg text-sm transition-colors",
            collapsed ? "justify-center px-0 py-2" : "gap-3 px-3 py-2",
            currentPath.startsWith("/organization")
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
          )}
        >
          <Building2 className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Organization</span>}
        </Link>

        <Link
          to="/account"
          search={{ tab: "general" }}
          onClick={onNavigate}
          title={collapsed ? "Account" : undefined}
          className={cn(
            "flex items-center rounded-lg text-sm transition-colors",
            collapsed ? "justify-center px-0 py-2" : "gap-3 px-3 py-2",
            currentPath.startsWith("/account")
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
          )}
        >
          <User className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Account</span>}
        </Link>

        <Link
          to="/admin-guide"
          onClick={onNavigate}
          title={collapsed ? "Help" : undefined}
          className={cn(
            "flex items-center rounded-lg text-sm transition-colors",
            collapsed ? "justify-center px-0 py-2" : "gap-3 px-3 py-2",
            currentPath.startsWith("/admin-guide")
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
          )}
        >
          <HelpCircle className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Help</span>}
        </Link>

        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex items-center w-full rounded-lg text-sm text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors py-2",
              collapsed ? "justify-center px-0" : "gap-3 px-3",
            )}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4 flex-shrink-0" />
            ) : (
              <>
                <ChevronLeft className="w-4 h-4 flex-shrink-0" />
                <span>Collapse</span>
              </>
            )}
          </button>
        )}
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
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-2">Start a new chat?</h3>
            <p className="text-xs text-slate-500 leading-relaxed mb-5">
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
                className="bg-slate-900 text-white rounded-lg px-4 py-2 text-xs font-medium hover:bg-slate-700 transition-colors"
              >
                New Chat
              </button>
              <button
                onClick={() => setNewChatConfirmOpen(false)}
                className="text-xs text-slate-500 hover:text-slate-700 px-4 py-2 transition-colors"
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
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-2">Leave group chat?</h3>
            <p className="text-xs text-slate-500 leading-relaxed mb-5">
              You will lose access to this group chat and its shared knowledge bases.
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
                className="text-xs text-slate-500 hover:text-slate-700 px-4 py-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateGroupChat && (
        <CreateGroupChatDialog onClose={() => setShowCreateGroupChat(false)} />
      )}
    </nav>
  );
}
