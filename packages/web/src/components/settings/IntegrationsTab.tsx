/**
 * Organization-level integrations tab (admin-only).
 * Admin configures cloud provider OAuth credentials here.
 * In solo mode, shipped defaults are used — no setup needed.
 */
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Check, ChevronDown, Eye, EyeOff, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProviderLogo } from "@/components/shared/ProviderLogos";
import { useUser } from "@/contexts/UserContext";
import type { IntegrationConfig } from "@edgebric/types";

// ─── Integrations Tab ────────────────────────────────────────────────────────

export function IntegrationsTab() {
  const user = useUser();
  const isSolo = user?.authMode === "none";

  const { data: config, isLoading } = useQuery<IntegrationConfig>({
    queryKey: ["admin", "integrations"],
    queryFn: () =>
      fetch("/api/admin/integrations", { credentials: "same-origin" }).then(
        (r) => r.json() as Promise<IntegrationConfig>,
      ),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400 dark:text-gray-500" />
      </div>
    );
  }

  if (isSolo) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed">
            Cloud integrations are pre-configured. Go to{" "}
            <a href="/account?tab=connected-accounts" className="text-slate-900 dark:text-gray-100 underline">
              Account &gt; Connected Accounts
            </a>{" "}
            to connect your Google Drive, OneDrive, or Notion.
          </p>
        </div>
        <div className="border border-green-200 dark:border-green-900 rounded-xl px-4 py-3 bg-green-50 dark:bg-green-950">
          <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
            <Check className="w-4 h-4" />
            Using built-in credentials — no setup needed
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed">
          Configure cloud storage providers for your organization. Members connect their own
          accounts from{" "}
          <span className="text-slate-700 dark:text-gray-300">Account &gt; Connected Accounts</span>.
        </p>
      </div>

      <GoogleDriveCredentialsCard config={config} />
      <OneDriveCredentialsCard config={config} />
      <NotionCredentialsCard config={config} />
    </div>
  );
}

// ─── Google Drive Credentials Card ──────────────────────────────────────────

