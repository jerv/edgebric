import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useUser } from "@/contexts/UserContext";
import { EscalationsPage } from "@/components/admin/EscalationsPage";

function EscalationsRoute() {
  const user = useUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && !user.isAdmin) {
      void navigate({ to: "/" });
    }
  }, [user, navigate]);

  if (!user?.isAdmin) return null;
  return <EscalationsPage />;
}

export const Route = createFileRoute("/_shell/escalations")({
  component: EscalationsRoute,
});
