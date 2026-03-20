import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Users, Clock, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/contexts/UserContext";
import { GroupChatSetupDialog } from "./GroupChatSetupDialog";
import type { GroupChat } from "@edgebric/types";

function formatExpiry(chat: GroupChat): string {
  if (!chat.expiresAt) return "Never expires";
  const now = Date.now();
  const exp = new Date(chat.expiresAt).getTime();
  const diff = exp - now;
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h remaining`;
  const days = Math.floor(hours / 24);
  return `${days}d remaining`;
}

function statusBadge(status: GroupChat["status"]) {
  switch (status) {
    case "active":
      return <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5 rounded-full">Active</span>;
    case "expired":
      return <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5 rounded-full">Expired</span>;
    case "archived":
      return <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 dark:text-gray-400 bg-slate-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">Archived</span>;
  }
}

export function GroupChatList() {
  const user = useUser();
  const [showCreate, setShowCreate] = useState(false);

  const { data: chats, isLoading } = useQuery<GroupChat[]>({
    queryKey: ["group-chats"],
    queryFn: () =>
      fetch("/api/group-chats", { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<GroupChat[]>;
      }),
  });

  const canCreate = user?.isAdmin || user?.canCreateGroupChats;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-gray-100">Group Chats</h1>
          <p className="text-sm text-slate-500 dark:text-gray-400 mt-0.5">Collaborative knowledge sessions with shared data sources</p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-700 dark:hover:bg-gray-200 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Group Chat
          </button>
        )}
      </div>

      {isLoading && (
        <div className="text-sm text-slate-400 dark:text-gray-500 py-12 text-center">Loading...</div>
      )}

      {!isLoading && (!chats || chats.length === 0) && (
        <div className="text-center py-16">
          <Users className="w-10 h-10 text-slate-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500 dark:text-gray-400 mb-1">No group chats yet</p>
          <p className="text-xs text-slate-400 dark:text-gray-500">
            {canCreate
              ? "Create a group chat to start collaborating with your team."
              : "Ask an admin to create a group chat or grant you permission."}
          </p>
        </div>
      )}

      {chats && chats.length > 0 && (
        <div className="space-y-2">
          {chats.map((chat) => (
            <Link
              key={chat.id}
              to="/group-chats/$id"
              params={{ id: chat.id }}
              className="block bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-xl p-4 hover:border-slate-300 dark:hover:border-gray-600 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-slate-900 dark:text-gray-100">{chat.name}</h3>
                  {statusBadge(chat.status)}
                </div>
                <span className="text-[11px] text-slate-400 dark:text-gray-500">{formatExpiry(chat)}</span>
              </div>

              <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-gray-400">
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  {chat.members.length} member{chat.members.length !== 1 ? "s" : ""}
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5" />
                  {chat.messageCount ?? 0} messages
                </span>
                {chat.sharedKBs.length > 0 && (
                  <span className="flex items-center gap-1">
                    {chat.sharedKBs.length} source{chat.sharedKBs.length !== 1 ? "s" : ""} shared
                  </span>
                )}
              </div>

              {chat.members.length > 0 && (
                <div className="flex items-center gap-1 mt-2">
                  {chat.members.slice(0, 5).map((m) => (
                    <span
                      key={m.userEmail}
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 dark:bg-gray-800 text-[10px] font-medium text-slate-600 dark:text-gray-400"
                      title={m.userName ?? m.userEmail}
                    >
                      {(m.userName ?? m.userEmail).charAt(0).toUpperCase()}
                    </span>
                  ))}
                  {chat.members.length > 5 && (
                    <span className="text-[10px] text-slate-400 dark:text-gray-500 ml-1">+{chat.members.length - 5}</span>
                  )}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <GroupChatSetupDialog onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
