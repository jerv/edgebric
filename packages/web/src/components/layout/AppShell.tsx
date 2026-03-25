import { useState, useEffect } from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { Menu, X, EyeOff, ShieldCheck } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { cn } from "@/lib/utils";
import { usePrivacy } from "@/contexts/PrivacyContext";
import { useUser } from "@/contexts/UserContext";
import Logo from "../shared/Logo";

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { level, privacyMessages } = usePrivacy();
  const user = useUser();
  const navigate = useNavigate();

  // Redirect admin to onboarding if not complete
  useEffect(() => {
    if (user?.isAdmin && !user.onboardingComplete) {
      void navigate({ to: "/onboarding" });
    }
  }, [user, navigate]);

  // Warn on refresh/tab close if privacy mode has messages
  useEffect(() => {
    if (level === "standard" || privacyMessages.length === 0) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [level, privacyMessages.length]);

  return (
    <div className="flex h-screen bg-white dark:bg-gray-950 overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 border-r border-slate-200 dark:border-gray-800 flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Mobile drawer backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 w-64 bg-white dark:bg-gray-950 border-r border-slate-200 dark:border-gray-800 flex flex-col transition-transform duration-200 md:hidden",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-end px-4 pt-4">
          <button
            onClick={() => setDrawerOpen(false)}
            className="text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300 p-1"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <Sidebar onNavigate={() => setDrawerOpen(false)} />
      </aside>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Privacy mode indicator bar */}
        {level === "private" && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-100 dark:bg-gray-900 border-b border-slate-200 dark:border-gray-800 text-slate-600 dark:text-gray-400">
            <EyeOff className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">Private Mode — anonymous, not logged</span>
            <span className="text-[11px] text-slate-400 dark:text-gray-500 ml-1">Queries are processed on org servers</span>
          </div>
        )}
        {level === "vault" && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-emerald-50 dark:bg-emerald-950 border-b border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">Vault Mode — queries never leave your device</span>
            <span className="text-[11px] text-emerald-500 dark:text-emerald-400 ml-1">Conversation is lost on page refresh</span>
          </div>
        )}

        {/* Mobile header */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-gray-800 md:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 p-1"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <Logo className="w-6 h-6 rounded-md" />
          <span className="font-semibold text-slate-900 dark:text-gray-100 text-sm">Edgebric</span>
        </header>

        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
