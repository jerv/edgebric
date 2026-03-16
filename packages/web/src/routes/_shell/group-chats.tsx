import { createFileRoute } from "@tanstack/react-router";
import { GroupChatList } from "@/components/groupChat/GroupChatList";

export const Route = createFileRoute("/_shell/group-chats")({
  component: GroupChatList,
});
