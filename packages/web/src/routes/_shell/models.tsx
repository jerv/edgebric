import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useUser } from "@/contexts/UserContext";
import { ModelsPanel } from "@/components/admin/ModelsPanel";

function ModelsRoute() {
  const user = useUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && !user.isAdmin) {
      void navigate({ to: "/" });
    }
  }, [user, navigate]);

  if (!user?.isAdmin) return null;
  return <ModelsPanel />;
}

export const Route = createFileRoute("/_shell/models")({
  component: ModelsRoute,
});
