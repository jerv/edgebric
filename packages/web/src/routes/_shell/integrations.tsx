import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/** Redirect legacy /integrations URL to account connected accounts. */
function IntegrationsRoute() {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ to: "/account", search: { tab: "connected-accounts" }, replace: true });
  }, [navigate]);
  return null;
}

export const Route = createFileRoute("/_shell/integrations")({
  component: IntegrationsRoute,
});
