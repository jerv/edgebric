import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useUser } from "@/contexts/UserContext";
import { AnalyticsDashboard } from "@/components/admin/AnalyticsDashboard";
import type { AnalyticsTab } from "@/components/admin/AnalyticsDashboard";

const VALID_TABS: AnalyticsTab[] = ["overview", "topics", "escalations", "feedback"];

function AnalyticsRoute() {
  const user = useUser();
  const navigate = useNavigate();
  const { tab } = Route.useSearch();

  useEffect(() => {
    if (user && !user.isAdmin) {
      void navigate({ to: "/" });
    }
  }, [user, navigate]);

  if (!user?.isAdmin) return null;
  return <AnalyticsDashboard tab={tab} />;
}

export const Route = createFileRoute("/_shell/analytics")({
  component: AnalyticsRoute,
  validateSearch: (search: Record<string, unknown>): { tab: AnalyticsTab } => ({
    tab: VALID_TABS.includes(search["tab"] as AnalyticsTab)
      ? (search["tab"] as AnalyticsTab)
      : "overview",
  }),
});
