import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/components/SettingsPage";
import type { SettingsTab } from "@/components/SettingsPage";

const VALID_TABS: SettingsTab[] = ["account", "privacy", "members", "models", "integrations", "escalations"];

function SettingsRoute() {
  const { tab } = Route.useSearch();
  return <SettingsPage tab={tab} />;
}

export const Route = createFileRoute("/_shell/settings")({
  component: SettingsRoute,
  validateSearch: (search: Record<string, unknown>): { tab: SettingsTab } => ({
    tab: VALID_TABS.includes(search["tab"] as SettingsTab)
      ? (search["tab"] as SettingsTab)
      : "account",
  }),
});
