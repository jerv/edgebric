import React, { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import logoLight from "../assets/logo-black.svg";
import logoDark from "../assets/logo-white.svg";

type ServerStatus = "stopped" | "starting" | "running" | "error";
type View = "home" | "settings" | "models";
type DangerAction = "wipe" | "switchAuth" | null;
type ModelStatus = "not_installed" | "installed" | "loaded" | "downloading";

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}
function MicrosoftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}
function OktaIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="9" fill="#007DC1" />
      <circle cx="10" cy="10" r="4" fill="white" />
    </svg>
  );
}
function OneLoginIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 1C6.5 1 3 2.5 3 5.5V9.5C3 14 6 17.5 10 19C14 17.5 17 14 17 9.5V5.5C17 2.5 13.5 1 10 1Z" fill="#232F6A" />
    </svg>
  );
}
function PingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M4 2L16 10L4 18V2Z" fill="#B31B34" />
    </svg>
  );
}
function OidcIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      <circle cx="12" cy="16" r="1"/>
    </svg>
  );
}

interface AuthProviderDef {
  id: string;
  name: string;
  defaultIssuer: string;
  issuerHint: string;
  clientIdHint: string;
  icon: React.ReactNode;
}

const AUTH_PROVIDER_OPTIONS: AuthProviderDef[] = [
  { id: "google", name: "Google Workspace", defaultIssuer: "https://accounts.google.com", issuerHint: "", clientIdHint: "xxxxxxxxxx.apps.googleusercontent.com", icon: <GoogleIcon /> },
  { id: "microsoft", name: "Microsoft Entra ID", defaultIssuer: "", issuerHint: "https://login.microsoftonline.com/<tenant-id>/v2.0", clientIdHint: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", icon: <MicrosoftIcon /> },
  { id: "okta", name: "Okta", defaultIssuer: "", issuerHint: "https://your-domain.okta.com/oauth2/default", clientIdHint: "", icon: <OktaIcon /> },
  { id: "onelogin", name: "OneLogin", defaultIssuer: "", issuerHint: "https://your-subdomain.onelogin.com/oidc/2", clientIdHint: "", icon: <OneLoginIcon /> },
  { id: "ping", name: "Ping Identity", defaultIssuer: "", issuerHint: "https://auth.pingone.com/<environment-id>/as", clientIdHint: "", icon: <PingIcon /> },
  { id: "generic", name: "Custom OIDC Provider", defaultIssuer: "", issuerHint: "https://your-provider.com", clientIdHint: "", icon: <OidcIcon /> },
];

interface ModelCapabilities {
  vision: boolean;
  toolUse: boolean;
  reasoning: boolean;
}

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
  capabilities?: ModelCapabilities;
  huggingFaceUrl?: string;
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
  capabilities?: ModelCapabilities;
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
  modelsBytes: number;
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
  tags?: string[];
  huggingFaceUrl?: string;
  capabilities?: ModelCapabilities;
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

function BadgeIcon({ d }: { d: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 3, verticalAlign: -1 }}>
      <path d={d} />
    </svg>
  );
}

// Lucide icon paths
const ICON_EYE = "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z";
const ICON_WRENCH = "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z";
const ICON_BRAIN = "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4 M12 18v4";
const ICON_LINK = "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71";

