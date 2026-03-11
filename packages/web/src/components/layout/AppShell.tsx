import { useState, useEffect } from "react";
import { Outlet } from "@tanstack/react-router";
import { Menu, X, Lock, Shield } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { cn } from "@/lib/utils";
import { usePrivacy } from "@/contexts/PrivacyContext";

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { level, privacyMessages } = usePrivacy();

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
    <div className="flex h-screen bg-white overflow-hidden">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r border-slate-200 flex-shrink-0 transition-all duration-200",
          sidebarCollapsed ? "w-14" : "w-60",
        )}
      >
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        />
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
          "fixed inset-y-0 left-0 z-30 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 md:hidden",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-end px-4 pt-4">
          <button
            onClick={() => setDrawerOpen(false)}
            className="text-slate-400 hover:text-slate-600 p-1"
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
          <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-100 border-b border-slate-200 text-slate-600">
            <Lock className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">Private Mode — anonymous, not logged</span>
            <span className="text-[11px] text-slate-400 ml-1">Queries are processed on org servers</span>
          </div>
        )}
        {level === "vault" && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-emerald-50 border-b border-emerald-200 text-emerald-700">
            <Shield className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">Vault Mode — queries never leave your device</span>
            <span className="text-[11px] text-emerald-500 ml-1">Conversation is lost on page refresh</span>
          </div>
        )}

        {/* Mobile header */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 md:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-slate-500 hover:text-slate-700 p-1"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-semibold text-slate-900 text-sm">Edgebric</span>
        </header>

        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
