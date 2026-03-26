import { createFileRoute } from "@tanstack/react-router";
import { DataSourcePanel } from "@/components/admin/DataSourcePanel";

export const Route = createFileRoute("/_shell/library")({
  component: DataSourcePanel,
});
