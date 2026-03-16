import { createRootRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserContext } from "@/contexts/UserContext";
import type { User } from "@/contexts/UserContext";
import { PrivacyProvider } from "@/contexts/PrivacyContext";
import { OrgPicker } from "@/components/OrgPicker";
import { LoginPage } from "@/components/LoginPage";
import { NameSetup } from "@/components/NameSetup";
import { Toaster } from "@/components/ui/Toaster";

function NotFoundPage() {
  const router = useRouter();
  return (
    <div className="h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <div className="text-7xl font-bold text-slate-100 select-none">404</div>
        <h1 className="mt-4 text-xl font-semibold text-slate-800">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <button
          onClick={() => router.navigate({ to: "/" })}
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to home
        </button>
      </div>
    </div>
  );
}

function ErrorPage({ error }: { error: Error }) {
  const isNetworkError = error.message?.includes("fetch") || error.message?.includes("network");
  return (
    <div className="h-screen flex items-center justify-center bg-white">
      <div className="text-center max-w-md px-6">
        <div className="mx-auto w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
          <svg className="w-6 h-6 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-slate-800">
          {isNetworkError ? "Connection lost" : "Something went wrong"}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {isNetworkError
            ? "Check your network connection and try again."
            : error.message || "An unexpected error occurred."}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors"
          >
            Reload page
          </button>
          <button
            onClick={() => { window.location.href = "/"; }}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors"
          >
            Go home
          </button>
        </div>
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
        <Toaster />
      </PrivacyProvider>
    </UserContext.Provider>
  );
}

export const Route = createRootRoute({
  component: Root,
  notFoundComponent: NotFoundPage,
  errorComponent: ({ error }) => <ErrorPage error={error as Error} />,
});
