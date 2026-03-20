import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Global SSE hook — connects to /api/notifications/stream and dispatches
 * events to React Query caches for real-time sidebar updates.
 *
 * Events handled:
 * - unread           -> invalidate unread-group-chats query
 * - group_chat_invite -> invalidate group-chats list
 * - mention          -> invalidate unread-group-chats
 * - bot_thinking     -> update thinking state in React Query cache
 * - notification     -> invalidate notifications + unread count
 */

// ─── Module-level thinking state ────────────────────────────────────────────

/** Set of group chat IDs where the bot is currently thinking */
const thinkingChats = new Set<string>();

export function getThinkingChats(): Set<string> {
  return new Set(thinkingChats);
}

// ─── Hook ───────────────────────────────────────────────────────────────────

let activeConnection: EventSource | null = null;

export function useNotificationStream() {
  const queryClient = useQueryClient();
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    // Only one connection globally
    if (activeConnection && activeConnection.readyState !== EventSource.CLOSED) return;

    const es = new EventSource("/api/notifications/stream", { withCredentials: true });
    activeConnection = es;

    es.addEventListener("unread", (e) => {
      try {
        const data = JSON.parse(e.data) as { groupChatId: string };
        void queryClient.invalidateQueries({ queryKey: ["unread-group-chats"] });
        void queryClient.invalidateQueries({ queryKey: ["group-chat", data.groupChatId] });
      } catch { /* ignore */ }
    });

    es.addEventListener("group_chat_invite", () => {
      void queryClient.invalidateQueries({ queryKey: ["group-chats"] });
      void queryClient.invalidateQueries({ queryKey: ["unread-group-chats"] });
    });

    es.addEventListener("mention", () => {
      void queryClient.invalidateQueries({ queryKey: ["unread-group-chats"] });
    });

    es.addEventListener("bot_thinking", (e) => {
      try {
        const data = JSON.parse(e.data) as { chatId: string; thinking: boolean };
        if (data.thinking) {
          thinkingChats.add(data.chatId);
        } else {
          thinkingChats.delete(data.chatId);
        }
        // Update the React Query cache directly so the sidebar re-renders
        queryClient.setQueryData<Set<string>>(["bot-thinking"], new Set(thinkingChats));
      } catch { /* ignore */ }
    });

    es.addEventListener("notification", () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["unread-count"] });
    });

    es.onerror = () => {
      es.close();
      activeConnection = null;
      reconnectTimer.current = setTimeout(connect, 3000);
    };
  }, [queryClient]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
    };
  }, [connect]);
}
