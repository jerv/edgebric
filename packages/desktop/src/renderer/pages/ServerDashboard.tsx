import { useState, useEffect, useRef } from "react";
import logoSrc from "../assets/logo.png";

type ServerStatus = "stopped" | "starting" | "running" | "error";

const STATUS_CONFIG: Record<ServerStatus, { label: string; color: string; bgColor: string }> = {
  stopped: { label: "Stopped", color: "#888", bgColor: "#f0f0f0" },
  starting: { label: "Starting...", color: "#b45309", bgColor: "#fef3c7" },
  running: { label: "Running", color: "#15803d", bgColor: "#dcfce7" },
  error: { label: "Error", color: "#b91c1c", bgColor: "#fef2f2" },
};

export default function ServerDashboard() {
  const [status, setStatus] = useState<ServerStatus>("stopped");
  const [port, setPort] = useState(3001);
  const [hostname, setHostname] = useState("edgebric.local");
  const [errorMsg, setErrorMsg] = useState("");
  const [logs, setLogs] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const logsRef = useRef<HTMLPreElement>(null);

  // Fetch initial status
  useEffect(() => {
    window.electronAPI.getStatus().then((s) => {
      setStatus(s.status as ServerStatus);
      setPort(s.port);
      if (s.hostname) setHostname(s.hostname);
    });
  }, []);

  // Subscribe to status changes
  useEffect(() => {
    const unsub = window.electronAPI.onStatusChange((newStatus) => {
      setStatus(newStatus as ServerStatus);
      if (newStatus === "running") setErrorMsg("");
    });
    return unsub;
  }, []);

  // Auto-start server on first mount (after wizard)
  useEffect(() => {
    window.electronAPI.getStatus().then(async (s) => {
      if (s.status === "stopped" || s.status === "error") {
        handleStart();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll logs when showing
  useEffect(() => {
    if (!showLogs) return;
    const fetchLogs = () => {
      window.electronAPI.readLogs(50).then((text) => {
        setLogs(text);
        if (logsRef.current) {
          logsRef.current.scrollTop = logsRef.current.scrollHeight;
        }
      });
    };
    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [showLogs]);

  async function handleStart() {
    setErrorMsg("");
    const result = await window.electronAPI.startServer();
    if (!result.success) {
      setErrorMsg(result.error ?? "Failed to start server");
    }
  }

  async function handleStop() {
    setErrorMsg("");
    await window.electronAPI.stopServer();
  }

  async function handleRestart() {
    setErrorMsg("");
    await window.electronAPI.stopServer();
    // Small delay to let it fully stop
    await new Promise((r) => setTimeout(r, 500));
    const result = await window.electronAPI.startServer();
    if (!result.success) {
      setErrorMsg(result.error ?? "Failed to start server");
    }
  }

  const statusConf = STATUS_CONFIG[status];
  const accessUrl = port === 443 ? `https://${hostname}` : `https://${hostname}:${port}`;
  const isRunning = status === "running";
  const isStopped = status === "stopped" || status === "error";

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <img src={logoSrc} alt="Edgebric" className="dashboard-logo" />
        <div>
          <h1 className="dashboard-title">Edgebric</h1>
          <p className="dashboard-subtitle">You can close this window — Edgebric lives in your menu bar.</p>
        </div>
      </div>

      <div className="status-card">
        <div className="status-row">
          <div className="status-left">
            <span className="status-dot" style={{ background: statusConf.color }} />
            <span className="status-label" style={{ color: statusConf.color }}>{statusConf.label}</span>
          </div>
          <div className="status-actions">
            {isStopped && (
              <button className="btn btn-primary btn-sm" onClick={handleStart}>
                Start Server
              </button>
            )}
            {status === "starting" && (
              <button className="btn btn-secondary btn-sm" disabled>
                Starting...
              </button>
            )}
            {isRunning && (
              <>
                <button className="btn btn-secondary btn-sm" onClick={handleRestart}>
                  Restart
                </button>
                <button className="btn btn-danger btn-sm" onClick={handleStop}>
                  Stop
                </button>
              </>
            )}
          </div>
        </div>

        {isRunning && (
          <div className="access-url">
            <span className="access-label">Access URL</span>
            <a className="access-link" href={accessUrl} target="_blank" rel="noopener noreferrer">
              {accessUrl}
            </a>
          </div>
        )}

        {errorMsg && (
          <div className="dashboard-error">
            <strong>Error:</strong> {errorMsg}
          </div>
        )}
      </div>

      <div className="logs-section">
        <button
          className="logs-toggle"
          onClick={() => setShowLogs(!showLogs)}
        >
          {showLogs ? "Hide Logs" : "Show Logs"}
        </button>
        {showLogs && (
          <pre className="logs-output" ref={logsRef}>
            {logs || "No logs yet."}
          </pre>
        )}
      </div>
    </div>
  );
}