function GoogleDriveCredentialsCard({ config }: { config: IntegrationConfig | undefined }) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState(config?.googleDriveClientId ?? "");
  const [clientSecret, setClientSecret] = useState(config?.googleDriveClientSecret ?? "");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    setClientId(config?.googleDriveClientId ?? "");
    setClientSecret(config?.googleDriveClientSecret ?? "");
  }, [config?.googleDriveClientId, config?.googleDriveClientSecret]);

  const isConfigured = !!(config?.googleDriveClientId && config?.googleDriveClientSecret);
  const hasChanges = clientId !== (config?.googleDriveClientId ?? "") || clientSecret !== (config?.googleDriveClientSecret ?? "");

  async function handleSave() {
    if (!clientId.trim() || !clientSecret.trim()) {
      setError("Both Client ID and Client Secret are required");
      return;
    }
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/admin/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ googleDriveClientId: clientId.trim(), googleDriveClientSecret: clientSecret.trim() }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Failed to save");
        return;
      }
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["admin", "integrations"] });
      void queryClient.invalidateQueries({ queryKey: ["cloud-providers"] });
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    setError("");
    try {
      await fetch("/api/admin/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ googleDriveClientId: "", googleDriveClientSecret: "" }),
      });
      setClientId("");
      setClientSecret("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "integrations"] });
      void queryClient.invalidateQueries({ queryKey: ["cloud-providers"] });
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
          <ProviderLogo provider="google_drive" className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Google Drive</h3>
          <p className="text-xs text-slate-400 dark:text-gray-500">
            {isConfigured ? "Custom credentials configured" : "Not configured"}
          </p>
        </div>
        {isConfigured && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400">
            <Check className="w-3 h-3" />
            Enabled
          </span>
        )}
      </div>

      {/* Setup instructions */}
      <button
        onClick={() => setShowSetup(!showSetup)}
        className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 transition-colors"
      >
        <Info className="w-3.5 h-3.5" />
        Setup instructions
        <ChevronDown className={cn("w-3 h-3 transition-transform", showSetup && "rotate-180")} />
      </button>

      {showSetup && (
        <div className="text-xs text-slate-500 dark:text-gray-400 space-y-2 bg-slate-50 dark:bg-gray-900 rounded-xl px-4 py-3 border border-slate-100 dark:border-gray-800">
          <p className="font-medium text-slate-700 dark:text-gray-300">
            If you already have a Google Cloud project for OIDC login, use the same project:
          </p>
          <ol className="list-decimal list-inside space-y-1.5 ml-1">
            <li>Go to the <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-700 dark:hover:text-gray-300">Google Cloud Console</a> and enable the <strong>Google Drive API</strong></li>
            <li>Go to <strong>Credentials</strong> and create an <strong>OAuth 2.0 Client ID</strong> (type: Web application)</li>
            <li>Add this <strong>Authorized redirect URI</strong>:<br/>
              <code className="inline-block mt-1 px-2 py-0.5 bg-slate-100 dark:bg-gray-800 rounded text-[11px] font-mono select-all">
                {`${window.location.origin}/api/cloud-connections/oauth/callback`}
              </code>
            </li>
            <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> and paste them below</li>
          </ol>
          <div className="pt-2 border-t border-slate-200 dark:border-gray-700 mt-3">
            <p className="flex items-start gap-1.5">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0 text-blue-500" />
              <span>
                Set the OAuth consent screen to <strong className="text-slate-700 dark:text-gray-300">External</strong> if
                you want team members to also connect their personal Google accounts (e.g. personal Gmail).
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Credential inputs */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">Client ID</label>
          <input
            type="text"
            value={clientId}
            onChange={(e) => { setClientId(e.target.value); setSaved(false); }}
            placeholder="123456789-abcdef.apps.googleusercontent.com"
            className="w-full px-3 py-1.5 text-sm border border-slate-200 dark:border-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 dark:bg-gray-950 dark:text-gray-100 font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">Client Secret</label>
          <div className="relative">
            <input
              type={showSecret ? "text" : "password"}
              value={clientSecret}
              onChange={(e) => { setClientSecret(e.target.value); setSaved(false); }}
              placeholder="GOCSPX-..."
              className="w-full px-3 py-1.5 pr-9 text-sm border border-slate-200 dark:border-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 dark:bg-gray-950 dark:text-gray-100 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300"
            >
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p className="text-xs text-green-600 dark:text-green-400">Credentials saved.</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges || !clientId.trim() || !clientSecret.trim()}
          className="px-3 py-1.5 text-sm bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {isConfigured && (
          <button
            onClick={handleRemove}
            disabled={saving}
            className="px-3 py-1.5 text-sm text-slate-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

// ─── OneDrive Credentials Card ──────────────────────────────────────────────

function OneDriveCredentialsCard({ config }: { config: IntegrationConfig | undefined }) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState(config?.onedriveClientId ?? "");
  const [clientSecret, setClientSecret] = useState(config?.onedriveClientSecret ?? "");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    setClientId(config?.onedriveClientId ?? "");
    setClientSecret(config?.onedriveClientSecret ?? "");
  }, [config?.onedriveClientId, config?.onedriveClientSecret]);

  const isConfigured = !!(config?.onedriveClientId && config?.onedriveClientSecret);
  const hasChanges = clientId !== (config?.onedriveClientId ?? "") || clientSecret !== (config?.onedriveClientSecret ?? "");

  async function handleSave() {
    if (!clientId.trim() || !clientSecret.trim()) {
      setError("Both Client ID and Client Secret are required");
      return;
    }
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/admin/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ onedriveClientId: clientId.trim(), onedriveClientSecret: clientSecret.trim() }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Failed to save");
        return;
      }
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["admin", "integrations"] });
      void queryClient.invalidateQueries({ queryKey: ["cloud-providers"] });
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    setError("");
    try {
      await fetch("/api/admin/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ onedriveClientId: "", onedriveClientSecret: "" }),
      });
      setClientId("");
      setClientSecret("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "integrations"] });
      void queryClient.invalidateQueries({ queryKey: ["cloud-providers"] });
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
          <ProviderLogo provider="onedrive" className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">OneDrive / SharePoint</h3>
          <p className="text-xs text-slate-400 dark:text-gray-500">
            {isConfigured ? "Custom credentials configured" : "Not configured"}
          </p>
        </div>
        {isConfigured && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400">
            <Check className="w-3 h-3" />
            Enabled
          </span>
        )}
      </div>

      {/* Setup instructions */}
      <button
        onClick={() => setShowSetup(!showSetup)}
        className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 transition-colors"
      >
        <Info className="w-3.5 h-3.5" />
        Setup instructions
        <ChevronDown className={cn("w-3 h-3 transition-transform", showSetup && "rotate-180")} />
      </button>

      {showSetup && (
        <div className="text-xs text-slate-500 dark:text-gray-400 space-y-2 bg-slate-50 dark:bg-gray-900 rounded-xl px-4 py-3 border border-slate-100 dark:border-gray-800">
          <p className="font-medium text-slate-700 dark:text-gray-300">
            Register an app in Microsoft Entra ID (Azure AD):
          </p>
          <ol className="list-decimal list-inside space-y-1.5 ml-1">
            <li>Go to the <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-700 dark:hover:text-gray-300">Microsoft Entra admin center</a> &gt; App registrations &gt; <strong>New registration</strong></li>
            <li>Set <strong>Supported account types</strong> to &quot;Accounts in any organizational directory and personal Microsoft accounts&quot;</li>
            <li>Add a <strong>Web</strong> redirect URI:<br/>
              <code className="inline-block mt-1 px-2 py-0.5 bg-slate-100 dark:bg-gray-800 rounded text-[11px] font-mono select-all">
                {`${window.location.origin}/api/cloud-connections/oauth/callback`}
              </code>
            </li>
            <li>Go to <strong>Certificates &amp; secrets</strong> &gt; <strong>New client secret</strong> and copy the <strong>Value</strong></li>
            <li>Copy the <strong>Application (client) ID</strong> from the Overview page</li>
            <li>Go to <strong>API permissions</strong> &gt; Add: <strong>Microsoft Graph</strong> &gt; Delegated &gt; <code className="text-[11px]">Files.Read.All</code>, <code className="text-[11px]">User.Read</code>, <code className="text-[11px]">offline_access</code></li>
          </ol>
          <div className="pt-2 border-t border-slate-200 dark:border-gray-700 mt-3">
            <p className="flex items-start gap-1.5">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0 text-blue-500" />
              <span>
                For <strong className="text-slate-700 dark:text-gray-300">SharePoint</strong> access, users must consent to the app with their work account. The same app registration works for both OneDrive and SharePoint.
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Credential inputs */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">Application (client) ID</label>
          <input
            type="text"
            value={clientId}
            onChange={(e) => { setClientId(e.target.value); setSaved(false); }}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="w-full px-3 py-1.5 text-sm border border-slate-200 dark:border-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 dark:bg-gray-950 dark:text-gray-100 font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">Client Secret</label>
          <div className="relative">
            <input
              type={showSecret ? "text" : "password"}
              value={clientSecret}
              onChange={(e) => { setClientSecret(e.target.value); setSaved(false); }}
              placeholder="Client secret value"
              className="w-full px-3 py-1.5 pr-9 text-sm border border-slate-200 dark:border-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 dark:bg-gray-950 dark:text-gray-100 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300"
            >
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p className="text-xs text-green-600 dark:text-green-400">Credentials saved.</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges || !clientId.trim() || !clientSecret.trim()}
          className="px-3 py-1.5 text-sm bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {isConfigured && (
          <button
            onClick={handleRemove}
            disabled={saving}
            className="px-3 py-1.5 text-sm text-slate-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Notion Credentials Card ───────────────────────────────────────────────

function NotionCredentialsCard({ config }: { config: IntegrationConfig | undefined }) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState(config?.notionClientId ?? "");
  const [clientSecret, setClientSecret] = useState(config?.notionClientSecret ?? "");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    setClientId(config?.notionClientId ?? "");
    setClientSecret(config?.notionClientSecret ?? "");
  }, [config?.notionClientId, config?.notionClientSecret]);

  const isConfigured = !!(config?.notionClientId && config?.notionClientSecret);
  const hasChanges = clientId !== (config?.notionClientId ?? "") || clientSecret !== (config?.notionClientSecret ?? "");

  async function handleSave() {
    if (!clientId.trim() || !clientSecret.trim()) {
      setError("Both OAuth Client ID and OAuth Client Secret are required");
      return;
    }
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/admin/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ notionClientId: clientId.trim(), notionClientSecret: clientSecret.trim() }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Failed to save");
        return;
      }
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["admin", "integrations"] });
      void queryClient.invalidateQueries({ queryKey: ["cloud-providers"] });
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    setError("");
    try {
      await fetch("/api/admin/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ notionClientId: "", notionClientSecret: "" }),
      });
      setClientId("");
      setClientSecret("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "integrations"] });
      void queryClient.invalidateQueries({ queryKey: ["cloud-providers"] });
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
          <ProviderLogo provider="notion" className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Notion</h3>
          <p className="text-xs text-slate-400 dark:text-gray-500">
            {isConfigured ? "Custom credentials configured" : "Not configured — no built-in defaults"}
          </p>
        </div>
        {isConfigured && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400">
            <Check className="w-3 h-3" />
            Enabled
          </span>
        )}
      </div>

      {/* Setup instructions */}
      <button
        onClick={() => setShowSetup(!showSetup)}
        className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-300 transition-colors"
      >
        <Info className="w-3.5 h-3.5" />
        Setup instructions
        <ChevronDown className={cn("w-3 h-3 transition-transform", showSetup && "rotate-180")} />
      </button>

      {showSetup && (
        <div className="text-xs text-slate-500 dark:text-gray-400 space-y-2 bg-slate-50 dark:bg-gray-900 rounded-xl px-4 py-3 border border-slate-100 dark:border-gray-800">
          <p className="font-medium text-slate-700 dark:text-gray-300">
            Create a Notion integration (public OAuth):
          </p>
          <ol className="list-decimal list-inside space-y-1.5 ml-1">
            <li>Go to <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-700 dark:hover:text-gray-300">notion.so/my-integrations</a> and click <strong>New integration</strong></li>
            <li>Set the type to <strong>Public</strong> (required for OAuth)</li>
            <li>Under <strong>Capabilities</strong>, enable <strong>Read content</strong> and <strong>Read user information including email addresses</strong></li>
            <li>Add this <strong>Redirect URI</strong>:<br/>
              <code className="inline-block mt-1 px-2 py-0.5 bg-slate-100 dark:bg-gray-800 rounded text-[11px] font-mono select-all">
                {`${window.location.origin}/api/cloud-connections/oauth/callback`}
              </code>
            </li>
            <li>Copy the <strong>OAuth client ID</strong> and <strong>OAuth client secret</strong> from the integration&apos;s Secrets tab</li>
          </ol>
          <div className="pt-2 border-t border-slate-200 dark:border-gray-700 mt-3">
            <p className="flex items-start gap-1.5">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0 text-blue-500" />
              <span>
                During OAuth, users choose which pages and databases to share with Edgebric.
                Notion does not have pre-defined scopes — access is granted per-page.
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Credential inputs */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">OAuth Client ID</label>
          <input
            type="text"
            value={clientId}
            onChange={(e) => { setClientId(e.target.value); setSaved(false); }}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="w-full px-3 py-1.5 text-sm border border-slate-200 dark:border-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 dark:bg-gray-950 dark:text-gray-100 font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-gray-400 mb-1">OAuth Client Secret</label>
          <div className="relative">
            <input
              type={showSecret ? "text" : "password"}
              value={clientSecret}
              onChange={(e) => { setClientSecret(e.target.value); setSaved(false); }}
              placeholder="secret_..."
              className="w-full px-3 py-1.5 pr-9 text-sm border border-slate-200 dark:border-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 dark:bg-gray-950 dark:text-gray-100 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300"
            >
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p className="text-xs text-green-600 dark:text-green-400">Credentials saved.</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges || !clientId.trim() || !clientSecret.trim()}
          className="px-3 py-1.5 text-sm bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {isConfigured && (
          <button
            onClick={handleRemove}
            disabled={saving}
            className="px-3 py-1.5 text-sm text-slate-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
