import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

interface OrgEntry {
  id: string;
  name: string;
  slug: string;
  role: string;
  selected: boolean;
}

interface Props {
  onSelected: () => void;
}

export function OrgPicker({ onSelected }: Props) {
  const [selecting, setSelecting] = useState<string | null>(null);

  const { data: orgs, isLoading } = useQuery<OrgEntry[]>({
    queryKey: ["auth-orgs"],
    queryFn: async () => {
      const r = await fetch("/api/auth/orgs", { credentials: "same-origin" });
      if (!r.ok) return [];
      return r.json() as Promise<OrgEntry[]>;
    },
  });

  async function selectOrg(orgId: string) {
    setSelecting(orgId);
    try {
      const r = await fetch("/api/auth/select-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ orgId }),
      });
      if (r.ok) {
        onSelected();
      }
    } finally {
      setSelecting(null);
    }
  }

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <div className="text-slate-400 text-sm">Loading organizations…</div>
      </div>
    );
  }

  // If user has exactly one org, auto-select it
  if (orgs && orgs.length === 1) {
    if (!selecting) {
      void selectOrg(orgs[0]!.id);
    }
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <div className="text-slate-400 text-sm">Signing in…</div>
      </div>
    );
  }

  // No orgs — shouldn't happen normally, but handle it
  if (!orgs || orgs.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <div className="text-center space-y-4">
          <h1 className="text-xl font-semibold text-slate-900">No Organizations</h1>
          <p className="text-sm text-slate-500 max-w-xs">
            You don't belong to any organization yet. Ask an admin to invite you.
          </p>
          <a
            href="/api/auth/logout-redirect"
            onClick={(e) => {
              e.preventDefault();
              void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
                .then(() => { window.location.href = "/"; });
            }}
            className="inline-block text-sm text-slate-400 hover:text-slate-600"
          >
            Sign out
          </a>
        </div>
      </div>
    );
  }

  // Multiple orgs — show picker
  return (
    <div className="h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <h1 className="text-xl font-semibold text-slate-900">Select Organization</h1>
          <p className="text-sm text-slate-400 mt-1">Choose which workspace to open</p>
        </div>

        <div className="space-y-2">
          {orgs.map((org) => (
            <button
              key={org.id}
              onClick={() => void selectOrg(org.id)}
              disabled={!!selecting}
              className="w-full flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3.5 hover:border-slate-300 hover:bg-slate-50 transition-all disabled:opacity-50 text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-slate-900 flex items-center justify-center text-white text-sm font-semibold shrink-0">
                {org.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-900 truncate">{org.name}</div>
                <div className="text-xs text-slate-400">{org.role}</div>
              </div>
              {selecting === org.id && (
                <div className="text-xs text-slate-400">Loading…</div>
              )}
            </button>
          ))}
        </div>

        <div className="text-center mt-6">
          <a
            href="/api/auth/logout-redirect"
            onClick={(e) => {
              e.preventDefault();
              void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
                .then(() => { window.location.href = "/"; });
            }}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            Sign in with a different account
          </a>
        </div>
      </div>
    </div>
  );
}
