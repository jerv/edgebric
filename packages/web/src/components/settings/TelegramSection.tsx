/**
 * Telegram Bot integration section — admin settings and user account linking.
 *
 * Admin: toggle, bot token, webhook registration.
 * User: link/unlink Telegram account.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Check, Eye, EyeOff, Link2, Unlink, Copy, Globe, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

interface TelegramAdminStatus {
  enabled: boolean;
  hasToken: boolean;
  webhookRegistered: boolean;
  webhookUrl: string | null;
  pendingUpdates: number;
}

interface TelegramLinkStatus {
  linked: boolean;
  telegramUsername?: string | null;
  linkedAt?: string;
}

// ─── Admin Section ─────────────────────────────────────────────────────────

export function TelegramAdminSection() {
  const queryClient = useQueryClient();
  const [botToken, setBotToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const { data: status, isLoading } = useQuery<TelegramAdminStatus>({
    queryKey: ["admin", "telegram-status"],
    queryFn: () =>
      fetch("/api/telegram/admin/status", { credentials: "same-origin" }).then(
        (r) => r.json() as Promise<TelegramAdminStatus>,
      ),
  });

  async function handleToggle() {
    setSaving(true);
    setError("");
    try {
      const newEnabled = !(status?.enabled ?? false);
      const res = await fetch("/api/telegram/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ enabled: newEnabled }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to update");
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["admin", "telegram-status"] });
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveToken() {
    if (!botToken.trim()) {
      setError("Bot token is required");
      return;
    }
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/telegram/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ botToken: botToken.trim(), enabled: true }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to save");
        return;
      }
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["admin", "telegram-status"] });
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveToken() {
    setSaving(true);
    setError("");
    try {
      await fetch("/api/telegram/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ botToken: "", enabled: false }),
      });
      setBotToken("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "telegram-status"] });
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleRegisterWebhook() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/telegram/admin/register-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to register webhook");
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["admin", "telegram-status"] });
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteWebhook() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/telegram/admin/webhook", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to delete webhook");
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["admin", "telegram-status"] });
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5">
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400 dark:text-gray-500" />
        </div>
      </div>
    );
  }

  return (
    <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center flex-shrink-0">
          <MessageCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Telegram Bot</h3>
          <p className="text-xs text-slate-400 dark:text-gray-500">
            Let users query Edgebric via Telegram
          </p>
        </div>
        {/* Toggle */}
        <button
          onClick={handleToggle}
          disabled={saving || (!status?.hasToken && !status?.enabled)}
          className={cn(
            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
            status?.enabled
              ? "bg-green-500 dark:bg-green-600"
              : "bg-slate-200 dark:bg-gray-700",
            (saving || (!status?.hasToken && !status?.enabled)) && "opacity-50 cursor-not-allowed",
          )}
          title={!status?.hasToken ? "Add a bot token first" : status.enabled ? "Disable" : "Enable"}
        >
          <span
            className={cn(
              "inline-block h-4 w-4 rounded-full bg-white transition-transform",
              status?.enabled ? "translate-x-6" : "translate-x-1",
            )}
          />
        </button>
      </div>

      {/* Status badges */}
      <div className="flex flex-wrap gap-2">
        <span className={cn(
          "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full",
          status?.enabled
            ? "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400"
            : "bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400",
        )}>
          {status?.enabled ? <Check className="w-3 h-3" /> : null}
          {status?.enabled ? "Enabled" : "Disabled"}
        </span>
        {status?.hasToken && (
          <span className={cn(
            "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full",
            status.webhookRegistered
              ? "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400"
              : "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400",
          )}>
            <Globe className="w-3 h-3" />
            {status.webhookRegistered ? "Webhook active" : "Webhook not registered"}
          </span>
        )}
      </div>

      {/* Bot token input */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-slate-500 dark:text-gray-400">
          Bot Token <span className="text-slate-400 dark:text-gray-500">(from @BotFather)</span>
        </label>
        {status?.hasToken ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 px-3 py-2 text-sm bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg text-slate-500 dark:text-gray-400">
              ********** (configured)
            </div>
            <button
              onClick={handleRemoveToken}
              disabled={saving}
              className="px-3 py-2 text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 border border-slate-200 dark:border-gray-800 rounded-lg hover:border-red-300 dark:hover:border-red-800 transition-colors"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showToken ? "text" : "password"}
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456:ABC-DEF1234..."
                className="w-full px-3 py-2 pr-10 text-sm border border-slate-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600 placeholder:text-slate-300 dark:placeholder:text-gray-600"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              onClick={handleSaveToken}
              disabled={saving || !botToken.trim()}
              className="px-4 py-2 text-sm bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : saved ? "Saved!" : "Save"}
            </button>
          </div>
        )}
      </div>

      {/* Webhook controls */}
      {status?.hasToken && status.enabled && (
        <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-500 dark:text-gray-400">Webhook</label>
            {status.webhookRegistered ? (
              <button
                onClick={handleDeleteWebhook}
                disabled={saving}
                className="px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 border border-slate-200 dark:border-gray-800 rounded-lg hover:border-red-300 dark:hover:border-red-800 transition-colors"
              >
                Unregister
              </button>
            ) : (
              <button
                onClick={handleRegisterWebhook}
                disabled={saving}
                className="px-3 py-1.5 text-xs bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors"
              >
                Register Webhook
              </button>
            )}
          </div>
          {status.webhookUrl && (
            <p className="text-[11px] text-slate-400 dark:text-gray-500 break-all">
              {status.webhookUrl}
            </p>
          )}
          <p className="text-[11px] text-slate-400 dark:text-gray-500">
            Your server must be publicly accessible (via HTTPS) for Telegram to send updates.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

// ─── User Section (Account Linking) ────────────────────────────────────────

export function TelegramUserSection() {
  const queryClient = useQueryClient();
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const { data: linkStatus, isLoading } = useQuery<TelegramLinkStatus>({
    queryKey: ["telegram-link-status"],
    queryFn: () =>
      fetch("/api/telegram/link-status", { credentials: "same-origin" }).then(
        (r) => r.json() as Promise<TelegramLinkStatus>,
      ),
  });

  const generateCode = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/telegram/link-code", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to generate code");
      }
      return res.json() as Promise<{ code: string; expiresInMinutes: number }>;
    },
    onSuccess: (data) => {
      setLinkCode(data.code);
      setError("");
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const unlink = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/telegram/unlink", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Failed to unlink");
      return res.json();
    },
    onSuccess: () => {
      setLinkCode(null);
      void queryClient.invalidateQueries({ queryKey: ["telegram-link-status"] });
    },
    onError: () => {
      setError("Failed to unlink account");
    },
  });

  function handleCopy() {
    if (linkCode) {
      void navigator.clipboard.writeText(linkCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (isLoading) {
    return (
      <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5">
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400 dark:text-gray-500" />
        </div>
      </div>
    );
  }

  return (
    <div className="border border-slate-200 dark:border-gray-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center flex-shrink-0">
          <MessageCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-gray-100">Telegram</h3>
          <p className="text-xs text-slate-400 dark:text-gray-500">
            Link your Telegram account to query Edgebric from Telegram
          </p>
        </div>
      </div>

      {linkStatus?.linked ? (
        /* Already linked */
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 dark:bg-green-950 rounded-lg">
            <Link2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
            <div className="text-sm text-green-700 dark:text-green-400">
              Linked{linkStatus.telegramUsername ? ` as @${linkStatus.telegramUsername}` : ""}
            </div>
          </div>
          <button
            onClick={() => unlink.mutate()}
            disabled={unlink.isPending}
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 border border-slate-200 dark:border-gray-800 rounded-lg hover:border-red-300 dark:hover:border-red-800 transition-colors min-h-[44px]"
          >
            <Unlink className="w-3.5 h-3.5" />
            Unlink Telegram Account
          </button>
        </div>
      ) : (
        /* Not linked — show link button or generated code */
        <div className="space-y-3">
          {linkCode ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 dark:text-gray-400">
                Send this code to the Edgebric bot on Telegram:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-4 py-3 text-center text-2xl font-mono font-bold tracking-[0.3em] bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-lg text-slate-900 dark:text-gray-100">
                  {linkCode}
                </code>
                <button
                  onClick={handleCopy}
                  className="p-2.5 border border-slate-200 dark:border-gray-800 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                  title="Copy code"
                >
                  {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-slate-500 dark:text-gray-400" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-gray-500">
                Send <code className="bg-slate-100 dark:bg-gray-800 px-1 rounded">/link {linkCode}</code> to the bot. Code expires in 10 minutes.
              </p>
            </div>
          ) : (
            <button
              onClick={() => generateCode.mutate()}
              disabled={generateCode.isPending}
              className="flex items-center gap-2 px-4 py-2.5 text-sm bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-xl hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {generateCode.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Link2 className="w-4 h-4" />
              )}
              Link Telegram Account
            </button>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
