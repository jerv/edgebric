import { createFileRoute } from "@tanstack/react-router";
import { OrganizationPage } from "@/components/OrganizationPage";
import type { OrgTab } from "@/components/OrganizationPage";

const VALID_TABS: OrgTab[] = ["general", "privacy", "members", "network", "integrations", "api-keys"];

function OrganizationRoute() {
  const { tab } = Route.useSearch();
  return <OrganizationPage tab={tab} />;
}

export const Route = createFileRoute("/_shell/organization")({
  component: OrganizationRoute,
  validateSearch: (search: Record<string, unknown>): { tab: OrgTab } => ({
    tab: VALID_TABS.includes(search["tab"] as OrgTab)
      ? (search["tab"] as OrgTab)
      : "general",
  }),
});
