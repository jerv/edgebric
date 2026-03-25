import { useState, useEffect, type FormEvent } from "react";
import logoLight from "../assets/logo-black.svg";
import logoDark from "../assets/logo-white.svg";

type ServerStatus = "stopped" | "starting" | "running" | "error";
type View = "home" | "settings";
type DangerAction = "wipe" | "resetAuth" | null;

const STATUS_CONFIG: Record<ServerStatus, { label: string; dot: string }> = {
  stopped: { label: "Stopped", dot: "#9ca3af" },
  starting: { label: "Starting...", dot: "#f59e0b" },
  running: { label: "Running", dot: "#22c55e" },
  error: { label: "Error", dot: "#ef4444" },
};

export default function ServerDashboard() {
  const [status, setStatus] = useState<ServerStatus>("stopped");
  const [port, setPort] = useState(3001);
  const [hostname, setHostname] = useState("edgebric.local");
  const [errorMsg, setErrorMsg] = useState("");
  const [view, setView] = useState<View>("home");

  // Settings state
  const [editHostname, setEditHostname] = useState("");
  const [editPort, setEditPort] = useState("");
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [dangerAction, setDangerAction] = useState<DangerAction>(null);
  const [confirmText, setConfirmText] = useState("");
  const [actionInProgress, setActionInProgress] = useState(false);
  const [showPortHint, setShowPortHint] = useState(false);
  const [isDark, setIsDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Listen for tray navigation requests
  useEffect(() => {
    const unsub = window.electronAPI.onNavigateTo((targetView) => {
      if (targetView === "settings") {
        openSettings();
      }
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.electronAPI.getStatus().then((s) => {
      setStatus(s.status as ServerStatus);
      setPort(s.port);
      if (s.hostname) setHostname(s.hostname);
    });
  }, []);

  useEffect(() => {
    const unsub = window.electronAPI.onStatusChange((newStatus) => {
      setStatus(newStatus as ServerStatus);
      if (newStatus === "running") setErrorMsg("");
    });
    return unsub;
  }, []);

  // Auto-start server on first mount
  useEffect(() => {
    window.electronAPI.getStatus().then(async (s) => {
      if (s.status === "stopped" || s.status === "error") {
        handleStart();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStart() {
    setErrorMsg("");
    const result = await window.electronAPI.startServer();
    if (!result.success) setErrorMsg(result.error ?? "Failed to start server");
  }

  async function handleStop() {
    setErrorMsg("");
    await window.electronAPI.stopServer();
  }

  async function handleRestart() {
    setErrorMsg("");
    await window.electronAPI.stopServer();
    await new Promise((r) => setTimeout(r, 500));
    const result = await window.electronAPI.startServer();
    if (!result.success) setErrorMsg(result.error ?? "Failed to start server");
  }

  async function handleDangerConfirm(e: FormEvent) {
    e.preventDefault();
    if (!dangerAction) return;
    const requiredText = dangerAction === "wipe" ? "WIPE" : "RESET";
    if (confirmText !== requiredText) return;

    setActionInProgress(true);
    setErrorMsg("");
    try {
      const result = dangerAction === "wipe"
        ? await window.electronAPI.instanceWipe()
        : await window.electronAPI.instanceResetAuth();
      if (!result.success) {
        setErrorMsg(result.error ?? "Operation failed");
        setActionInProgress(false);
        return;
      }
      if (dangerAction === "wipe") {
        window.location.reload();
      } else {
        setDangerAction(null);
        setConfirmText("");
        setActionInProgress(false);
        await handleRestart();
      }
    } catch (err) {
      setErrorMsg(String(err));
      setActionInProgress(false);
    }
  }

  async function handleSaveSettings() {
    const newPort = parseInt(editPort, 10);
    if (!editHostname.trim() || isNaN(newPort) || newPort < 1 || newPort > 65535) {
      setErrorMsg("Invalid hostname or port");
      return;
    }
    const result = await window.electronAPI.saveSettings({ hostname: editHostname.trim(), port: newPort });
    if (!result.success) {
      setErrorMsg(result.error ?? "Failed to save settings");
    } else {
      setHostname(editHostname.trim());
      setPort(newPort);
      setSettingsSaved(true);
      setErrorMsg("");
    }
  }

  const statusConf = STATUS_CONFIG[status];
  const accessUrl = port === 443 ? `https://${hostname}` : `https://${hostname}:${port}`;
  const isRunning = status === "running";
  const isStopped = status === "stopped" || status === "error";

  function openSettings() {
    setView("settings");
    setEditHostname(hostname);
    setEditPort(String(port));
    setSettingsSaved(false);
    setDangerAction(null);
    setConfirmText("");
    setErrorMsg("");
  }

  if (view === "settings") {
    return (
      <div className="dashboard">
        <div className="view-header">
          <button className="back-btn" onClick={() => { setView("home"); setErrorMsg(""); }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Back
          </button>
          <h2 className="view-title">Settings</h2>
        </div>

        <div className="settings-content">
          {!dangerAction ? (
            <>
              <section className="card">
                <h3 className="card-heading">Network</h3>
                <div className="field">
                  <label>Hostname</label>
                  <input
                    type="text"
                    value={editHostname}
                    onChange={(e) => { setEditHostname(e.target.value); setSettingsSaved(false); }}
                  />
                  <p className="hint">
                    Use <strong>edgebric.local</strong> for zero-config local access,
                    or a custom domain if you have DNS configured.
                  </p>
                </div>
                <div className="field">
                  <label>Port</label>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={editPort}
                    onChange={(e) => { setEditPort(e.target.value); setSettingsSaved(false); }}
                  />
                  <p className="hint">Default: 3001</p>
                </div>
                <button
                  className="port-hint-toggle"
                  onClick={() => setShowPortHint(!showPortHint)}
                  type="button"
                >
                  Do I have to type in a port number?
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: showPortHint ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
                    <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {showPortHint && (
                  <div className="clean-url-tip">
                    <h4>Want a clean URL without the port number?</h4>
                    <p>
                      Run this command once in Terminal to forward port 443 to {editPort || port}.
                      After this, users can access Edgebric at <strong>https://{editHostname || hostname}</strong> instead
                      of <strong>https://{editHostname || hostname}:{editPort || port}</strong>.
                    </p>
                    <div className="code-block">
                      <code>echo "rdr pass on lo0 inet proto tcp from any to any port 443 -&gt; 127.0.0.1 port {editPort || port}" | sudo pfctl -ef -</code>
                    </div>
                    <p className="hint" style={{ marginTop: 6 }}>
                      This survives until reboot. To make it permanent, add the rule to <code>/etc/pf.anchors/edgebric</code> and
                      load it from <code>/etc/pf.conf</code>. Requires admin (sudo) password.
                    </p>
                  </div>
                )}
                {(editHostname !== hostname || editPort !== String(port)) && (
                  <div className="btn-row">
                    <button className="btn btn-primary btn-sm" onClick={handleSaveSettings}>Save</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setEditHostname(hostname); setEditPort(String(port)); }}>Cancel</button>
                  </div>
                )}
                {settingsSaved && (
                  <p className="success-msg">Saved. Restart the server for changes to take effect.</p>
                )}
                {errorMsg && <div className="error-msg">{errorMsg}</div>}
              </section>

              <section className="card card-danger">
                <h3 className="card-heading card-heading-danger">Danger Zone</h3>
                <div className="danger-item">
                  <div>
                    <p className="danger-item-title">Reset Authentication</p>
                    <p className="danger-item-desc">Clears all sessions and switches to solo mode. Data is preserved.</p>
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={() => { setDangerAction("resetAuth"); setConfirmText(""); setErrorMsg(""); }}>
                    Reset Auth
                  </button>
                </div>
                <div className="danger-item">
                  <div>
                    <p className="danger-item-title">Wipe Instance</p>
                    <p className="danger-item-desc">Deletes all data, sessions, and configuration. Cannot be undone.</p>
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={() => { setDangerAction("wipe"); setConfirmText(""); setErrorMsg(""); }}>
                    Wipe
                  </button>
                </div>
              </section>
            </>
          ) : (
            <section className="card">
              <form onSubmit={handleDangerConfirm}>
                <h3 className="card-heading card-heading-danger">
                  {dangerAction === "wipe" ? "Wipe Instance" : "Reset Authentication"}
                </h3>
                <div className="danger-warning">
                  {dangerAction === "wipe"
                    ? "This will permanently delete all data including documents, conversations, and configuration. This cannot be undone."
                    : "This will clear all sessions and reset to solo mode (no authentication). Your documents and conversations will be preserved."}
                </div>
                <div className="field">
                  <label>
                    Type <strong>{dangerAction === "wipe" ? "WIPE" : "RESET"}</strong> to confirm
                  </label>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={dangerAction === "wipe" ? "WIPE" : "RESET"}
                    autoFocus
                    disabled={actionInProgress}
                  />
                </div>
                {errorMsg && <div className="error-msg">{errorMsg}</div>}
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setDangerAction(null); setErrorMsg(""); }}
                    disabled={actionInProgress}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-danger btn-sm"
                    disabled={confirmText !== (dangerAction === "wipe" ? "WIPE" : "RESET") || actionInProgress}
                  >
                    {actionInProgress ? "Working..." : dangerAction === "wipe" ? "Wipe Everything" : "Reset Auth"}
                  </button>
                </div>
              </form>
            </section>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-main">
        <div className="hero">
          <img src={isDark ? logoDark : logoLight} alt="Edgebric" className="hero-logo" />
          <h1 className="hero-title">Edgebric</h1>
          <p className="hero-subtitle">You can close this window — Edgebric lives in your menu bar.</p>
        </div>

        <div className="card" style={{ width: "100%" }}>
          <div className="status-row">
            <div className="status-left">
              <span className="status-dot" style={{ background: statusConf.dot }} />
              <span className="status-label">{statusConf.label}</span>
            </div>
            <div className="btn-row">
              {isStopped && (
                <button className="btn btn-primary btn-sm" onClick={handleStart}>Start</button>
              )}
              {status === "starting" && (
                <button className="btn btn-ghost btn-sm" disabled>Starting...</button>
              )}
              {isRunning && (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={handleRestart}>Restart</button>
                  <button className="btn btn-danger-ghost btn-sm" onClick={handleStop}>Stop</button>
                </>
              )}
            </div>
          </div>

          {isRunning && (
            <div className="url-row">
              <span className="url-label">Access URL</span>
              <a className="url-link" href={accessUrl} target="_blank" rel="noopener noreferrer">{accessUrl}</a>
            </div>
          )}

          {errorMsg && <div className="error-msg">{errorMsg}</div>}
        </div>

        {isRunning && (
          <button className="btn btn-primary action-btn" style={{ width: "100%" }} onClick={() => window.open(accessUrl, "_blank")}>
            Launch Edgebric
          </button>
        )}
      </div>

      <div className="bottom-actions">
        <button className="bottom-link" onClick={openSettings}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6.5 1.5L6.8 3.1C6.1 3.4 5.5 3.8 4.9 4.3L3.4 3.7L1.9 6.3L3.2 7.3C3.1 7.5 3.1 7.8 3.1 8C3.1 8.2 3.1 8.5 3.2 8.7L1.9 9.7L3.4 12.3L4.9 11.7C5.5 12.2 6.1 12.6 6.8 12.9L7.1 14.5H9.5L9.8 12.9C10.5 12.6 11.1 12.2 11.7 11.7L13.2 12.3L14.7 9.7L13.4 8.7C13.5 8.5 13.5 8.2 13.5 8C13.5 7.8 13.5 7.5 13.4 7.3L14.7 6.3L13.2 3.7L11.7 4.3C11.1 3.8 10.5 3.4 9.8 3.1L9.5 1.5H6.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="8.3" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/></svg>
          Settings
        </button>
        <button className="bottom-link" onClick={() => window.electronAPI.openLogWindow()}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3H14M2 6H14M2 9H10M2 12H8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          View Logs
        </button>
      </div>
    </div>
  );
}
