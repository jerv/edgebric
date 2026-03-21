import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // Logs
  readLogs: (lines?: number) => ipcRenderer.invoke("read-logs", lines),

  // Server status
  getStatus: () => ipcRenderer.invoke("get-status"),

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
