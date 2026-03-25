import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import logoLight from "../assets/logo-black.svg";
import logoDark from "../assets/logo-white.svg";

type ServerStatus = "stopped" | "starting" | "running" | "error";
type View = "home" | "settings" | "models";
type DangerAction = "wipe" | "resetAuth" | null;
type ModelStatus = "not_installed" | "installed" | "loaded" | "downloading";

interface CatalogEntry {
  tag: string;
  name: string;
  family: string;
  description: string;
  paramCount: string;
  downloadSizeGB: number;
  ramUsageGB: number;
  origin: string;
  tier: string;
  minRAMGB: number;
  hidden?: boolean;
}

interface InstalledModel {
  tag: string;
  name: string;
  sizeBytes: number;
  digest: string;
  modifiedAt: string;
  status: ModelStatus;
  ramUsageBytes?: number;
  catalogEntry?: CatalogEntry;
}

interface SystemResources {
  ramTotalBytes: number;
  ramAvailableBytes: number;
  diskFreeBytes: number;
  diskTotalBytes: number;
  edgebricRamBytes?: number;
}

interface StorageBreakdown {
  dbBytes: number;
  uploadsBytes: number;
  ollamaModelsBytes: number;
  vaultBytes: number;
}

interface ModelsData {
  models: InstalledModel[];
  catalog: CatalogEntry[];
  activeModel: string;
  system: SystemResources;
  mode?: string;
  storage?: StorageBreakdown;
}

interface RegistryModel {
  name: string;
  description: string;
}

const STATUS_CONFIG: Record<ServerStatus, { label: string; dot: string }> = {
  stopped: { label: "Stopped", dot: "#9ca3af" },
  starting: { label: "Starting...", dot: "#f59e0b" },
  running: { label: "Running", dot: "#22c55e" },
  error: { label: "Error", dot: "#ef4444" },
};

