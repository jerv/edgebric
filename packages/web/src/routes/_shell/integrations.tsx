import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useUser } from "@/contexts/UserContext";
import { IntegrationsPanel } from "@/components/admin/IntegrationsPanel";

function IntegrationsRoute() {
  const user = useUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && !user.isAdmin) {
      void navigate({ to: "/" });
    }
  }, [user, navigate]);

  if (!user?.isAdmin) return null;
  return <IntegrationsPanel />;
}

export const Route = createFileRoute("/_shell/integrations")({
  component: IntegrationsRoute,
});
