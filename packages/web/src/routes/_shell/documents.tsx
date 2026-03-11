import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useUser } from "@/contexts/UserContext";
import { DocumentsPanel } from "@/components/admin/DocumentsPanel";

function DocumentsRoute() {
  const user = useUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && !user.isAdmin) {
      void navigate({ to: "/" });
    }
  }, [user, navigate]);

  if (!user?.isAdmin) return null;
  return <DocumentsPanel />;
}

export const Route = createFileRoute("/_shell/documents")({
  component: DocumentsRoute,
});