function CapabilityBadges({ capabilities }: { capabilities?: ModelCapabilities }) {
  if (!capabilities) return null;
  const badges: JSX.Element[] = [];
  if (capabilities.vision) {
    badges.push(
      <span key="vision" className="model-badge model-badge-vision" title="Can analyze images and screenshots">
        <BadgeIcon d={ICON_EYE} /> Vision
      </span>
    );
  }
  if (capabilities.toolUse) {
    badges.push(
      <span key="tools" className="model-badge model-badge-tools" title="Can use tools like search and file management">
        <BadgeIcon d={ICON_WRENCH} /> Tools
      </span>
    );
  }
  if (capabilities.reasoning) {
    badges.push(
      <span key="reasoning" className="model-badge model-badge-reasoning" title="Enhanced step-by-step reasoning">
        <BadgeIcon d={ICON_BRAIN} /> Reasoning
      </span>
    );
  }
  return <>{badges}</>;
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

function formatUptime(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const HEALTH_CHECK_TOOLTIPS: Record<string, string> = {
  database: "SQLite database used for documents, users, conversations, and metadata.",
  inference: "AI engine that runs language models for chat and analysis.",
  vectorStore: "sqlite-vec embedding index used for semantic search over documents.",
  disk: "Available storage on the volume where Edgebric data is stored.",
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

  // Switch Auth Provider state
  const [switchStep, setSwitchStep] = useState<"provider" | "credentials">("provider");
  const [switchProvider, setSwitchProvider] = useState("google");
  const [switchIssuer, setSwitchIssuer] = useState("https://accounts.google.com");
  const [switchClientId, setSwitchClientId] = useState("");
  const [switchClientSecret, setSwitchClientSecret] = useState("");
  const [switchAdminEmails, setSwitchAdminEmails] = useState("");
  const [showPortHint, setShowPortHint] = useState(false);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
  const [appVersion, setAppVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState<{ checking: boolean; downloading: boolean; downloaded: boolean; availableVersion: string | null }>({ checking: false, downloading: false, downloaded: false, availableVersion: null });
  const [isDark, setIsDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [headerScrolled, setHeaderScrolled] = useState(false);

  // Models state
  const [modelsData, setModelsData] = useState<ModelsData | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelOp, setModelOp] = useState<{ type: "load" | "unload" | "delete" | "switch"; tag: string } | null>(null);
  const [pullTag, setPullTag] = useState<string | null>(null);
  const [pullPercent, setPullPercent] = useState(0);
  const [pullStatus, setPullStatus] = useState("");
  const [modelError, setModelError] = useState("");
  const [deleteConfirmTag, setDeleteConfirmTag] = useState<string | null>(null);
  const [unloadConfirmTag, setUnloadConfirmTag] = useState<string | null>(null);
  const [ggufPath, setGgufPath] = useState<string | null>(null);
  const [ggufName, setGgufName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RegistryModel[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [healthData, setHealthData] = useState<{ uptime: number | null; checks: Record<string, { status: string; latencyMs?: number; error?: string }> } | null>(null);
  const [checksOpen, setChecksOpen] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelsInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const healthInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Active model name for home view — only show when the model is actually loaded
  const activeModelMatch = modelsData?.activeModel
    ? modelsData.models.find((m) => m.tag === modelsData.activeModel && m.status === "loaded")
    : undefined;
  const activeModelLabel = activeModelMatch ? modelDisplayName(activeModelMatch) : null;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Track scroll for sticky header border
  useEffect(() => {
    const onScroll = () => setHeaderScrolled(window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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
    window.electronAPI.getAutoUpdateEnabled().then(setAutoUpdateEnabled);
    window.electronAPI.getAppVersion().then(setAppVersion);
    window.electronAPI.getUpdateStatus().then(setUpdateStatus);
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

  // Fetch models data via IPC (talks to main process, no API server auth needed)
  const fetchModels = useCallback(async () => {
    try {
      const data = await window.electronAPI.modelsList();
      setModelsData(data as ModelsData);
    } catch {
      // Inference server might not be ready yet
    }
  }, []);

  useEffect(() => {
    fetchModels();
    const interval = view === "models" ? 3000 : 10000;
    modelsInterval.current = setInterval(fetchModels, interval);
    return () => {
      if (modelsInterval.current) clearInterval(modelsInterval.current);
    };
  }, [status, view, fetchModels]);

  // Fetch health data (uptime + service checks) when server is running
  useEffect(() => {
    if (status !== "running") { setHealthData(null); return; }
    const fetchHealth = async () => {
      try {
        const data = await window.electronAPI.getHealth();
        setHealthData(data);
      } catch { /* not ready */ }
    };
    fetchHealth();
    healthInterval.current = setInterval(fetchHealth, 10000);
    return () => {
      if (healthInterval.current) clearInterval(healthInterval.current);
    };
  }, [status]);

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

  const [restarting, setRestarting] = useState(false);

  async function handleRestart() {
    setErrorMsg("");
    setRestarting(true);
    try {
      await window.electronAPI.stopServer();
      await new Promise((r) => setTimeout(r, 500));
      const result = await window.electronAPI.startServer();
      if (!result.success) setErrorMsg(result.error ?? "Failed to start server");
    } finally {
      setRestarting(false);
    }
  }

  async function handleWipeConfirm(e: FormEvent) {
    e.preventDefault();
    if (confirmText !== "WIPE") return;

    setActionInProgress(true);
    setErrorMsg("");
    try {
      const result = await window.electronAPI.instanceWipe();
      if (!result.success) {
        setErrorMsg(result.error ?? "Operation failed");
        setActionInProgress(false);
        return;
      }
      window.location.reload();
    } catch (err) {
      setErrorMsg(String(err));
      setActionInProgress(false);
    }
  }

  function handleSwitchProviderChange(providerId: string) {
    const prov = AUTH_PROVIDER_OPTIONS.find((p) => p.id === providerId);
    setSwitchProvider(providerId);
    setSwitchIssuer(prov?.defaultIssuer ?? "");
    setSwitchClientId("");
    setSwitchClientSecret("");
  }

  async function handleSwitchAuth(e: FormEvent) {
    e.preventDefault();
    const issuer = switchProvider === "google" ? "https://accounts.google.com" : switchIssuer.trim();
    if (!issuer || !switchClientId.trim() || !switchClientSecret.trim() || !switchAdminEmails.trim()) {
      setErrorMsg("All fields are required.");
      return;
    }

    setActionInProgress(true);
    setErrorMsg("");
    try {
      const result = await window.electronAPI.instanceReconfigureAuth({
        oidcProvider: switchProvider,
        oidcIssuer: issuer,
        oidcClientId: switchClientId.trim(),
        oidcClientSecret: switchClientSecret.trim(),
        adminEmails: switchAdminEmails.split(",").map((e) => e.trim()).filter(Boolean),
      });
      if (!result.success) {
        setErrorMsg(result.error ?? "Failed to switch auth provider");
        setActionInProgress(false);
        return;
      }
      setDangerAction(null);
      setSwitchClientId("");
      setSwitchClientSecret("");
      setActionInProgress(false);
      await handleRestart();
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
    // Scroll to download progress after React re-renders
    setTimeout(() => {
      document.getElementById("download-progress")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    try {
      const result = await window.electronAPI.modelsPull(tag);
      if (!result.success) {
        setModelError(result.error ?? "Failed to start download");
        setPullTag(null);
      }
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "Download failed");
      setPullTag(null);
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
        <div className={`view-header${headerScrolled ? " scrolled" : ""}`}>
          <button className="back-btn" onClick={() => { setView("home"); setModelError(""); }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Back
          </button>
          <h2 className="view-title">Models</h2>
          <span />
        </div>

        {!modelsData ? (
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
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/><path d="M8 11V9"/><path d="M16 11V9"/><path d="M12 11V9"/><path d="M2 15h20"/><path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.837V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.837Z"/></svg>
                          Memory
                        </span>
                        <span className="resource-bar-value">
                          {formatGB(ramAvailable)} available / {formatGB(ramTotal)} total
                        </span>
                      </div>
                      <div className="resource-bar-track">
                        <div className="resource-bar-fill" style={{ width: `${pctOf(otherUsed)}%`, background: "#64748b", borderRadius: "3px 0 0 3px" }} />
                        {edgebricRam > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${pctOf(edgebricRam)}%`, background: "#3b82f6" }} />
                        )}
                        {embeddingRam > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${pctOf(embeddingRam)}%`, background: "#06b6d4" }} />
                        )}
                        {modelRam > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${pctOf(modelRam)}%`, background: "#22c55e", borderRadius: "0 3px 3px 0" }} />
                        )}
                      </div>
                      <div className="resource-bar-legend">
                        {modelRam > 0 && loadedModels.filter((m) => m.ramUsageBytes).map((m) => (
                          <span key={m.tag} className="legend-item">
                            <span className="legend-dot" style={{ background: "#22c55e" }} />
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
                            <span className="legend-dot" style={{ background: "#3b82f6" }} />
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
                  const modelsSize = st?.modelsBytes ?? 0;
                  const uploadsBytes = st?.uploadsBytes ?? 0;
                  const dbBytes = st?.dbBytes ?? 0;
                  const vaultBytes = st?.vaultBytes ?? 0;
                  const embeddingDisk = embeddingModel?.sizeBytes ?? 0;
                  const edgebricTotal = modelsSize + uploadsBytes + dbBytes + vaultBytes;
                  const pctOf = (bytes: number) => diskTotal > 0 ? Math.max(0, (bytes / diskTotal) * 100) : 0;
                  const otherUsed = Math.max(0, diskUsed - edgebricTotal);
                  return (
                    <div className="resource-bar-item">
                      <div className="resource-bar-label">
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/></svg>
                          Disk
                        </span>
                        <span className="resource-bar-value">{formatGB(diskUsed)} / {formatGB(diskTotal)}</span>
                      </div>
                      <div className="resource-bar-track">
                        <div className="resource-bar-fill" style={{ width: `${pctOf(otherUsed)}%`, background: "#64748b", borderRadius: "3px 0 0 3px" }} />
                        {modelsSize > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${pctOf(modelsSize)}%`, background: "#22c55e" }} />
                        )}
                        {uploadsBytes > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${pctOf(uploadsBytes)}%`, background: "#06b6d4" }} />
                        )}
                        {vaultBytes > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${pctOf(vaultBytes)}%`, background: "#f59e0b" }} />
                        )}
                        {dbBytes > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${pctOf(dbBytes)}%`, background: "#8b5cf6", borderRadius: "0 3px 3px 0" }} />
                        )}
                      </div>
                      <div className="resource-bar-legend">
                        {modelsSize > 0 && (
                          <span className="legend-item">
                            <span className="legend-dot" style={{ background: "#22c55e" }} />
                            AI Models {formatBytes(modelsSize)}
                          </span>
                        )}
                        {uploadsBytes > 0 && (
                          <span className="legend-item">
                            <span className="legend-dot" style={{ background: "#06b6d4" }} />
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
                          </div>
                          <span className="model-item-meta">
                            {m.catalogEntry?.family ? `by ${m.catalogEntry.family} · ` : ""}{m.ramUsageBytes != null ? `${formatBytes(m.ramUsageBytes)} RAM · ` : ""}{formatBytes(m.sizeBytes)} on disk
                          </span>
                          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                            <CapabilityBadges capabilities={m.catalogEntry?.capabilities ?? m.capabilities} />
                          </div>
                        </div>
                        <div className="btn-row" style={{ marginTop: 0, alignItems: "center" }}>
                          <span className="model-badge model-badge-active model-badge-lg">Loaded</span>
                          {m.tag === modelsData?.activeModel && unloadConfirmTag !== m.tag ? (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setUnloadConfirmTag(m.tag)}
                              disabled={!!modelOp}
                            >
                              Stop
                            </button>
                          ) : unloadConfirmTag === m.tag ? (
                            <>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => { setUnloadConfirmTag(null); handleUnloadModel(m.tag); }}
                                disabled={!!modelOp}
                              >
                                {isOpTarget && modelOp?.type === "unload" ? "..." : "Confirm"}
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => setUnloadConfirmTag(null)}
                                disabled={!!modelOp}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => handleUnloadModel(m.tag)}
                              disabled={!!modelOp}
                            >
                              {isOpTarget && modelOp?.type === "unload" ? "..." : "Stop"}
                            </button>
                          )}
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
                              <span className="model-badge model-badge-danger">Too large</span>
                            )}
                            {fit.level === "tight" && (
                              <span className="model-badge model-badge-warning">Low RAM</span>
                            )}
                          </div>
                          <span className="model-item-meta">
                            {m.catalogEntry?.family ? `by ${m.catalogEntry.family} · ` : ""}{formatBytes(m.sizeBytes)} on disk
                          </span>
                          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                            <CapabilityBadges capabilities={m.catalogEntry?.capabilities ?? m.capabilities} />
                          </div>
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
                            {isOpTarget && modelOp?.type === "load" ? (
                              "Loading..."
                            ) : (
                              <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>Load</>
                            )}
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
              <section className="card" id="download-progress">
                <h3 className="card-heading">Downloading</h3>
                <div className="model-item">
                  <div className="model-item-left" style={{ flex: 1 }}>
                    <div className="model-item-name">{pullTag}</div>
                    <div className="resource-bar-track" style={{ marginTop: 6 }}>
                      <div className="resource-bar-fill" style={{ width: `${pullPercent}%`, background: "#22c55e", transition: "width 0.3s" }} />
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
                          <span className="model-badge model-badge-danger">Too large</span>
                        )}
                        {fit.level === "tight" && (
                          <span className="model-badge model-badge-warning">Low RAM</span>
                        )}
                      </div>
                      <span className="model-item-meta">by {c.family} · {c.description}</span>
                      <span className="model-item-meta">
                        {c.downloadSizeGB} GB download · {c.ramUsageGB} GB RAM
                      </span>
                      <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                        <CapabilityBadges capabilities={c.capabilities} />
                      </div>
                      {fit.level !== "ok" && (
                        <span className="model-item-meta" style={{ color: fit.level === "exceeds" ? "#dc2626" : "#d97706", fontWeight: 500 }}>
                          {fit.message}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {c.huggingFaceUrl && (
                        <a href={c.huggingFaceUrl} target="_blank" rel="noopener noreferrer" className="model-details-link">Details</a>
                      )}
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handlePullModel(c.tag)}
                        disabled={!!pullTag || !!modelOp}
                      >
                        Download
                      </button>
                    </div>
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
                        {m.description && (
                          <span className="model-item-meta">
                            {m.description}
                            <CapabilityBadges capabilities={m.capabilities} />
                          </span>
                        )}
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          handlePullModel(m.name);
                          setSearchQuery("");
                          setSearchResults([]);
                        }}
                        disabled={!!pullTag || !!modelOp}
                      >
                        Download
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {searchQuery.trim().length >= 2 && !searchLoading && searchResults.length === 0 && (
                <p className="hint" style={{ margin: "4px 0" }}>
                  No results. You can try installing directly:
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ marginLeft: 8 }}
                    onClick={() => {
                      handlePullModel(searchQuery.trim());
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                    disabled={!!pullTag}
                  >
                    Download "{searchQuery.trim()}"
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
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="hint" style={{ margin: 0, wordBreak: "break-all" }}>
                    {ggufPath.split("/").pop()}
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
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

            <p className="hint" style={{ textAlign: "center", padding: "4px 0 8px" }}>
              Models power everything AI does — answering questions, searching your documents, and more. Loading a model keeps it ready in memory (RAM), so unload ones you're not using to free up resources.
            </p>
          </div>
        )}
      </div>
    );
  }

  // ─── Settings View ──────────────────────────────────────────────────────────

  if (view === "settings") {
    return (
      <div className={`dashboard dashboard-settings${dangerAction ? " dashboard-flow" : ""}`}>
        <div className={`view-header${headerScrolled ? " scrolled" : ""}`}>
          <button className="back-btn" onClick={() => { setView("home"); setErrorMsg(""); setDangerAction(null); }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Back
          </button>
          <h2 className="view-title">Settings</h2>
          <span />
        </div>

        {!dangerAction ? (
          <div className="settings-content">
            <section className="card">
              <h3 className="card-heading">General</h3>
                <div className="field" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <label style={{ marginBottom: 0 }}>Launch at Login</label>
                    <p className="hint" style={{ marginTop: 6 }}>Start Edgebric automatically when you log in to your Mac.</p>
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

              <section className="card">
                <h3 className="card-heading">Updates</h3>
                <div className="field" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <label style={{ marginBottom: 0 }}>Edgebric {appVersion ? `v${appVersion}` : ""}</label>
                    <p className="hint" style={{ marginTop: 6 }}>
                      {updateStatus.availableVersion
                        ? `Update available: v${updateStatus.availableVersion}`
                        : "You're on the latest version."}
                    </p>
                  </div>
                </div>
                <div className="field" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <label style={{ marginBottom: 0 }}>Automatic Updates</label>
                    <p className="hint" style={{ marginTop: 6 }}>Check for updates automatically when Edgebric starts.</p>
                  </div>
                  <button
                    className={`toggle-btn ${autoUpdateEnabled ? "toggle-on" : ""}`}
                    onClick={async () => {
                      const newVal = !autoUpdateEnabled;
                      setAutoUpdateEnabled(newVal);
                      await window.electronAPI.setAutoUpdateEnabled(newVal);
                    }}
                    type="button"
                    aria-pressed={autoUpdateEnabled}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
                <div className="field">
                  {updateStatus.downloaded ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span className="success-msg" style={{ margin: 0 }}>Update ready — restart to install</span>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          window.electronAPI.checkForUpdates();
                        }}
                      >
                        Restart Now
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={updateStatus.checking || updateStatus.downloading}
                      onClick={async () => {
                        setUpdateStatus(prev => ({ ...prev, checking: true }));
                        const result = await window.electronAPI.checkForUpdates();
                        setUpdateStatus(result);
                      }}
                    >
                      {updateStatus.checking
                        ? "Checking..."
                        : updateStatus.downloading
                          ? "Downloading update..."
                          : "Check for Updates"}
                    </button>
                  )}
                </div>
              </section>

              <section className="card card-danger">
                <h3 className="card-heading card-heading-danger">Danger Zone</h3>
                <div className="danger-item">
                  <div>
                    <p className="danger-item-title">Switch Auth Provider</p>
                    <p className="danger-item-desc">Change your identity provider. Sources, documents, and chat history are preserved. Users are matched by email.</p>
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={() => { setDangerAction("switchAuth"); setSwitchStep("provider"); setErrorMsg(""); }}>
                    Switch
                  </button>
                </div>
                <div className="danger-item">
                  <div>
                    <p className="danger-item-title">Factory Reset</p>
                    <p className="danger-item-desc">Deletes all data, sessions, and configuration. Cannot be undone.</p>
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={() => { setDangerAction("wipe"); setConfirmText(""); setErrorMsg(""); }}>
                    Reset
                  </button>
                </div>
              </section>
          </div>
        ) : dangerAction === "wipe" ? (
            <form onSubmit={handleWipeConfirm} className="settings-flow">
              <div className="settings-content">
                <section className="card">
                  <h3 className="card-heading card-heading-danger">Factory Reset</h3>
                  <div className="danger-warning">
                    This will permanently delete all data including documents, sources, conversations, and configuration. This cannot be undone.
                  </div>
                  <div className="field">
                    <label>
                      Type <strong>WIPE</strong> to confirm
                    </label>
                    <input
                      type="text"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="WIPE"
                      autoFocus
                      disabled={actionInProgress}
                    />
                  </div>
                  {errorMsg && <div className="error-msg">{errorMsg}</div>}
                </section>
              </div>
              <div className="settings-footer">
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
                  disabled={confirmText !== "WIPE" || actionInProgress}
                >
                  {actionInProgress ? "Working..." : "Wipe Everything"}
                </button>
              </div>
            </form>
          ) : switchStep === "provider" ? (
            <div className="settings-flow">
              <div className="settings-content">
                <section className="card">
                  <h3 className="card-heading">Switch Auth Provider</h3>
                  <p className="description" style={{ marginBottom: 12 }}>
                    Choose the identity provider to switch to. Your sources, documents, and chat history will be preserved. Users are matched by email address.
                  </p>
                  <div className="provider-list">
                    {AUTH_PROVIDER_OPTIONS.map((provider) => (
                      <label
                        key={provider.id}
                        className={`provider-option ${switchProvider === provider.id ? "selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name="switchProvider"
                          value={provider.id}
                          checked={switchProvider === provider.id}
                          onChange={() => handleSwitchProviderChange(provider.id)}
                        />
                        <span className="provider-icon">{provider.icon}</span>
                        <span className="provider-name">{provider.name}</span>
                      </label>
                    ))}
                  </div>
                </section>
              </div>
              <div className="settings-footer">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setDangerAction(null); setErrorMsg(""); }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => { setSwitchStep("credentials"); setErrorMsg(""); }}
                >
                  Next
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSwitchAuth} className="settings-flow">
              <div className="settings-content">
                <section className="card">
                  <h3 className="card-heading">{AUTH_PROVIDER_OPTIONS.find((p) => p.id === switchProvider)?.name} Credentials</h3>
                  <div className={switchProvider !== "generic" ? "step3-split" : ""}>
                    {/* ── Provider-specific setup guides ─────────────────────── */}
                    {switchProvider === "google" && (
                      <div className="step3-guide">
                        <h3 className="guide-heading">Setup Guide</h3>
                        <ol className="setup-steps">
                          <li>Go to{" "}<a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="docs-link">Google Cloud Console &gt; Credentials</a></li>
                          <li>If you haven't already, configure the <strong>OAuth consent screen</strong> (Internal for Workspace, or External for testing)</li>
                          <li>Click <strong>+ CREATE CREDENTIALS</strong>, then <strong>OAuth client ID</strong></li>
                          <li>Application type: <strong>Web application</strong></li>
                          <li>Under <strong>Authorized redirect URIs</strong>, add the redirect URI from the form</li>
                          <li>Click <strong>CREATE</strong></li>
                          <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> into the form</li>
                        </ol>
                      </div>
                    )}
                    {switchProvider === "microsoft" && (
                      <div className="step3-guide">
                        <h3 className="guide-heading">Setup Guide</h3>
                        <ol className="setup-steps">
                          <li>Go to{" "}<a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer" className="docs-link">Microsoft Entra admin center &gt; App registrations</a></li>
                          <li>Click <strong>+ New registration</strong></li>
                          <li>Name: <strong>Edgebric</strong>, account type: <strong>Single tenant</strong></li>
                          <li>Redirect URI: select <strong>Web</strong>, paste the redirect URI from the form</li>
                          <li>Click <strong>Register</strong></li>
                          <li>Copy the <strong>Application (client) ID</strong> and <strong>Directory (tenant) ID</strong></li>
                          <li>Go to <strong>Certificates &amp; secrets</strong> &gt; <strong>+ New client secret</strong> &gt; copy the <strong>Value</strong> immediately</li>
                          <li>Go to <strong>API permissions</strong> &gt; add <strong>User.Read</strong> (Microsoft Graph, Delegated)</li>
                          <li>Go to <strong>Token configuration</strong> &gt; <strong>+ Add optional claim</strong> &gt; ID token &gt; <strong>email</strong></li>
                        </ol>
                        <p className="hint" style={{ marginTop: 8 }}>Steps 8-9 are critical for login and profile photo sync.</p>
                      </div>
                    )}
                    {switchProvider === "okta" && (
                      <div className="step3-guide">
                        <h3 className="guide-heading">Setup Guide</h3>
                        <ol className="setup-steps">
                          <li>Sign in to your{" "}<a href="https://login.okta.com/" target="_blank" rel="noopener noreferrer" className="docs-link">Okta admin console</a></li>
                          <li>Go to <strong>Applications</strong> &gt; <strong>Create App Integration</strong></li>
                          <li>Sign-in method: <strong>OIDC</strong>, type: <strong>Web Application</strong></li>
                          <li>Name: <strong>Edgebric</strong></li>
                          <li>Sign-in redirect URIs: paste the redirect URI from the form</li>
                          <li>Under <strong>Assignments</strong>, choose who can access the app</li>
                          <li>Click <strong>Save</strong>, then copy <strong>Client ID</strong> and <strong>Client secret</strong></li>
                        </ol>
                        <p className="hint" style={{ marginTop: 8 }}>Issuer URL is typically <code>https://your-company.okta.com/oauth2/default</code></p>
                      </div>
                    )}
                    {switchProvider === "onelogin" && (
                      <div className="step3-guide">
                        <h3 className="guide-heading">Setup Guide</h3>
                        <ol className="setup-steps">
                          <li>Sign in to your{" "}<a href="https://app.onelogin.com/apps" target="_blank" rel="noopener noreferrer" className="docs-link">OneLogin admin portal</a></li>
                          <li>Go to <strong>Applications</strong> &gt; <strong>Add App</strong></li>
                          <li>Search for <strong>OpenID Connect (OIDC)</strong> and select it</li>
                          <li>Name: <strong>Edgebric</strong> &gt; <strong>Save</strong></li>
                          <li>Go to <strong>Configuration</strong> tab, paste the redirect URI</li>
                          <li>Set <strong>Token Endpoint</strong> auth method to <strong>POST</strong></li>
                          <li>Go to <strong>SSO</strong> tab, copy <strong>Client ID</strong> and <strong>Client Secret</strong></li>
                        </ol>
                        <p className="hint" style={{ marginTop: 8 }}>Issuer URL: <code>https://YOUR-SUBDOMAIN.onelogin.com/oidc/2</code></p>
                      </div>
                    )}
                    {switchProvider === "ping" && (
                      <div className="step3-guide">
                        <h3 className="guide-heading">Setup Guide</h3>
                        <ol className="setup-steps">
                          <li>Sign in to your{" "}<a href="https://console.pingone.com/" target="_blank" rel="noopener noreferrer" className="docs-link">PingOne admin console</a></li>
                          <li>Go to <strong>Applications</strong> &gt; <strong>+</strong> to add an application</li>
                          <li>Name: <strong>Edgebric</strong>, type: <strong>OIDC Web App</strong></li>
                          <li>Redirect URIs: paste from the form</li>
                          <li>Grant type: <strong>Authorization Code</strong></li>
                          <li>Click <strong>Save</strong>, copy <strong>Client ID</strong> and <strong>Client Secret</strong></li>
                          <li>Note the <strong>Issuer</strong> URL from the Configuration tab</li>
                        </ol>
                        <p className="hint" style={{ marginTop: 8 }}>Region domains: <code>auth.pingone.com</code> (US), <code>.eu</code>, <code>.ca</code>, <code>.asia</code></p>
                      </div>
                    )}

                    {/* ── Credential form ─────────────────────────────────── */}
                    <div className="step3-form">
                      {switchProvider !== "google" && (
                        <div className="field">
                          <label>Issuer URL</label>
                          <input
                            type="text"
                            value={switchIssuer}
                            onChange={(e) => setSwitchIssuer(e.target.value)}
                            placeholder={AUTH_PROVIDER_OPTIONS.find((p) => p.id === switchProvider)?.issuerHint ?? ""}
                            disabled={actionInProgress}
                          />
                          {switchProvider === "microsoft" && (
                            <p className="hint">Format: <code>https://login.microsoftonline.com/TENANT-ID/v2.0</code></p>
                          )}
                        </div>
                      )}
                      <div className="field">
                        <label>Redirect URI</label>
                        <div className="input-with-copy">
                          <input
                            type="text"
                            readOnly
                            value={`https://${hostname}:${port}/api/auth/callback`}
                            className="readonly"
                            onClick={(e) => (e.target as HTMLInputElement).select()}
                          />
                          <button
                            type="button"
                            className="copy-btn"
                            onClick={() => {
                              navigator.clipboard.writeText(`https://${hostname}:${port}/api/auth/callback`);
                            }}
                          >
                            Copy
                          </button>
                        </div>
                        <p className="hint">Paste this as the redirect URI in your {AUTH_PROVIDER_OPTIONS.find((p) => p.id === switchProvider)?.name} app configuration.</p>
                      </div>
                      <div className="field">
                        <label>Client ID</label>
                        <input
                          type="text"
                          value={switchClientId}
                          onChange={(e) => setSwitchClientId(e.target.value)}
                          placeholder={AUTH_PROVIDER_OPTIONS.find((p) => p.id === switchProvider)?.clientIdHint ?? ""}
                          disabled={actionInProgress}
                        />
                      </div>
                      <div className="field">
                        <label>Client Secret</label>
                        <input
                          type="password"
                          value={switchClientSecret}
                          onChange={(e) => setSwitchClientSecret(e.target.value)}
                          disabled={actionInProgress}
                        />
                        <p className="hint">
                          {switchProvider === "microsoft"
                            ? "The Value (not Secret ID) from Certificates & secrets. Only shown once."
                            : "Some providers only show this once \u2014 you may need to generate a new one."}
                        </p>
                      </div>
                      <div className="field">
                        <label>Admin Emails</label>
                        <input
                          type="text"
                          value={switchAdminEmails}
                          onChange={(e) => setSwitchAdminEmails(e.target.value)}
                          placeholder="admin@company.com, cto@company.com"
                          disabled={actionInProgress}
                        />
                        <p className="hint">Comma-separated. These users get admin access after login.</p>
                      </div>
                    </div>
                  </div>

                  {errorMsg && <div className="error-msg">{errorMsg}</div>}
                </section>
              </div>
              <div className="settings-footer">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setSwitchStep("provider"); setErrorMsg(""); }}
                  disabled={actionInProgress}
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={actionInProgress}
                >
                  {actionInProgress ? "Switching..." : "Switch"}
                </button>
              </div>
            </form>
          )}
      </div>
    );
  }

  // ─── Home View ──────────────────────────────────────────────────────────────

  return (
    <div className="dashboard">
      <div className="dashboard-main">
        <div className="hero">
          <div className="hero-brand">
            <img src={isDark ? logoDark : logoLight} alt="Edgebric" className="hero-logo" />
            <h1 className="hero-title">Edgebric</h1>
          </div>
          <p className="hero-subtitle">You can close this window — Edgebric lives in your menu bar.</p>
        </div>

        <div className="card" style={{ width: "100%" }}>
          {/* Status + uptime + controls */}
          <div className="status-row">
            <div className="status-left">
              <span className="status-dot" style={{ background: statusConf.dot }} />
              <span className="status-label">{statusConf.label}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {isRunning && healthData?.uptime != null && (
                <span className="resource-bar-value" style={{ fontSize: 11 }}>
                  Uptime: {formatUptime(healthData.uptime)}
                </span>
              )}
              <div className="btn-row">
                {isStopped && (
                  <button className="btn btn-primary btn-sm" onClick={handleStart}>Start</button>
                )}
                {status === "starting" && (
                  <button className="btn btn-ghost btn-sm" disabled>Starting...</button>
                )}
                {isRunning && !restarting && (
                  <>
                    <button className="btn btn-ghost btn-sm" onClick={handleRestart}>Restart</button>
                    <button className="btn btn-danger-ghost btn-sm" onClick={handleStop}>Stop</button>
                  </>
                )}
                {restarting && (
                  <button className="btn btn-ghost btn-sm" disabled>Restarting...</button>
                )}
              </div>
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

          {/* Health checks — collapsed behind toggle */}
          {isRunning && healthData?.checks && (() => {
            const allOk = Object.values(healthData.checks).every((c) => c.status === "ok");
            return (
              <div className="card-section-divider">
                <button
                  onClick={() => setChecksOpen(!checksOpen)}
                  className="checks-toggle"
                >
                  <span className="status-dot" style={{ width: 6, height: 6, background: allOk ? "#22c55e" : "#ef4444" }} />
                  <span>{allOk ? "All services healthy" : "Service issue detected"}</span>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginLeft: "auto", transform: checksOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
                    <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {checksOpen && (
                  <div style={{ marginTop: 6 }}>
                    {Object.entries(healthData.checks).map(([name, check]) => {
                      const tooltip = HEALTH_CHECK_TOOLTIPS[name] ?? "";
                      const displayName = name.replace(/([A-Z])/g, " $1").trim();
                      return (
                        <div key={name} className="url-row" style={{ marginTop: 4, paddingTop: 0, borderTop: "none" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span className="status-dot" style={{ width: 5, height: 5, background: check.status === "ok" ? "#22c55e" : "#ef4444" }} />
                            <span className="url-label" style={{ textTransform: "capitalize" }} title={tooltip}>{displayName}</span>
                          </div>
                          <span className="resource-bar-value" style={{ fontFamily: "monospace" }}>
                            {check.status === "ok" ? `${check.latencyMs ?? 0}ms` : check.error ?? "error"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {errorMsg && <div className="error-msg">{errorMsg}</div>}

          {/* System Resources — merged into status card */}
          {isRunning && (() => {
            const sys = modelsData?.system;
            if (!sys) return null;
            const ramTotal = sys.ramTotalBytes ?? 0;
            const ramAvailable = sys.ramAvailableBytes ?? 0;
            const ramUsed = ramTotal - ramAvailable;
            const diskTotal = sys.diskTotalBytes ?? 0;
            const diskUsed = diskTotal - (sys.diskFreeBytes ?? 0);
            const loadedModels = (modelsData?.models ?? []).filter((m) => m.status === "loaded" && m.tag !== EMBEDDING_TAG);
            const embeddingModel = (modelsData?.models ?? []).find((m) => m.tag === EMBEDDING_TAG && m.status === "loaded");
            const modelRam = loadedModels.filter((m) => m.ramUsageBytes).reduce((sum, m) => sum + (m.ramUsageBytes ?? 0), 0);
            const embeddingRam = embeddingModel?.ramUsageBytes ?? 0;
            const edgebricRam = sys.edgebricRamBytes ?? 0;
            const otherUsed = Math.max(0, ramUsed - modelRam - embeddingRam - edgebricRam);
            const pctOf = (bytes: number) => ramTotal > 0 ? Math.max(0, (bytes / ramTotal) * 100) : 0;

            return (
              <div className="card-section-divider">
                {/* RAM bar */}
                <div className="resource-bar-item" style={{ marginBottom: 10 }}>
                  <div className="resource-bar-label">
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/><path d="M8 11V9"/><path d="M16 11V9"/><path d="M12 11V9"/><path d="M2 15h20"/><path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.837V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.837Z"/></svg>
                      Memory
                    </span>
                    <span className="resource-bar-value">{formatGB(ramAvailable)} available / {formatGB(ramTotal)} total</span>
                  </div>
                  <div className="resource-bar-track">
                    <div className="resource-bar-fill" style={{ width: `${pctOf(otherUsed)}%`, background: "#64748b", borderRadius: "3px 0 0 3px" }} />
                    {edgebricRam > 0 && (
                      <div className="resource-bar-fill" style={{ width: `${pctOf(edgebricRam)}%`, background: "#3b82f6" }} />
                    )}
                    {embeddingRam > 0 && (
                      <div className="resource-bar-fill" style={{ width: `${pctOf(embeddingRam)}%`, background: "#06b6d4" }} />
                    )}
                    {modelRam > 0 && (
                      <div className="resource-bar-fill" style={{ width: `${pctOf(modelRam)}%`, background: "#22c55e", borderRadius: "0 3px 3px 0" }} />
                    )}
                  </div>
                </div>
                {/* Disk bar — segmented, matches models section */}
                {(() => {
                  const st = modelsData?.storage;
                  const modelsSize = st?.modelsBytes ?? 0;
                  const uploadsBytes = st?.uploadsBytes ?? 0;
                  const dbBytes = st?.dbBytes ?? 0;
                  const vaultBytes = st?.vaultBytes ?? 0;
                  const edgebricDisk = modelsSize + uploadsBytes + dbBytes + vaultBytes;
                  const otherDisk = Math.max(0, diskUsed - edgebricDisk);
                  const diskPctOf = (bytes: number) => diskTotal > 0 ? Math.max(0, (bytes / diskTotal) * 100) : 0;
                  return (
                    <div className="resource-bar-item">
                      <div className="resource-bar-label">
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/></svg>
                          Disk
                        </span>
                        <span className="resource-bar-value">{formatGB(diskUsed)} / {formatGB(diskTotal)}</span>
                      </div>
                      <div className="resource-bar-track">
                        <div className="resource-bar-fill" style={{ width: `${diskPctOf(otherDisk)}%`, background: "#64748b", borderRadius: "3px 0 0 3px" }} />
                        {modelsSize > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${diskPctOf(modelsSize)}%`, background: "#22c55e" }} />
                        )}
                        {uploadsBytes > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${diskPctOf(uploadsBytes)}%`, background: "#06b6d4" }} />
                        )}
                        {vaultBytes > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${diskPctOf(vaultBytes)}%`, background: "#f59e0b" }} />
                        )}
                        {dbBytes > 0 && (
                          <div className="resource-bar-fill" style={{ width: `${diskPctOf(dbBytes)}%`, background: "#8b5cf6", borderRadius: "0 3px 3px 0" }} />
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}
        </div>

        {isRunning && (
          <button className="btn btn-primary action-btn" style={{ width: "100%" }} onClick={() => window.open(accessUrl, "_blank")}>
            Use Edgebric
          </button>
        )}
      </div>

      <div className="bottom-actions">
        <button className="bottom-link" onClick={() => setView("models")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z"/><path d="M5 17l.6 1.4L7 19l-1.4.6L5 21l-.6-1.4L3 19l1.4-.6L5 17z"/></svg>
          Manage Models
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
