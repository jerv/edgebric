import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useUser } from "@/contexts/UserContext";
import { KnowledgeBasePanel } from "@/components/admin/KnowledgeBasePanel";

function KnowledgeBaseRoute() {
  const user = useUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && !user.isAdmin) {
      void navigate({ to: "/" });
    }
  }, [user, navigate]);

  if (!user?.isAdmin) return null;
  return <KnowledgeBasePanel />;
}

export const Route = createFileRoute("/_shell/library")({
  component: KnowledgeBaseRoute,
});
