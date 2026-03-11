import { createFileRoute } from "@tanstack/react-router";
import { ChatPanel } from "@/components/employee/QueryInterface";

export const Route = createFileRoute("/_shell/")({
  component: ChatPanel,
});
