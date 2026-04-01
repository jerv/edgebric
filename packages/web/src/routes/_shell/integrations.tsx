import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/** Redirect legacy /integrations URL to organization settings. */
function IntegrationsRoute() {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ to: "/organization", search: { tab: "integrations" }, replace: true });
  }, [navigate]);
  return null;
}

export const Route = createFileRoute("/_shell/integrations")({
  component: IntegrationsRoute,
});
