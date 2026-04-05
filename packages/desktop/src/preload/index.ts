import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // Logs
  readLogs: (lines?: number) => ipcRenderer.invoke("read-logs", lines),

  // Server status & control
  getStatus: () => ipcRenderer.invoke("get-status"),
  getHealth: () => ipcRenderer.invoke("get-health") as Promise<{ uptime: number | null; checks: Record<string, { status: string; latencyMs?: number; error?: string }> } | null>,
  startServer: () => ipcRenderer.invoke("start-server"),
  stopServer: () => ipcRenderer.invoke("stop-server"),
  onStatusChange: (callback: (status: string, errorMsg?: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: string, errorMsg?: string) => callback(status, errorMsg);
    ipcRenderer.on("server-status-changed", handler);
    return () => ipcRenderer.removeListener("server-status-changed", handler);
  },

  // Config
  getConfig: () => ipcRenderer.invoke("get-config"),
  isFirstRun: () => ipcRenderer.invoke("is-first-run"),
  getDefaultDataDir: () => ipcRenderer.invoke("get-default-data-dir"),

  // Setup
  saveSetup: (data: {
    mode: "solo" | "admin" | "member";
    dataDir: string;
    port: number;
    oidcProvider?: string;
    oidcIssuer?: string;
    oidcClientId?: string;
    oidcClientSecret?: string;
    adminEmails?: string[];
    chatBaseUrl?: string;
    chatModel?: string;
    orgServerUrl?: string;
    // Secondary node mesh setup
    meshToken?: string;
    secondaryNodeName?: string;
    primaryEndpoint?: string;
  }) => ipcRenderer.invoke("save-setup", data),

  // AI Engine (llama-server)
  getEngineStatus: () => ipcRenderer.invoke("engine-status"),
  installEngine: (version?: string) => ipcRenderer.invoke("install-engine", version),
  startEngine: () => ipcRenderer.invoke("start-engine"),
  stopEngine: () => ipcRenderer.invoke("stop-engine"),
  onEngineDownloadProgress: (callback: (percent: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, percent: number) => callback(percent);
    ipcRenderer.on("engine-download-progress", handler);
    return () => ipcRenderer.removeListener("engine-download-progress", handler);
  },

  // mDNS Discovery
  discoverInstances: () => ipcRenderer.invoke("discover-instances") as Promise<Array<{ name: string; host: string; port: number; addresses: string[] }>>,

  // Settings
  saveSettings: (data: { hostname: string; port: number }) => ipcRenderer.invoke("save-settings", data),
  getLaunchAtLogin: () => ipcRenderer.invoke("get-launch-at-login") as Promise<boolean>,
  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke("set-launch-at-login", enabled) as Promise<{ success: boolean }>,

  // Log window
  openLogWindow: () => ipcRenderer.invoke("open-log-window"),

  // Navigation from tray
  onNavigateTo: (callback: (view: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, view: string) => callback(view);
    ipcRenderer.on("navigate-to", handler);
    return () => ipcRenderer.removeListener("navigate-to", handler);
  },

  // Instance Management
  instanceWipe: () => ipcRenderer.invoke("instance-wipe"),
  instanceResetAuth: () => ipcRenderer.invoke("instance-reset-auth"),
  instanceReconfigureAuth: (data: {
    oidcProvider?: string;
    oidcIssuer: string;
    oidcClientId: string;
    oidcClientSecret: string;
    adminEmails: string[];
  }) => ipcRenderer.invoke("instance-reconfigure-auth", data),

  // Model Management (GGUF files via main process)
  modelsList: () => ipcRenderer.invoke("models-list"),
  modelsLoad: (tag: string) => ipcRenderer.invoke("models-load", tag),
  modelsUnload: (tag: string) => ipcRenderer.invoke("models-unload", tag),
  modelsDelete: (tag: string) => ipcRenderer.invoke("models-delete", tag),
  modelsPull: (tag: string) => ipcRenderer.invoke("models-pull", tag),
  modelsSetActive: (tag: string) => ipcRenderer.invoke("models-set-active", tag),
  modelsPickGguf: () => ipcRenderer.invoke("models-pick-gguf") as Promise<{ path: string | null }>,
  modelsImportGguf: (ggufPath: string, modelName: string) => ipcRenderer.invoke("models-import-gguf", ggufPath, modelName) as Promise<{ success: boolean; error?: string }>,
  modelsSearch: (query: string) => ipcRenderer.invoke("models-search", query) as Promise<{ models: Array<{ name: string; description: string; tags?: string[]; huggingFaceUrl?: string; capabilities?: { vision: boolean; toolUse: boolean; reasoning: boolean } }>; error?: string }>,
  onModelPullProgress: (callback: (data: { tag: string; status: string; percent: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { tag: string; status: string; percent: number }) => callback(data);
    ipcRenderer.on("model-pull-progress", handler);
    return () => ipcRenderer.removeListener("model-pull-progress", handler);
  },
});
