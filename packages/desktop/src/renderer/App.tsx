import { useState, useEffect } from "react";
import SetupWizard from "./pages/SetupWizard.js";
import ServerDashboard from "./pages/ServerDashboard.js";
import "./styles.css";

declare global {
  interface Window {
    electronAPI: {
      readLogs: (lines?: number) => Promise<string>;
      getStatus: () => Promise<{ status: string; port: number; hostname?: string }>;
      startServer: () => Promise<{ success: boolean; error?: string }>;
      stopServer: () => Promise<{ success: boolean; error?: string }>;
      onStatusChange: (callback: (status: string) => void) => () => void;
      getConfig: () => Promise<Record<string, unknown> | null>;
      isFirstRun: () => Promise<boolean>;
      getDefaultDataDir: () => Promise<string>;
      saveSetup: (data: {
        mode: "solo" | "admin" | "member";
        dataDir: string;
        port: number;
        oidcIssuer?: string;
        oidcClientId?: string;
        oidcClientSecret?: string;
        adminEmails?: string[];
        chatBaseUrl?: string;
        chatModel?: string;
        orgServerUrl?: string;
      }) => Promise<{ success: boolean }>;
      // Ollama / AI Engine
      getOllamaStatus: () => Promise<{ installed: boolean; running: boolean; version: string | null }>;
      installOllama: (version?: string) => Promise<{ success: boolean; error?: string }>;
      startOllama: () => Promise<{ success: boolean; external?: boolean; error?: string }>;
      stopOllama: () => Promise<{ success: boolean; error?: string }>;
      onOllamaDownloadProgress: (callback: (percent: number) => void) => () => void;
      // License
      validateLicense: (key: string) => Promise<{ valid: boolean; error?: string }>;
      // mDNS Discovery
      discoverInstances: () => Promise<Array<{ name: string; host: string; port: number; addresses: string[] }>>;
      // Settings
      saveSettings: (data: { hostname: string; port: number }) => Promise<{ success: boolean; error?: string }>;
      // Log window
      openLogWindow: () => Promise<void>;
      // Navigation from tray
      onNavigateTo: (callback: (view: string) => void) => () => void;
      // Instance Management
      instanceWipe: () => Promise<{ success: boolean; error?: string }>;
      instanceResetAuth: () => Promise<{ success: boolean; error?: string }>;
      instanceReconfigureAuth: (data: {
        oidcIssuer: string;
        oidcClientId: string;
        oidcClientSecret: string;
        adminEmails: string[];
      }) => Promise<{ success: boolean; error?: string }>;
    };
  }
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
