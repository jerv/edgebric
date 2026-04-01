import { createFileRoute } from "@tanstack/react-router";
import { AccountPage } from "@/components/SettingsPage";
import type { AccountTab } from "@/components/SettingsPage";

const VALID_TABS: AccountTab[] = ["general", "notifications", "conversations", "connected-accounts"];

function AccountRoute() {
  const { tab } = Route.useSearch();
  return <AccountPage tab={tab} />;
}

export const Route = createFileRoute("/_shell/account")({
  component: AccountRoute,
  validateSearch: (search: Record<string, unknown>): { tab: AccountTab } => ({
    tab: VALID_TABS.includes(search["tab"] as AccountTab)
      ? (search["tab"] as AccountTab)
      : "general",
  }),
});
