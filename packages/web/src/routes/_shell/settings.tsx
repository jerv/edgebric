import { createFileRoute, redirect } from "@tanstack/react-router";

// Redirect /settings to /account for backward compatibility
export const Route = createFileRoute("/_shell/settings")({
  beforeLoad: () => {
    throw redirect({ to: "/account", search: { tab: "general" } });
  },
  component: () => null,
});
