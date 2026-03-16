import { createRootRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserContext } from "@/contexts/UserContext";
import type { User } from "@/contexts/UserContext";
import { PrivacyProvider } from "@/contexts/PrivacyContext";
import { OrgPicker } from "@/components/OrgPicker";
import { LoginPage } from "@/components/LoginPage";
import { NameSetup } from "@/components/NameSetup";

function NotFoundPage() {
  const router = useRouter();
  return (
    <div className="h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-slate-200">404</h1>
        <p className="mt-2 text-lg text-slate-500">Page not found</p>
        <button
          onClick={() => router.navigate({ to: "/" })}
          className="mt-6 px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800"
        >
          Go home
        </button>
      </div>
    </div>
  );
}

function ErrorPage({ error }: { error: Error }) {
  return (
    <div className="h-screen flex items-center justify-center bg-white">
      <div className="text-center max-w-md">
        <h1 className="text-6xl font-bold text-slate-200">Error</h1>
        <p className="mt-2 text-lg text-slate-500">Something went wrong</p>
        <p className="mt-2 text-sm text-slate-400">{error.message}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800"
        >
          Reload page
        </button>
      </div>
    </div>
  );
}

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
  notFoundComponent: NotFoundPage,
  errorComponent: ({ error }) => <ErrorPage error={error as Error} />,
});
