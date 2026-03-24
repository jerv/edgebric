import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // Logs
  readLogs: (lines?: number) => ipcRenderer.invoke("read-logs", lines),

  // Server status & control
  getStatus: () => ipcRenderer.invoke("get-status"),
  startServer: () => ipcRenderer.invoke("start-server"),
  stopServer: () => ipcRenderer.invoke("stop-server"),
  onStatusChange: (callback: (status: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: string) => callback(status);
    ipcRenderer.on("server-status-changed", handler);
    return () => ipcRenderer.removeListener("server-status-changed", handler);
  },

  // Config
  getConfig: () => ipcRenderer.invoke("get-config"),
  isFirstRun: () => ipcRenderer.invoke("is-first-run"),
  getDefaultDataDir: () => ipcRenderer.invoke("get-default-data-dir"),

  // Setup
  saveSetup: (data: {
    dataDir: string;
    port: number;
    oidcIssuer: string;
    oidcClientId: string;
    oidcClientSecret: string;
    adminEmails: string[];
    chatBaseUrl?: string;
    chatModel?: string;
  }) => ipcRenderer.invoke("save-setup", data),
});
