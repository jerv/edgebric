import { useState, useEffect } from "react";
import SetupWizard from "./pages/SetupWizard.js";
import ServerDashboard from "./pages/ServerDashboard.js";
import "./styles.css";

declare global {
  interface Window {
    electronAPI: {
      readLogs: (lines?: number) => Promise<string>;
      getStatus: () => Promise<{ status: string; port: number; hostname?: string; errorMsg?: string }>;
      getHealth: () => Promise<{ uptime: number | null; checks: Record<string, { status: string; latencyMs?: number; error?: string }> } | null>;
      startServer: () => Promise<{ success: boolean; error?: string }>;
      stopServer: () => Promise<{ success: boolean; error?: string }>;
      onStatusChange: (callback: (status: string, errorMsg?: string) => void) => () => void;
      getConfig: () => Promise<Record<string, unknown> | null>;
      isFirstRun: () => Promise<boolean>;
      getDefaultDataDir: () => Promise<string>;
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
        meshToken?: string;
        secondaryNodeName?: string;
        primaryEndpoint?: string;
      }) => Promise<{ success: boolean }>;
      // Ollama / AI Engine
      getOllamaStatus: () => Promise<{ installed: boolean; running: boolean; version: string | null }>;
      installOllama: (version?: string) => Promise<{ success: boolean; error?: string }>;
      startOllama: () => Promise<{ success: boolean; external?: boolean; error?: string }>;
      stopOllama: () => Promise<{ success: boolean; error?: string }>;
      onOllamaDownloadProgress: (callback: (percent: number) => void) => () => void;
      // mDNS Discovery
      discoverInstances: () => Promise<Array<{ name: string; host: string; port: number; addresses: string[] }>>;
      // Settings
      saveSettings: (data: { hostname: string; port: number }) => Promise<{ success: boolean; error?: string }>;
      getLaunchAtLogin: () => Promise<boolean>;
      setLaunchAtLogin: (enabled: boolean) => Promise<{ success: boolean }>;
      // Log window
      openLogWindow: () => Promise<void>;
      // Navigation from tray
      onNavigateTo: (callback: (view: string) => void) => () => void;
      // Instance Management
      instanceWipe: () => Promise<{ success: boolean; error?: string }>;
      instanceResetAuth: () => Promise<{ success: boolean; error?: string }>;
      instanceReconfigureAuth: (data: {
        oidcProvider?: string;
        oidcIssuer: string;
        oidcClientId: string;
        oidcClientSecret: string;
        adminEmails: string[];
      }) => Promise<{ success: boolean; error?: string }>;
      // Model Management
      modelsList: () => Promise<ModelsListResult>;
      modelsLoad: (tag: string) => Promise<{ success: boolean; error?: string }>;
      modelsUnload: (tag: string) => Promise<{ success: boolean; error?: string }>;
      modelsDelete: (tag: string) => Promise<{ success: boolean; error?: string }>;
      modelsPull: (tag: string) => Promise<{ success: boolean; error?: string }>;
      modelsSetActive: (tag: string) => Promise<{ success: boolean }>;
      modelsPickGguf: () => Promise<{ path: string | null }>;
      modelsImportGguf: (ggufPath: string, modelName: string) => Promise<{ success: boolean; error?: string }>;
      modelsSearch: (query: string) => Promise<{ models: Array<{ name: string; description: string }>; error?: string }>;
      onModelPullProgress: (callback: (data: { tag: string; status: string; percent: number }) => void) => () => void;
    };
  }
}

interface ModelsListResult {
  models: Array<{
    tag: string; name: string; sizeBytes: number; digest: string;
    modifiedAt: string; status: string; ramUsageBytes?: number;
    catalogEntry?: { tag: string; name: string; family: string; description: string; paramCount: string; downloadSizeGB: number; ramUsageGB: number; origin: string; tier: string; minRAMGB: number; hidden?: boolean };
  }>;
  catalog: Array<{ tag: string; name: string; family: string; description: string; paramCount: string; downloadSizeGB: number; ramUsageGB: number; origin: string; tier: string; minRAMGB: number; hidden?: boolean }>;
  activeModel: string;
  system: { ramTotalBytes: number; ramAvailableBytes: number; diskFreeBytes: number; diskTotalBytes: number; edgebricRamBytes?: number };
  mode?: string;
  storage?: { dbBytes: number; uploadsBytes: number; ollamaModelsBytes: number; vaultBytes: number };
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [isSetup, setIsSetup] = useState(true);

  useEffect(() => {
    window.electronAPI.isFirstRun().then((firstRun) => {
      setIsSetup(firstRun);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div className="loading">
        <p>Loading...</p>
      </div>
    );
  }

  if (isSetup) {
    return <SetupWizard onComplete={() => setIsSetup(false)} />;
  }

  return <ServerDashboard />;
}
