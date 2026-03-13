import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserContext } from "@/contexts/UserContext";
import type { User } from "@/contexts/UserContext";
import { PrivacyProvider } from "@/contexts/PrivacyContext";
import { OrgPicker } from "@/components/OrgPicker";
import { LoginPage } from "@/components/LoginPage";
import { NameSetup } from "@/components/NameSetup";

function Root() {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["me"],
    queryFn: async () => {
      const r = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (!r.ok) return null;
      return r.json() as Promise<User>;
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  // User is authenticated but has no org selected — show org picker
  if (!user.orgId) {
    return (
      <OrgPicker
        onSelected={() => {
          void queryClient.invalidateQueries({ queryKey: ["me"] });
        }}
      />
    );
  }

  // User needs to set their name (first sign-in)
  if (user.needsNameSetup) {
    return (
      <NameSetup
        onComplete={() => {
          void queryClient.invalidateQueries({ queryKey: ["me"] });
        }}
      />
    );
  }

  return (
    <UserContext.Provider value={user}>
      <PrivacyProvider>
        <Outlet />
      </PrivacyProvider>
    </UserContext.Provider>
  );
}

export const Route = createRootRoute({
  component: Root,
});
