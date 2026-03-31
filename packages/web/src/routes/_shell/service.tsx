import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useUser } from "@/contexts/UserContext";
import { ServiceTab } from "@/components/settings/orgTabs";

function ServiceRoute() {
  const user = useUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && !user.isAdmin) {
      void navigate({ to: "/" });
    }
  }, [user, navigate]);

  if (!user?.isAdmin) return null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-gray-100">Service</h1>
        <ServiceTab />
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_shell/service")({
  component: ServiceRoute,
});