const EMBEDDING_TAG = "nomic-embed-text";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(0)} MB`;
}

function formatGB(bytes: number): string {
  return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
}

type RAMFitLevel = "ok" | "tight" | "exceeds";

function checkRAMFit(modelRAMGB: number, systemRAMTotalBytes: number, headroomGB = 8): { level: RAMFitLevel; message: string } {
  const totalGB = systemRAMTotalBytes / (1024 ** 3);
  const availableGB = Math.max(0, totalGB - headroomGB);
  if (modelRAMGB > totalGB) {
    return { level: "exceeds", message: `Needs ~${modelRAMGB} GB RAM but your system only has ${Math.round(totalGB)} GB. It will not load.` };
  }
  if (modelRAMGB > availableGB) {
    return { level: "tight", message: `Needs ~${modelRAMGB} GB RAM. With ~${headroomGB} GB reserved for your system, only ~${Math.round(availableGB)} GB is available. Performance may suffer.` };
  }
  return { level: "ok", message: "" };
}

function modelDisplayName(m: InstalledModel): string {
  if (m.catalogEntry) return `${m.catalogEntry.name} · ${m.catalogEntry.paramCount}`;
  return m.tag;
}


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
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [isDark, setIsDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  // Models state
  const [modelsData, setModelsData] = useState<ModelsData | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelOp, setModelOp] = useState<{ type: "load" | "unload" | "delete" | "switch"; tag: string } | null>(null);
  const [pullTag, setPullTag] = useState<string | null>(null);
  const [pullPercent, setPullPercent] = useState(0);
  const [pullStatus, setPullStatus] = useState("");
  const [modelError, setModelError] = useState("");
  const [deleteConfirmTag, setDeleteConfirmTag] = useState<string | null>(null);
  const [ggufPath, setGgufPath] = useState<string | null>(null);
  const [ggufName, setGgufName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RegistryModel[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelsInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Active model name for home view
  const activeModelLabel = modelsData?.activeModel
    ? modelDisplayName(
        modelsData.models.find((m) => m.tag === modelsData.activeModel) ??
        { tag: modelsData.activeModel, name: modelsData.activeModel, sizeBytes: 0, digest: "", modifiedAt: "", status: "installed" }
      )
    : null;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Listen for tray navigation requests
  useEffect(() => {
    const unsub = window.electronAPI.onNavigateTo((targetView) => {
      if (targetView === "settings") openSettings();
      if (targetView === "models") setView("models");
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.electronAPI.getStatus().then((s) => {
      setStatus(s.status as ServerStatus);
      setPort(s.port);
      if (s.hostname) setHostname(s.hostname);
      if (s.errorMsg) setErrorMsg(s.errorMsg);
    });
    window.electronAPI.getLaunchAtLogin().then(setLaunchAtLogin);
  }, []);

  useEffect(() => {
    const unsub = window.electronAPI.onStatusChange((newStatus, newErrorMsg) => {
      setStatus(newStatus as ServerStatus);
      if (newStatus === "running") {
        setErrorMsg("");
      } else if (newStatus === "error" && newErrorMsg) {
        setErrorMsg(newErrorMsg);
      }
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

  // Fetch models data via IPC (talks directly to Ollama, no API server auth needed)
  const fetchModels = useCallback(async () => {
    try {
      const data = await window.electronAPI.modelsList();
      setModelsData(data as ModelsData);
    } catch {
      // Ollama might not be ready yet
    }
  }, []);

  useEffect(() => {
    if (status !== "running") return;
    fetchModels();
    const interval = view === "models" ? 3000 : 10000;
    modelsInterval.current = setInterval(fetchModels, interval);
    return () => {
      if (modelsInterval.current) clearInterval(modelsInterval.current);
    };
  }, [status, view, fetchModels]);

  // Listen for pull progress from main process
  useEffect(() => {
    const unsub = window.electronAPI.onModelPullProgress((data) => {
      if (data.status === "done") {
        setPullTag(null);
        setPullPercent(100);
        setPullStatus("Complete");
        fetchModels();
      } else {
        setPullPercent(data.percent);
        setPullStatus(data.status);
      }
    });
    return unsub;
  }, [fetchModels]);

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

  // ─── Model Operations ───────────────────────────────────────────────────────

  async function handleLoadModel(tag: string) {
    setModelOp({ type: "load", tag });
    setModelError("");
    try {
      const result = await window.electronAPI.modelsLoad(tag);
      if (!result.success) {
        setModelError(result.error ?? "Failed to load model");
      } else {
        await fetchModels();
      }
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "Failed to load model");
    } finally {
      setModelOp(null);
    }
  }

  async function handleUnloadModel(tag: string) {
    setModelOp({ type: "unload", tag });
    setModelError("");
    try {
      const result = await window.electronAPI.modelsUnload(tag);
      if (!result.success) {
        setModelError(result.error ?? "Failed to unload model");
      } else {
        await fetchModels();
      }
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "Failed to unload model");
    } finally {
      setModelOp(null);
    }
  }

  async function handleDeleteModel(tag: string) {
    setModelOp({ type: "delete", tag });
    setModelError("");
    try {
      const result = await window.electronAPI.modelsDelete(tag);
      if (!result.success) {
        setModelError(result.error ?? "Failed to delete model");
      } else {
        await fetchModels();
      }
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "Failed to delete model");
    } finally {
      setModelOp(null);
    }
  }

  async function handleSetActive(tag: string) {
    setModelOp({ type: "switch", tag });
    setModelError("");
    try {
      const result = await window.electronAPI.modelsSetActive(tag);
      if (!result.success) {
        setModelError("Failed to set active model");
      } else {
        await fetchModels();
      }
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "Failed to set active model");
    } finally {
      setModelOp(null);
    }
  }

  async function handlePullModel(tag: string) {
    setPullTag(tag);
    setPullPercent(0);
    setPullStatus("Starting download...");
    setModelError("");
    try {
      const result = await window.electronAPI.modelsPull(tag);
      if (!result.success) {
        setModelError(result.error ?? "Failed to start download");
      }
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "Download failed");
    } finally {
      // Progress updates come via onModelPullProgress listener
      // Pull tag is cleared when progress reports 100% or error
    }
  }

  function handleCancelPull() {
    // Pull runs in main process — no client-side cancel yet
    setPullTag(null);
    setPullPercent(0);
    setPullStatus("");
  }

  async function handlePickGguf() {
    const result = await window.electronAPI.modelsPickGguf();
    if (result.path) {
      setGgufPath(result.path);
      // Auto-populate name from filename (e.g., "qwen3.5-4b-q4_K_M.gguf" → "qwen3-5-4b")
      const basename = result.path.split("/").pop()?.replace(/\.gguf$/i, "") ?? "";
      const suggested = basename.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      setGgufName(suggested);
    }
  }

  async function handleImportGguf() {
    if (!ggufPath || !ggufName.trim()) return;
    const name = ggufName.trim();
    setPullTag(name);
    setPullPercent(0);
    setPullStatus("Importing model...");
    setModelError("");
    try {
      const result = await window.electronAPI.modelsImportGguf(ggufPath, name);
      if (!result.success) {
        setModelError(result.error ?? "Failed to import model");
        setPullTag(null);
      }
      // Progress/completion comes via onModelPullProgress listener
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "Import failed");
      setPullTag(null);
    } finally {
      setGgufPath(null);
      setGgufName("");
    }
  }

  function handleSearchInput(value: string) {
    setSearchQuery(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (value.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const result = await window.electronAPI.modelsSearch(value.trim());
        // Filter out models we already have installed
        const installedTags = new Set((modelsData?.models ?? []).map((m) => m.tag));
        const catalogTags = new Set((modelsData?.catalog ?? []).map((c) => c.tag));
        const filtered = result.models.filter((m) => !installedTags.has(m.name) && !catalogTags.has(m.name));
        setSearchResults(filtered);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 400);
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

  // ─── Models View ────────────────────────────────────────────────────────────

  if (view === "models") {
    const sys = modelsData?.system;
    const ramTotal = sys?.ramTotalBytes ?? 0;
    const ramAvailable = sys?.ramAvailableBytes ?? 0;
    const ramUsed = ramTotal - ramAvailable;
    const ramPercent = ramTotal > 0 ? Math.round((ramUsed / ramTotal) * 100) : 0;
    const diskTotal = sys?.diskTotalBytes ?? 0;
    const diskUsed = diskTotal - (sys?.diskFreeBytes ?? 0);
    const diskPercent = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;
    // Headroom: solo mode = personal computer (~8GB for OS+apps), admin/server = ~4GB
    const mode = modelsData?.mode ?? "solo";
    const headroomGB = mode === "solo" ? 8 : 4;
    const ramTotalGB = ramTotal / (1024 ** 3);
    const effectiveRAMGB = Math.max(0, ramTotalGB - headroomGB);

    // Separate models by state, exclude hidden embedding model from chat model lists
    const loadedModels = (modelsData?.models ?? []).filter((m) => m.status === "loaded" && m.tag !== EMBEDDING_TAG);
    const installedModels = (modelsData?.models ?? []).filter((m) => m.status === "installed" && m.tag !== EMBEDDING_TAG);
    const embeddingModel = (modelsData?.models ?? []).find((m) => m.tag === EMBEDDING_TAG);
    const installedTags = new Set((modelsData?.models ?? []).map((m) => m.tag));
    const availableCatalog = (modelsData?.catalog ?? []).filter((c) => !installedTags.has(c.tag));

    const barColor = (pct: number) => pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#22c55e";

    return (
      <div className="dashboard dashboard-settings">
        <div className="view-header">
          <button className="back-btn" onClick={() => { setView("home"); setModelError(""); }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Back
          </button>
          <h2 className="view-title">Models</h2>
        </div>

        {!isRunning ? (
          <div className="card">
            <p className="hint" style={{ textAlign: "center", padding: "20px 0" }}>
              Start the server to manage AI models.
            </p>
          </div>
        ) : !modelsData ? (
          <div className="card">
            <p className="hint" style={{ textAlign: "center", padding: "20px 0" }}>
              Loading...
            </p>
          </div>
        ) : (
          <div className="settings-content">
            {/* System Resources */}
            <section className="card">
              <h3 className="card-heading">System Resources</h3>
              <div className="resource-bars">
                {/* RAM bar — segmented: other apps, edgebric, embedding, chat model */}
                {(() => {
                  const modelRam = loadedModels
                    .filter((m) => m.ramUsageBytes)
                    .reduce((sum, m) => sum + (m.ramUsageBytes ?? 0), 0);
                  const embeddingRam = embeddingModel?.ramUsageBytes ?? 0;
                  const edgebricRam = sys?.edgebricRamBytes ?? 0;
                  const otherUsed = Math.max(0, ramUsed - modelRam - embeddingRam - edgebricRam);
                  const pctOf = (bytes: number) => ramTotal > 0 ? Math.max(0, (bytes / ramTotal) * 100) : 0;
                  return (
                    <div className="resource-bar-item">
                      <div className="resource-bar-label">
                        <span>Memory</span>
                        <span className="resource-bar-value">
                          {formatGB(ramAvailable)} available / {formatGB(ramTotal)} total
                        </span>
                      </div>
                      <div className="resource-bar-track">
                        <div className="resource-bar-fill" style={{ width: `${pctOf(otherUsed)}%`, background: "#64748b", borderRadius: "3px 0 0 3px" }} />
                        {edgebricRam > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${pctOf(edgebricRam)}%`, background: "#8b5cf6" }} />
                        )}
                        {embeddingRam > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${pctOf(embeddingRam)}%`, background: "#06b6d4" }} />
                        )}
                        {modelRam > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${pctOf(modelRam)}%`, background: "#3b82f6", borderRadius: "0 3px 3px 0" }} />
                        )}
                      </div>
                      <div className="resource-bar-legend">
                        {modelRam > 0 && loadedModels.filter((m) => m.ramUsageBytes).map((m) => (
                          <span key={m.tag} className="legend-item">
                            <span className="legend-dot" style={{ background: "#3b82f6" }} />
                            {modelDisplayName(m)} {formatBytes(m.ramUsageBytes!)}
                          </span>
                        ))}
                        {embeddingRam > 0 && (
                          <span className="legend-item">
                            <span className="legend-dot" style={{ background: "#06b6d4" }} />
                            Embeddings {formatBytes(embeddingRam)}
                          </span>
                        )}
                        {edgebricRam > 0 && (
                          <span className="legend-item">
                            <span className="legend-dot" style={{ background: "#8b5cf6" }} />
                            Edgebric {formatBytes(edgebricRam)}
                          </span>
                        )}
                        <span className="legend-item">
                          <span className="legend-dot" style={{ background: "#64748b" }} />
                          Other {formatGB(otherUsed)}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* Disk bar — segmented: models, documents, embeddings on disk, database */}
                {(() => {
                  const st = modelsData?.storage;
                  const ollamaBytes = st?.ollamaModelsBytes ?? 0;
                  const uploadsBytes = st?.uploadsBytes ?? 0;
                  const dbBytes = st?.dbBytes ?? 0;
                  const vaultBytes = st?.vaultBytes ?? 0;
                  const embeddingDisk = embeddingModel?.sizeBytes ?? 0;
                  const edgebricTotal = ollamaBytes + uploadsBytes + dbBytes + vaultBytes;
                  const pctOf = (bytes: number) => diskTotal > 0 ? Math.max(0, (bytes / diskTotal) * 100) : 0;
                  const otherUsed = Math.max(0, diskUsed - edgebricTotal);
                  return (
                    <div className="resource-bar-item">
                      <div className="resource-bar-label">
                        <span>Disk</span>
                        <span className="resource-bar-value">{formatGB(diskUsed)} / {formatGB(diskTotal)}</span>
                      </div>
                      <div className="resource-bar-track">
                        <div className="resource-bar-fill" style={{ width: `${pctOf(otherUsed)}%`, background: "#64748b", borderRadius: "3px 0 0 3px" }} />
                        {ollamaBytes > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${pctOf(ollamaBytes)}%`, background: "#3b82f6" }} />
                        )}
                        {uploadsBytes > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${pctOf(uploadsBytes)}%`, background: "#22c55e" }} />
                        )}
                        {vaultBytes > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${pctOf(vaultBytes)}%`, background: "#f59e0b" }} />
                        )}
                        {dbBytes > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${pctOf(dbBytes)}%`, background: "#8b5cf6", borderRadius: "0 3px 3px 0" }} />
                        )}
                      </div>
                      <div className="resource-bar-legend">
                        {ollamaBytes > 0 && (
                          <span className="legend-item">
                            <span className="legend-dot" style={{ background: "#3b82f6" }} />
                            AI Models {formatBytes(ollamaBytes)}
                          </span>
                        )}
                        {uploadsBytes > 0 && (
                          <span className="legend-item">
                            <span className="legend-dot" style={{ background: "#22c55e" }} />
                            Documents {formatBytes(uploadsBytes)}
                          </span>
                        )}
                        {vaultBytes > 0 && (
                          <span className="legend-item">
                            <span className="legend-dot" style={{ background: "#f59e0b" }} />
                            Vault {formatBytes(vaultBytes)}
                          </span>
                        )}
                        {dbBytes > 0 && (
                          <span className="legend-item">
                            <span className="legend-dot" style={{ background: "#8b5cf6" }} />
                            Database {formatBytes(dbBytes)}
                          </span>
                        )}
                        <span className="legend-item">
                          <span className="legend-dot" style={{ background: "#64748b" }} />
                          Other {formatGB(otherUsed)}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </section>

            {/* Your Models — loaded + installed in one list */}
            {(loadedModels.length > 0 || installedModels.length > 0) && (
              <section className="card">
                <h3 className="card-heading">Your Models</h3>
                <div className="model-list">
                  {loadedModels.map((m) => {
                    const isOpTarget = modelOp?.tag === m.tag;
                    return (
                      <div key={m.tag} className="model-item">
                        <div className="model-item-left">
                          <div className="model-item-name">
                            {modelDisplayName(m)}
                            <span className="model-badge model-badge-active">Running</span>
                          </div>
                          <span className="model-item-meta">
                            {m.catalogEntry?.family ? `by ${m.catalogEntry.family} · ` : ""}{m.ramUsageBytes != null ? `${formatBytes(m.ramUsageBytes)} RAM · ` : ""}{formatBytes(m.sizeBytes)} on disk
                          </span>
                        </div>
                        <div className="btn-row" style={{ marginTop: 0 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleUnloadModel(m.tag)}
                            disabled={!!modelOp}
                          >
                            {isOpTarget && modelOp?.type === "unload" ? "..." : "Stop"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {installedModels.map((m) => {
                    const isOpTarget = modelOp?.tag === m.tag;
                    const modelRAMGB = m.catalogEntry?.ramUsageGB ?? m.sizeBytes / (1024 ** 3) * 1.2;
                    const fit = checkRAMFit(modelRAMGB, ramTotal, headroomGB);
                    return (
                      <div key={m.tag} className="model-item">
                        <div className="model-item-left">
                          <div className="model-item-name">
                            {modelDisplayName(m)}
                            {fit.level === "exceeds" && (
                              <span className="model-badge" style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", marginLeft: 6 }}>Too large</span>
                            )}
                            {fit.level === "tight" && (
                              <span className="model-badge" style={{ background: "#fffbeb", color: "#d97706", border: "1px solid #fde68a", marginLeft: 6 }}>Low RAM</span>
                            )}
                          </div>
                          <span className="model-item-meta">{m.catalogEntry?.family ? `by ${m.catalogEntry.family} · ` : ""}{formatBytes(m.sizeBytes)} on disk</span>
                          {fit.level !== "ok" && (
                            <span className="model-item-meta" style={{ color: fit.level === "exceeds" ? "#dc2626" : "#d97706", fontWeight: 500 }}>
                              {fit.message}
                            </span>
                          )}
                        </div>
                        <div className="btn-row" style={{ marginTop: 0 }}>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleLoadModel(m.tag)}
                            disabled={!!modelOp || !!pullTag}
                          >
                            {isOpTarget && modelOp?.type === "load" ? "Starting..." : "Start"}
                          </button>
                          {deleteConfirmTag === m.tag ? (
                            <>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => { setDeleteConfirmTag(null); handleDeleteModel(m.tag); }}
                                disabled={!!modelOp || !!pullTag}
                              >
                                {isOpTarget && modelOp?.type === "delete" ? "..." : "Confirm"}
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => setDeleteConfirmTag(null)}
                                disabled={!!modelOp || !!pullTag}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn btn-danger-ghost btn-sm"
                              onClick={() => setDeleteConfirmTag(m.tag)}
                              disabled={!!modelOp || !!pullTag}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Download Progress */}
            {pullTag && (
              <section className="card">
                <h3 className="card-heading">Downloading</h3>
                <div className="model-item">
                  <div className="model-item-left" style={{ flex: 1 }}>
                    <div className="model-item-name">{pullTag}</div>
                    <div className="resource-bar-track" style={{ marginTop: 6 }}>
                      <div className="resource-bar-fill" style={{ width: `${pullPercent}%`, background: "#3b82f6", transition: "width 0.3s" }} />
                    </div>
                    <span className="model-item-meta" style={{ marginTop: 4 }}>
                      {pullPercent}% — {pullStatus}
                    </span>
                  </div>
                  <button className="btn btn-danger-ghost btn-sm" onClick={handleCancelPull}>
                    Cancel
                  </button>
                </div>
              </section>
            )}

            {/* Available Models — recommended + alternatives in one card */}
            {(() => {
              const recommended = availableCatalog.filter((c) => c.tier === "recommended");
              const supported = availableCatalog.filter((c) => c.tier === "supported");
              if (recommended.length === 0 && supported.length === 0) return null;

              const renderCatalogItem = (c: CatalogEntry) => {
                const fit = checkRAMFit(c.ramUsageGB, ramTotal, headroomGB);
                return (
                  <div key={c.tag} className="model-item" style={fit.level === "exceeds" ? { opacity: 0.55 } : undefined}>
                    <div className="model-item-left">
                      <div className="model-item-name">
                        {c.name}
                        {fit.level === "exceeds" && (
                          <span className="model-badge" style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", marginLeft: 6 }}>Too large</span>
                        )}
                        {fit.level === "tight" && (
                          <span className="model-badge" style={{ background: "#fffbeb", color: "#d97706", border: "1px solid #fde68a", marginLeft: 6 }}>Low RAM</span>
                        )}
                      </div>
                      <span className="model-item-meta">by {c.family} · {c.description}</span>
                      <span className="model-item-meta">
                        {c.downloadSizeGB} GB download · {c.ramUsageGB} GB RAM
                      </span>
                      {fit.level !== "ok" && (
                        <span className="model-item-meta" style={{ color: fit.level === "exceeds" ? "#dc2626" : "#d97706", fontWeight: 500 }}>
                          {fit.message}
                        </span>
                      )}
                    </div>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handlePullModel(c.tag)}
                      disabled={!!pullTag || !!modelOp}
                    >
                      Install
                    </button>
                  </div>
                );
              };

              return (
                <section className="card">
                  <h3 className="card-heading">
                    Available Models ({Math.round(ramTotalGB)} GB RAM{mode === "solo" ? ", personal use" : ""})
                  </h3>
                  <p className="hint" style={{ margin: "0 0 10px" }}>
                    {mode === "solo"
                      ? `~${headroomGB} GB recommended for your system, ~${Math.round(effectiveRAMGB)} GB available for AI models.`
                      : `~${headroomGB} GB recommended for the OS, ~${Math.round(effectiveRAMGB)} GB available for AI models.`}
                  </p>
                  {recommended.length > 0 && (
                    <>
                      <p className="card-subheading">Recommended</p>
                      <div className="model-list">
                        {recommended.map(renderCatalogItem)}
                      </div>
                    </>
                  )}
                  {recommended.length > 0 && supported.length > 0 && (
                    <div className="card-divider" />
                  )}
                  {supported.length > 0 && (
                    <>
                      <p className="card-subheading">Alternatives</p>
                      <div className="model-list">
                        {supported.map(renderCatalogItem)}
                      </div>
                    </>
                  )}
                </section>
              );
            })()}

            {/* Other Models — search + import in one card */}
            <section className="card">
              <h3 className="card-heading">Other Models</h3>
              <p className="hint" style={{ margin: "0 0 10px" }}>
                Search for models online. These are not tested and may not work correctly.
              </p>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                placeholder="Search models (e.g., mistral, deepseek, llama)..."
                className="model-custom-input"
                style={{ width: "100%", marginBottom: searchResults.length > 0 || searchLoading ? 8 : 0 }}
              />
              {searchLoading && (
                <p className="hint" style={{ margin: "4px 0" }}>Searching...</p>
              )}
              {searchResults.length > 0 && (
                <div className="model-list" style={{ maxHeight: 240, overflowY: "auto" }}>
                  {searchResults.map((m) => (
                    <div key={m.name} className="model-item">
                      <div className="model-item-left">
                        <div className="model-item-name">{m.name}</div>
                        {m.description && <span className="model-item-meta">{m.description}</span>}
                        <span className="model-item-meta" style={{ color: "#d97706" }}>
                          RAM usage unknown — check model page for requirements. You have {Math.round(ramTotalGB)} GB total.
                        </span>
                      </div>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          handlePullModel(m.name);
                          setSearchQuery("");
                          setSearchResults([]);
                        }}
                        disabled={!!pullTag || !!modelOp}
                      >
                        Install
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {searchQuery.trim().length >= 2 && !searchLoading && searchResults.length === 0 && (
                <p className="hint" style={{ margin: "4px 0" }}>
                  No results. You can try installing directly:
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ marginLeft: 8 }}
                    onClick={() => {
                      handlePullModel(searchQuery.trim());
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                    disabled={!!pullTag}
                  >
                    Install "{searchQuery.trim()}"
                  </button>
                </p>
              )}

              <div className="card-divider" />

              <p className="card-subheading">Import from File</p>
              <p className="hint" style={{ margin: "0 0 10px" }}>
                Import a model from a local GGUF file.
              </p>
              {!ggufPath ? (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handlePickGguf}
                  disabled={!!pullTag}
                >
                  Choose .gguf file...
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="hint" style={{ margin: 0, wordBreak: "break-all" }}>
                    {ggufPath.split("/").pop()}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      value={ggufName}
                      onChange={(e) => setGgufName(e.target.value)}
                      placeholder="Model name"
                      className="model-custom-input"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && ggufName.trim()) handleImportGguf();
                      }}
                    />
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleImportGguf}
                      disabled={!ggufName.trim() || !!pullTag}
                    >
                      Import
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => { setGgufPath(null); setGgufName(""); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Error */}
            {modelError && <div className="error-msg">{modelError}</div>}
          </div>
        )}
      </div>
    );
  }

  // ─── Settings View ──────────────────────────────────────────────────────────

  if (view === "settings") {
    return (
      <div className="dashboard dashboard-settings">
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
                <h3 className="card-heading">General</h3>
                <div className="field" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <label style={{ marginBottom: 0 }}>Launch at Login</label>
                    <p className="hint" style={{ marginTop: 2 }}>Start Edgebric automatically when you log in to your Mac.</p>
                  </div>
                  <button
                    className={`toggle-btn ${launchAtLogin ? "toggle-on" : ""}`}
                    onClick={async () => {
                      const newVal = !launchAtLogin;
                      setLaunchAtLogin(newVal);
                      await window.electronAPI.setLaunchAtLogin(newVal);
                    }}
                    type="button"
                    aria-pressed={launchAtLogin}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
              </section>

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
                      <code>{`sudo bash -c 'echo "rdr pass on lo0 inet proto tcp from any to any port 443 -> 127.0.0.1 port ${editPort || port}" > /etc/pf.anchors/edgebric && grep -q edgebric /etc/pf.conf || echo -e "rdr-anchor \\"edgebric\\"\\nload anchor \\"edgebric\\" from \\"/etc/pf.anchors/edgebric\\"" | sudo tee -a /etc/pf.conf > /dev/null && sudo pfctl -ef /etc/pf.conf'`}</code>
                    </div>
                    <p className="hint" style={{ marginTop: 6 }}>
                      Requires your Mac password. Only needs to be done once — survives reboots.
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

  // ─── Home View ──────────────────────────────────────────────────────────────

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

          {isRunning && activeModelLabel && (
            <div className="active-model-row">
              <span className="active-model-label">Active model</span>
              <span className="active-model-name">{activeModelLabel}</span>
            </div>
          )}

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
        <button className="bottom-link" onClick={() => setView("models")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z"/><path d="M5 17l.6 1.4L7 19l-1.4.6L5 21l-.6-1.4L3 19l1.4-.6L5 17z"/></svg>
          Models
        </button>
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
