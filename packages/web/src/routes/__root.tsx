import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { UserContext } from "@/contexts/UserContext";
import type { User } from "@/contexts/UserContext";
import { PrivacyProvider } from "@/contexts/PrivacyContext";

function Root() {
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
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <div className="text-center space-y-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Edgebric</h1>
            <p className="text-sm text-slate-400 mt-1">Knowledge Assistant</p>
          </div>
          <a
            href="/api/auth/login"
            className="inline-block bg-slate-900 text-white rounded-xl px-6 py-3 text-sm font-medium hover:bg-slate-700 transition-colors"
          >
            Sign in
          </a>
        </div>
      </div>
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
