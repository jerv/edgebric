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
        dataDir: string;
        port: number;
        oidcIssuer: string;
        oidcClientId: string;
        oidcClientSecret: string;
        adminEmails: string[];
        chatBaseUrl?: string;
        chatModel?: string;
      }) => Promise<{ success: boolean }>;
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
