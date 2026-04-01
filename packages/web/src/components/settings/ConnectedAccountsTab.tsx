/**
 * Connected Accounts tab — lives under Account settings.
 * Any user (admin or member) can connect their own cloud accounts here.
 */
import { useState } from "react";
import { Loader2, ExternalLink, AlertTriangle, Trash2, Check, Cloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProviderLogo } from "@/components/shared/ProviderLogos";
import {
  useCloudProviders,
  useCloudConnections,
  useConnectProvider,
  useDeleteConnection,
} from "@/hooks/useCloudConnections";
import type { CloudProvider } from "@edgebric/types";

export function ConnectedAccountsTab() {
  const { data: providersData, isLoading: providersLoading } = useCloudProviders();
  const { data: connectionsData, isLoading: connectionsLoading } = useCloudConnections();
  const connectMutation = useConnectProvider();
  const deleteMutation = useDeleteConnection();
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);

  const providers = (providersData?.providers ?? []).filter((p) => p.enabled);
  const connections = connectionsData?.connections ?? [];
  const isLoading = providersLoading || connectionsLoading;

  function handleConnect(provider: CloudProvider) {
    connectMutation.mutate({ provider, returnTo: "/account?tab=connected-accounts" }, {
      onSuccess: (data) => {
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
          Connect your cloud storage accounts to sync files into Edgebric. You can connect
          both work and personal accounts.
        </p>
      </div>

      {/* Connected accounts */}
      {connections.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
            Your accounts
          </h3>
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-gray-800"
            >
              <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                <ProviderLogo provider={conn.provider} className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900 dark:text-gray-100 truncate">
                    {conn.accountEmail ?? conn.displayName}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400">
                    <Check className="w-3 h-3" />
                    Connected
                  </span>
                </div>
                <p className="text-xs text-slate-400 dark:text-gray-500">{conn.displayName}</p>
              </div>
              {confirmDisconnect === conn.id ? (
                <span className="flex items-center gap-1.5 flex-shrink-0 text-xs">
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
                  title="Disconnect account"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Available providers to connect */}
      {providers.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">
            Connect an account
          </h3>
          {providers.map((provider) => {
            const isConnecting = connectMutation.isPending && connectMutation.variables?.provider === provider.id;
            return (
              <button
                key={provider.id}
                onClick={() => handleConnect(provider.id)}
                disabled={connectMutation.isPending}
                className={cn(
                  "flex items-center gap-3 w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-gray-800",
                  "hover:border-slate-300 dark:hover:border-gray-700 transition-colors text-left",
                  "disabled:opacity-50",
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                  <ProviderLogo provider={provider.id} className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-slate-900 dark:text-gray-100">{provider.name}</span>
                  <p className="text-xs text-slate-500 dark:text-gray-400 truncate">{provider.description}</p>
                </div>
                {isConnecting ? (
                  <Loader2 className="w-4 h-4 animate-spin text-slate-400 dark:text-gray-500 flex-shrink-0" />
                ) : (
                  <ExternalLink className="w-4 h-4 text-slate-400 dark:text-gray-500 flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {providers.length === 0 && connections.length === 0 && (
        <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-8 text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-gray-800 flex items-center justify-center mx-auto">
            <Cloud className="w-5 h-5 text-slate-400 dark:text-gray-500" />
          </div>
          <p className="text-sm text-slate-500 dark:text-gray-400">
            No cloud providers are enabled yet. Ask your administrator to set up cloud integrations
            in Organization settings.
          </p>
        </div>
      )}

      {connectMutation.isError && (
        <div className="flex items-start gap-2 text-xs rounded-xl px-3 py-2 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{connectMutation.error.message}</span>
        </div>
      )}

      <div className="text-xs text-slate-400 dark:text-gray-500 leading-relaxed">
        Connecting an account opens the provider's authorization page. Edgebric only requests
        read-only access to your files. You can connect both your work account and personal
        accounts (e.g. personal Gmail).
      </div>
    </div>
  );
}
