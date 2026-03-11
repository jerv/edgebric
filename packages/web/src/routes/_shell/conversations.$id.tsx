import { createFileRoute } from "@tanstack/react-router";
import { ConversationViewer } from "@/components/conversations/ConversationViewer";

export const Route = createFileRoute("/_shell/conversations/$id")({
  component: ConversationViewer,
});
