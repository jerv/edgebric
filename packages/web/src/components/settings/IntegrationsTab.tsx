/**
 * Organization-level integrations tab.
 * Admin sets up cloud provider OAuth here (one-time setup).
 * Members interact with cloud storage from the data source UI.
 */
import { useState } from "react";
import { Loader2, ExternalLink, AlertTriangle, Trash2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCloudProviders,
  useCloudConnections,
  useConnectProvider,
  useDeleteConnection,
} from "@/hooks/useCloudConnections";
import type { CloudProvider } from "@edgebric/types";

// ─── Brand Logos (inline SVG) ────────────────────────────────────────────────

function GoogleDriveLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5l5.4 9.35z" fill="#0066DA"/>
      <path d="M43.65 25.15L29.9 1.35c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5l16.15-28z" fill="#00AC47"/>
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 57.7c.8-1.4 1.2-2.95 1.2-4.5H59.8l6.1 11.8 7.65 11.8z" fill="#EA4335"/>
      <path d="M43.65 25.15L57.4 1.35a9.39 9.39 0 0 0-4.5-1.35H34.4c-1.6 0-3.15.45-4.5 1.35l13.75 23.8z" fill="#00832D"/>
      <path d="M59.8 53.15h-32.3L13.75 76.95c1.35.8 2.9 1.25 4.5 1.25h22.5c1.6 0 3.15-.45 4.5-1.25l14.55-23.8z" fill="#2684FC"/>
      <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25.15l16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5L73.4 26.5z" fill="#FFBA00"/>
    </svg>
  );
}

function OneDriveLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M14.22 9.59c.46-.79 1.17-1.4 2.03-1.73a3.98 3.98 0 0 1 2.66-.05A5.49 5.49 0 0 0 9.4 6.1a4.46 4.46 0 0 1 4.82 3.49z" fill="#0364B8"/>
      <path d="M14.22 9.59A4.46 4.46 0 0 0 9.4 6.1a4.47 4.47 0 0 0-3.99 2.47A3.97 3.97 0 0 0 1 12.48a3.97 3.97 0 0 0 3.97 3.97h8.46l.79-6.86z" fill="#0078D4"/>
      <path d="M18.91 7.81a3.98 3.98 0 0 0-2.66.05 3.98 3.98 0 0 0-2.03 1.73l.79 6.86h5.96A3.01 3.01 0 0 0 24 13.44a3.01 3.01 0 0 0-3.01-3.01 2.96 2.96 0 0 0-.76.1l-.14-.04a3.98 3.98 0 0 0-1.18-2.68z" fill="#1490DF"/>
      <path d="M13.43 16.45H4.97A3.97 3.97 0 0 0 8.94 20.42h10.03A3.01 3.01 0 0 0 22 17.41a3.01 3.01 0 0 0-1.03-2.27l-7.54 1.31z" fill="#28A8EA"/>
    </svg>
  );
}

function ProviderLogo({ provider, className }: { provider: string; className?: string }) {
  const size = className ?? "w-5 h-5";
  switch (provider) {
    case "google_drive": return <GoogleDriveLogo className={size} />;
    case "onedrive": return <OneDriveLogo className={size} />;
    default: return <div className={cn(size, "rounded bg-slate-200 dark:bg-gray-700")} />;
  }
}

// ─── Integrations Tab ────────────────────────────────────────────────────────

export function IntegrationsTab() {
  const { data: providersData, isLoading: providersLoading } = useCloudProviders();
  const { data: connectionsData, isLoading: connectionsLoading } = useCloudConnections();
  const connectMutation = useConnectProvider();
  const deleteMutation = useDeleteConnection();
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);

  const providers = providersData?.providers ?? [];
  const connections = connectionsData?.connections ?? [];
  const isLoading = providersLoading || connectionsLoading;

  // Check which providers already have at least one admin connection
  const connectedProviders = new Set(connections.map((c) => c.provider));

  function handleConnect(provider: CloudProvider) {
    connectMutation.mutate({ provider }, {
      onSuccess: (data) => {
        // Use window.open so Electron's setWindowOpenHandler intercepts it
        // and opens in the user's default browser (where they're already logged in)
        window.open(data.authUrl, "_blank");
      },
    });
  }

  function handleDisconnect(id: string) {
    deleteMutation.mutate(id, {
      onSuccess: () => setConfirmDisconnect(null),
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400 dark:text-gray-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed">
          Enable cloud storage providers for your organization. Once enabled, members can
          sync files from their own cloud accounts into data sources.
        </p>
      </div>

      {/* Provider list */}
      <div className="space-y-2">
        {providers.map((provider) => {
          const isConnected = connectedProviders.has(provider.id);
          const isConnecting = connectMutation.isPending && connectMutation.variables?.provider === provider.id;
          const providerConnections = connections.filter((c) => c.provider === provider.id);

          return (
            <div
              key={provider.id}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl border",
                provider.enabled
                  ? "border-slate-200 dark:border-gray-800"
                  : "border-slate-100 dark:border-gray-900 opacity-50",
              )}
            >
              <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                <ProviderLogo provider={provider.id} className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900 dark:text-gray-100">{provider.name}</span>
                  {!provider.enabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-500">
                      Coming soon
                    </span>
                  )}
                  {isConnected && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400">
                      <Check className="w-3 h-3" />
                      Enabled
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-gray-400 truncate">{provider.description}</p>
                {providerConnections.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {providerConnections.map((conn) => (
                      <div key={conn.id} className="flex items-center gap-2 text-xs text-slate-500 dark:text-gray-400">
                        <span className="truncate">{conn.accountEmail ?? conn.displayName}</span>
                        {confirmDisconnect === conn.id ? (
                          <span className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => handleDisconnect(conn.id)}
                              className="text-red-600 dark:text-red-400 hover:underline"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmDisconnect(null)}
                              className="text-slate-400 dark:text-gray-500 hover:underline"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmDisconnect(conn.id)}
                            className="text-slate-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 flex-shrink-0"
                            title="Disconnect"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {provider.enabled && !isConnected && (
                <button
                  onClick={() => handleConnect(provider.id)}
                  disabled={connectMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-slate-800 dark:hover:bg-gray-200 transition-colors disabled:opacity-50"
                >
                  {isConnecting ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ExternalLink className="w-3 h-3" />
                  )}
                  Enable
                </button>
              )}
            </div>
          );
        })}
      </div>

      {connectMutation.isError && (
        <div className="flex items-start gap-2 text-xs rounded-xl px-3 py-2 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{connectMutation.error.message}</span>
        </div>
      )}

      <div className="text-xs text-slate-400 dark:text-gray-500 leading-relaxed">
        Enabling a provider opens their authorization page. Edgebric only requests read-only access.
        Once enabled, organization members can connect their own accounts and choose which folders
        to sync from within each data source.
      </div>
    </div>
  );
}
