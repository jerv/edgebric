import { createFileRoute, redirect } from "@tanstack/react-router";

// /admin/ is no longer the auth entry point — OIDC login is handled by __root.tsx.
// Redirect any direct visits to the main app.
export const Route = createFileRoute("/admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
  component: () => null,
});
