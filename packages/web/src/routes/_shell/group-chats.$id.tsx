import { createFileRoute } from "@tanstack/react-router";
import { GroupChatView } from "@/components/groupChat/GroupChatView";

export const Route = createFileRoute("/_shell/group-chats/$id")({
  component: GroupChatView,
});
