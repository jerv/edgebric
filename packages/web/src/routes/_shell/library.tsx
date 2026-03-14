import { createFileRoute } from "@tanstack/react-router";
import { KnowledgeBasePanel } from "@/components/admin/KnowledgeBasePanel";

export const Route = createFileRoute("/_shell/library")({
  component: KnowledgeBasePanel,
});
