import { createFileRoute } from "@tanstack/react-router";
import { LogOut, User } from "lucide-react";
import { useUser } from "@/contexts/UserContext";

function AccountPanel() {
  const user = useUser();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    window.location.href = "/api/auth/login";
  }

  const displayName = user?.email
    ? user.email.split("@")[0]?.replace(/[._]/g, " ") ?? user.email
    : "Employee";

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Account</h1>
        </div>

        {/* Profile card */}
        <div className="border border-slate-200 rounded-2xl p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
              <User className="w-5 h-5 text-slate-500" />
            </div>
            <div>
              <p className="font-medium text-slate-900 capitalize">{displayName}</p>
              {user?.email && (
                <p className="text-sm text-slate-400">{user.email}</p>
              )}
              {user?.isAdmin && (
                <span className="inline-block text-xs bg-slate-900 text-white px-2 py-0.5 rounded-full mt-1">
                  Admin
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Sign out */}
        <button
          onClick={() => void signOut()}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-red-600 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_shell/account")({
  component: AccountPanel,
});
