import React, { useState, useEffect } from "react";
import logoLight from "../assets/logo-black.svg";
import logoDark from "../assets/logo-white.svg";

interface Props {
  onComplete: () => void;
}

type EdgebricMode = "solo" | "admin" | "member";
type SetupIntent = "new" | "connect";
type ConnectType = "member" | "secondary";

interface AuthProvider {
  id: string;
  name: string;
  issuerUrl: string;
  issuerHint?: string;
  instructions: string;
  docsUrl: string;
  clientIdHint?: string;
  icon: React.ReactNode;
}

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

const AUTH_PROVIDERS: AuthProvider[] = [
  {
    id: "google",
    name: "Google Workspace",
    issuerUrl: "https://accounts.google.com",
    instructions: "You'll need to create an OAuth app in Google Cloud Console. Follow the numbered steps below.",
    docsUrl: "https://console.cloud.google.com/apis/credentials",
    clientIdHint: "xxxxxxxxxx.apps.googleusercontent.com",
    icon: <GoogleIcon />,
  },
  {
    id: "microsoft",
    name: "Microsoft Entra ID",
    issuerUrl: "",
    issuerHint: "https://login.microsoftonline.com/<tenant-id>/v2.0",
    instructions: "Register an app in Microsoft Entra ID (Azure AD). Follow the numbered steps below.",
    docsUrl: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    clientIdHint: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    icon: <MicrosoftIcon />,
  },
];

// ─── Step definitions per path ──────────────────────────────────────────────

type StepId =
  | "intent"          // New instance or connect to existing?
  | "newType"         // Solo or Organization?
  | "connectType"     // Member or Secondary node?
  | "dataDir"
  | "authProvider"
  | "authCredentials"
  | "adminAccess"
  | "memberConnect"   // mDNS discover + manual fallback (member)
  | "secondaryConnect" // mDNS discover + mesh token + node name (secondary)
  | "aiEngine";

function getSteps(intent: SetupIntent, mode: EdgebricMode, connectType: ConnectType): StepId[] {
  if (intent === "new") {
    if (mode === "solo") return ["intent", "newType", "dataDir", "aiEngine"];
    return ["intent", "newType", "dataDir", "authProvider", "authCredentials", "adminAccess", "aiEngine"];
  }
  // Connect to existing
  if (connectType === "member") return ["intent", "connectType", "memberConnect", "dataDir", "aiEngine"];
  return ["intent", "connectType", "secondaryConnect", "dataDir", "aiEngine"];
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function SetupWizard({ onComplete }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Intent & mode
  const [intent, setIntent] = useState<SetupIntent>("new");
  const [mode, setMode] = useState<EdgebricMode>("solo");
  const [connectType, setConnectType] = useState<ConnectType>("member");

  // Form state
  const [dataDir, setDataDir] = useState("");
  const [authProvider, setAuthProvider] = useState<string>("google");
  const [oidcIssuer, setOidcIssuer] = useState("https://accounts.google.com");
  const [oidcClientId, setOidcClientId] = useState("");
  const [oidcClientSecret, setOidcClientSecret] = useState("");
  const [adminEmails, setAdminEmails] = useState("");
  const [port, setPort] = useState("3001");
  const [isDark, setIsDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Member + secondary connect — shared mDNS discovery state
  const [discoveredInstances, setDiscoveredInstances] = useState<Array<{ name: string; host: string; port: number; addresses: string[]; endpoint?: string }>>([]);
  const [discovering, setDiscovering] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<string>("");
  const [manualServerUrl, setManualServerUrl] = useState("");
  const [useManualUrl, setUseManualUrl] = useState(false);

  // Secondary node specific
  const [meshToken, setMeshToken] = useState("");
  const [secondaryNodeName, setSecondaryNodeName] = useState("");

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [engineProgress, setEngineProgress] = useState(-1);
  const [engineStatus, setEngineStatus] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [engineError, setEngineError] = useState("");
  const [launchAtLogin, setLaunchAtLogin] = useState(true);

  // Model setup choice (after engine install)
  const [modelChoice, setModelChoice] = useState<"undecided" | "auto" | "skip">("undecided");
  const [recommendedModel, setRecommendedModel] = useState<{ tag: string; name: string; downloadSizeGB: number; description: string } | null>(null);
  const [modelProgress, setModelProgress] = useState(0);
  const [modelStatus, setModelStatus] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [modelError, setModelError] = useState("");

  // Fetch recommended model when engine finishes installing
  useEffect(() => {
    if (engineStatus === "done" && !recommendedModel) {
      window.electronAPI.getRecommendedModel().then(setRecommendedModel);
    }
  }, [engineStatus, recommendedModel]);

  const steps = getSteps(intent, mode, connectType);
  const currentStep = steps[stepIndex];
  const totalSteps = steps.length;

  useEffect(() => {
    window.electronAPI.getDefaultDataDir().then(setDataDir);
  }, []);

  // Auto-discover on memberConnect and secondaryConnect steps
  useEffect(() => {
    if ((currentStep === "memberConnect" || currentStep === "secondaryConnect") && !useManualUrl && discoveredInstances.length === 0 && !discovering) {
      runDiscovery();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  const selectedProvider = AUTH_PROVIDERS.find((p) => p.id === authProvider)!;

  function handleProviderChange(providerId: string) {
    setAuthProvider(providerId);
    const provider = AUTH_PROVIDERS.find((p) => p.id === providerId);
    setOidcIssuer(provider?.issuerUrl ?? "");
  }

  async function runDiscovery() {
    setDiscovering(true);
    setDiscoveredInstances([]);
    try {
      const instances = await window.electronAPI.discoverInstances();
      setDiscoveredInstances(instances);
    } catch {
      // Discovery failed silently — user can enter manually
    } finally {
      setDiscovering(false);
    }
  }

  function getResolvedServerUrl(): string | undefined {
    if (useManualUrl) return manualServerUrl.trim() || undefined;
    if (!selectedInstance) return undefined;
    // Check if discovered instance has an endpoint property
    const inst = discoveredInstances.find((i) => `${i.host}:${i.port}` === selectedInstance);
    if (inst && "endpoint" in inst && inst.endpoint) return inst.endpoint;
    return `https://${selectedInstance}`;
  }

  function canProceed(): boolean {
    switch (currentStep) {
      case "intent":
      case "newType":
      case "connectType":
        return true;
      case "dataDir":
        return dataDir.trim().length > 0;
      case "authProvider":
        return authProvider.length > 0;
      case "authCredentials":
        return oidcIssuer.trim().length > 0 && oidcClientId.trim().length > 0 && oidcClientSecret.trim().length > 0;
      case "adminAccess": {
        const portNum = parseInt(port, 10);
        const emailList = adminEmails.split(",").map((e) => e.trim()).filter(Boolean);
        const emailsValid = emailList.length > 0 && emailList.every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
        return emailsValid && portNum > 0 && portNum < 65536;
      }
      case "memberConnect": {
        if (useManualUrl) {
          try { new URL(manualServerUrl.trim()); return true; } catch { return false; }
        }
        return selectedInstance.length > 0;
      }
      case "secondaryConnect": {
        const hasServer = useManualUrl
          ? (() => { try { new URL(manualServerUrl.trim()); return true; } catch { return false; } })()
          : selectedInstance.length > 0;
        return hasServer && meshToken.trim().length >= 32 && secondaryNodeName.trim().length > 0;
      }
      case "aiEngine":
        if (engineStatus === "idle") return true; // can skip engine
        if (engineStatus !== "done") return false;
        // Engine installed — need model choice resolved
        return modelChoice === "skip" || modelStatus === "done";
      default:
        return false;
    }
  }

  function isPreSaveStep(): boolean {
    const aiIdx = steps.indexOf("aiEngine");
    return aiIdx > 0 && stepIndex === aiIdx - 1;
  }

  function resolveMode(): EdgebricMode {
    if (intent === "new") return mode;
    // Connect to existing — both member and secondary use "member" config mode
    // (they both proxy auth to the primary)
    return "member";
  }

  async function saveConfig() {
    const effectiveMode = resolveMode();
    const emails = adminEmails.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    const orgServerUrl = getResolvedServerUrl();

    await window.electronAPI.saveSetup({
      mode: effectiveMode,
      dataDir: dataDir.trim(),
      port: parseInt(port, 10),
      ...(effectiveMode === "admin" && {
        oidcProvider: authProvider,
        oidcIssuer: oidcIssuer.trim(),
        oidcClientId: oidcClientId.trim(),
        oidcClientSecret: oidcClientSecret.trim(),
        adminEmails: emails,
      }),
      ...(effectiveMode === "member" && orgServerUrl && { orgServerUrl }),
      // Secondary node mesh setup data
      ...(intent === "connect" && connectType === "secondary" && {
        meshToken: meshToken.trim(),
        secondaryNodeName: secondaryNodeName.trim(),
        primaryEndpoint: orgServerUrl,
      }),
    });
  }

  async function handleNext() {
    setError("");

    if (isPreSaveStep()) {
      setSaving(true);
      try {
        await saveConfig();
        setStepIndex(stepIndex + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Setup failed");
      } finally {
        setSaving(false);
      }
      return;
    }

    if (stepIndex < totalSteps - 1) {
      setStepIndex(stepIndex + 1);
      return;
    }

    // Final step
    await window.electronAPI.setLaunchAtLogin(launchAtLogin);
    onComplete();
  }

  function handleBack() {
    setError("");
    if (stepIndex === 0) return;

    // Going back to intent resets everything
    const prevStep = steps[stepIndex - 1];
    if (prevStep === "intent") {
      setStepIndex(0);
      return;
    }

    setStepIndex(stepIndex - 1);
  }

  const isLastStep = stepIndex === totalSteps - 1;

  // ─── Server discovery UI (shared between member and secondary) ────────────

  function renderDiscoveryUI() {
    return (
      <>
        {!useManualUrl && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <button
                className="btn btn-secondary"
                disabled={discovering}
                onClick={runDiscovery}
              >
                {discovering ? "Scanning..." : discoveredInstances.length > 0 ? "Scan Again" : "Scan Network"}
              </button>
              <button className="advanced-toggle" onClick={() => setUseManualUrl(true)}>
                Enter address manually
              </button>
            </div>

            {discovering && (
              <p className="hint">Scanning for Edgebric servers on your network...</p>
            )}

            {!discovering && discoveredInstances.length === 0 && (
              <p className="hint">
                No servers found yet. Make sure the server is running on the same network, then click "Scan Network".
              </p>
            )}

            {discoveredInstances.length > 0 && (
              <div className="provider-list">
                {discoveredInstances.map((instance) => {
                  const key = `${instance.host}:${instance.port}`;
                  return (
                    <label key={key} className={`provider-option ${selectedInstance === key ? "selected" : ""}`}>
                      <input
                        type="radio"
                        name="instance"
                        value={key}
                        checked={selectedInstance === key}
                        onChange={() => setSelectedInstance(key)}
                      />
                      <span className="provider-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
                          <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
                          <line x1="6" y1="6" x2="6.01" y2="6"/>
                          <line x1="6" y1="18" x2="6.01" y2="18"/>
                        </svg>
                      </span>
                      <div>
                        <span className="provider-name">{instance.name}</span>
                        <span className="provider-desc">
                          {instance.host}:{instance.port}
                          {instance.addresses.length > 0 && ` (${instance.addresses[0]})`}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </>
        )}

        {useManualUrl && (
          <>
            <div className="field">
              <label htmlFor="serverUrl">Server Address</label>
              <input
                id="serverUrl"
                type="text"
                value={manualServerUrl}
                onChange={(e) => setManualServerUrl(e.target.value)}
                placeholder="https://edgebric.local:3001"
              />
              <p className="hint">
                Ask your admin for the server address. Usually something like https://edgebric.local:3001
              </p>
            </div>
            <button className="advanced-toggle" onClick={() => setUseManualUrl(false)}>
              Scan network instead
            </button>
          </>
        )}
      </>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="wizard">
      <div className="wizard-header">
        <img src={isDark ? logoDark : logoLight} alt="Edgebric" className="wizard-logo" />
        <div className="wizard-header-text">
          <h1>Edgebric Setup</h1>
          <p>Get started in a few steps.</p>
        </div>
      </div>

      <div className="wizard-step">
        {error && <div className="error-message">{error}</div>}

        {/* ─── Step: Intent ────────────────────────────────────────────── */}
        {currentStep === "intent" && (
          <>
            <h2>What would you like to do?</h2>
            <div className="provider-list">
              <label className={`provider-option ${intent === "new" ? "selected" : ""}`}>
                <input type="radio" name="intent" value="new" checked={intent === "new"} onChange={() => setIntent("new")} />
                <span className="provider-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                  </svg>
                </span>
                <div>
                  <span className="provider-name">Set up a new instance</span>
                  <span className="provider-desc">Start fresh — for personal use or to set up a new server for your organization.</span>
                </div>
              </label>

              <label className={`provider-option ${intent === "connect" ? "selected" : ""}`}>
                <input type="radio" name="intent" value="connect" checked={intent === "connect"} onChange={() => setIntent("connect")} />
                <span className="provider-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                </span>
                <div>
                  <span className="provider-name">Connect to an existing instance</span>
                  <span className="provider-desc">Join your organization's Edgebric server or add a secondary node to an existing mesh.</span>
                </div>
              </label>
            </div>
          </>
        )}

        {/* ─── Step: New Instance Type ─────────────────────────────────── */}
        {currentStep === "newType" && (
          <>
            <h2>What kind of instance?</h2>
            <div className="provider-list">
              <label className={`provider-option ${mode === "solo" ? "selected" : ""}`}>
                <input type="radio" name="newType" value="solo" checked={mode === "solo"} onChange={() => setMode("solo")} />
                <span className="provider-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                </span>
                <div>
                  <span className="provider-name">Just for me</span>
                  <span className="provider-desc">Personal use, no sign-in required. Your data stays on this machine.</span>
                </div>
              </label>

              <label className={`provider-option ${mode === "admin" ? "selected" : ""}`}>
                <input type="radio" name="newType" value="admin" checked={mode === "admin"} onChange={() => setMode("admin")} />
                <span className="provider-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </span>
                <div>
                  <span className="provider-name">For my organization</span>
                  <span className="provider-desc">Set up a server with single sign-on so your team can use Edgebric together.</span>
                </div>
              </label>
            </div>
          </>
        )}

        {/* ─── Step: Connect Type ──────────────────────────────────────── */}
        {currentStep === "connectType" && (
          <>
            <h2>How are you connecting?</h2>
            <div className="provider-list">
              <label className={`provider-option ${connectType === "member" ? "selected" : ""}`}>
                <input type="radio" name="connectType" value="member" checked={connectType === "member"} onChange={() => setConnectType("member")} />
                <span className="provider-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                    <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
                  </svg>
                </span>
                <div>
                  <span className="provider-name">Sign in as a member</span>
                  <span className="provider-desc">Connect this app to your organization's Edgebric server to access Vault Mode and offline search.</span>
                </div>
              </label>

              <label className={`provider-option ${connectType === "secondary" ? "selected" : ""}`}>
                <input type="radio" name="connectType" value="secondary" checked={connectType === "secondary"} onChange={() => setConnectType("secondary")} />
                <span className="provider-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
                    <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
                    <line x1="6" y1="6" x2="6.01" y2="6"/>
                    <line x1="6" y1="18" x2="6.01" y2="18"/>
                  </svg>
                </span>
                <div>
                  <span className="provider-name">Set up a secondary node</span>
                  <span className="provider-desc">Add this machine to your mesh network as a document host. Requires admin access to the primary node.</span>
                </div>
              </label>
            </div>
          </>
        )}

        {/* ─── Step: Member Connect ────────────────────────────────────── */}
        {currentStep === "memberConnect" && (
          <>
            <h2>Find your organization</h2>
            <p className="description">
              We'll scan the local network for your organization's Edgebric server.
              If it's not on this network, you can enter the address manually.
            </p>
            {renderDiscoveryUI()}
          </>
        )}

        {/* ─── Step: Secondary Node Connect ────────────────────────────── */}
        {currentStep === "secondaryConnect" && (
          <>
            <h2>Connect to primary node</h2>
            <p className="description">
              Find your primary Edgebric node on the network, then enter the mesh token
              and a name for this node.
            </p>

            {renderDiscoveryUI()}

            <div className="card-section-divider" style={{ marginTop: 20 }}>
              <div className="field">
                <label htmlFor="secondaryNodeName">Node Name</label>
                <input
                  id="secondaryNodeName"
                  type="text"
                  value={secondaryNodeName}
                  onChange={(e) => setSecondaryNodeName(e.target.value)}
                  placeholder='e.g., "Legal Office — 2nd Floor"'
                />
                <p className="hint">A human-readable name so admins can identify this node in the mesh dashboard.</p>
              </div>
              <div className="field">
                <label htmlFor="meshToken">Mesh Token</label>
                <input
                  id="meshToken"
                  type="password"
                  value={meshToken}
                  onChange={(e) => setMeshToken(e.target.value)}
                  placeholder="Paste the 64-character token"
                />
                <p className="hint">
                  Your primary node admin can find this in <strong>Settings &gt; Network &gt; This Node &gt; Mesh Token</strong>.
                  Click the eye icon to reveal it, then copy and paste it here.
                </p>
              </div>
            </div>
          </>
        )}

        {/* ─── Step: Data Directory ────────────────────────────────────── */}
        {currentStep === "dataDir" && (
          <>
            <h2>Data Directory</h2>
            <p className="description">
              Where should Edgebric store its data (database, uploads, logs)?
            </p>
            <div className="field">
              <label htmlFor="dataDir">Directory path</label>
              <input
                id="dataDir"
                type="text"
                value={dataDir}
                onChange={(e) => setDataDir(e.target.value)}
                placeholder="/Users/you/Edgebric"
              />
              <p className="hint">This folder will be created if it doesn't exist.</p>
            </div>
          </>
        )}

        {/* ─── Step: Auth Provider ─────────────────────────────────────── */}
        {currentStep === "authProvider" && (
          <>
            <h2>Authentication Provider</h2>
            <p className="description">
              Choose the identity provider your organization uses for single sign-on.
            </p>
            <div className="provider-list">
              {AUTH_PROVIDERS.map((provider) => (
                <label key={provider.id} className={`provider-option ${authProvider === provider.id ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="authProvider"
                    value={provider.id}
                    checked={authProvider === provider.id}
                    onChange={() => handleProviderChange(provider.id)}
                  />
                  <span className="provider-icon">{provider.icon}</span>
                  <span className="provider-name">{provider.name}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {/* ─── Step: Auth Credentials ──────────────────────────────────── */}
        {currentStep === "authCredentials" && (
          <>
            <h2>{selectedProvider.name} Credentials</h2>
            <div className={authProvider !== "generic" ? "step3-split" : ""}>
              {authProvider === "google" && (
                <div className="step3-guide">
                  <h3 className="guide-heading">Setup Guide</h3>
                  <ol className="setup-steps">
                    <li>Go to{" "}<a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="docs-link">Google Cloud Console &gt; Credentials</a></li>
                    <li>If you haven't already, configure the <strong>OAuth consent screen</strong> (Internal for Workspace, or External for testing)</li>
                    <li>Click <strong>+ CREATE CREDENTIALS</strong>, then <strong>OAuth client ID</strong></li>
                    <li>Application type: <strong>Web application</strong></li>
                    <li>Name it anything (e.g. "Edgebric")</li>
                    <li>Under <strong>Authorized redirect URIs</strong>, add the redirect URI from the form</li>
                    <li>Click <strong>CREATE</strong></li>
                    <li>Copy the <strong>Client ID</strong> (ends in <code>.apps.googleusercontent.com</code>) and <strong>Client Secret</strong> into the form</li>
                  </ol>
                </div>
              )}
              {authProvider === "microsoft" && (
                <div className="step3-guide">
                  <h3 className="guide-heading">Setup Guide</h3>
                  <ol className="setup-steps">
                    <li>Go to{" "}<a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer" className="docs-link">Entra admin center &gt; App registrations</a></li>
                    <li>Click <strong>+ New registration</strong>, name it <strong>Edgebric</strong></li>
                    <li>Account types: <strong>Accounts in this organizational directory only</strong></li>
                    <li>Redirect URI: select <strong>Web</strong>, paste the URI from the form</li>
                    <li>Click <strong>Register</strong>, then copy the <strong>Client ID</strong> and <strong>Tenant ID</strong> from the overview</li>
                    <li>Go to <strong>Certificates &amp; secrets</strong> &gt; <strong>+ New client secret</strong>, copy the <strong>Value</strong> immediately</li>
                    <li>Go to <strong>API permissions</strong> &gt; add <strong>Microsoft Graph &gt; User.Read</strong> (delegated)</li>
                    <li>Go to <strong>Token configuration</strong> &gt; add optional claim: ID token &gt; <strong>email</strong></li>
                  </ol>
                </div>
              )}

              <div className="step3-form">
                {authProvider !== "google" && (
                  <div className="field">
                    <label htmlFor="oidcIssuer">Issuer URL</label>
                    <input id="oidcIssuer" type="text" value={oidcIssuer} onChange={(e) => setOidcIssuer(e.target.value)} placeholder={selectedProvider.issuerHint ?? "https://your-provider.com"} />
                    {authProvider === "microsoft" && <p className="hint">Format: <code>https://login.microsoftonline.com/TENANT-ID/v2.0</code> &mdash; replace TENANT-ID with your Directory (tenant) ID.</p>}
                  </div>
                )}
                <div className="field">
                  <label>Redirect URI</label>
                  <div className="input-with-copy">
                    <input type="text" readOnly value={`https://localhost:${port}/api/auth/callback`} className="readonly" onClick={(e) => (e.target as HTMLInputElement).select()} />
                    <button type="button" className="copy-btn" onClick={() => {
                      navigator.clipboard.writeText(`https://localhost:${port}/api/auth/callback`);
                      const btn = document.querySelector(".copy-btn") as HTMLButtonElement;
                      btn.textContent = "Copied!";
                      setTimeout(() => { btn.textContent = "Copy"; }, 1500);
                    }}>
                      Copy
                    </button>
                  </div>
                  <p className="hint">
                    {authProvider === "google"
                      ? "Paste this into Google's \"Authorized redirect URIs\" field."
                      : `Paste this as the redirect URI in your ${selectedProvider.name} app configuration.`}
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="oidcClientId">Client ID</label>
                  <input id="oidcClientId" type="text" value={oidcClientId} onChange={(e) => setOidcClientId(e.target.value)} placeholder={selectedProvider.clientIdHint ?? ""} />
                </div>
                <div className="field">
                  <label htmlFor="oidcClientSecret">Client Secret</label>
                  <input id="oidcClientSecret" type="password" value={oidcClientSecret} onChange={(e) => setOidcClientSecret(e.target.value)} />
                </div>
              </div>
            </div>
          </>
        )}

        {/* ─── Step: Admin Access ──────────────────────────────────────── */}
        {currentStep === "adminAccess" && (
          <>
            <h2>Admin Access &amp; Network</h2>
            <p className="description">
              Enter the email address(es) that should have admin access. Separate multiple emails with commas.
            </p>
            <div className="field">
              <label htmlFor="adminEmails">Admin email(s)</label>
              <input id="adminEmails" type="text" value={adminEmails} onChange={(e) => setAdminEmails(e.target.value)} placeholder="admin@yourcompany.com" />
            </div>
            <button type="button" className="advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
              {showAdvanced ? "Hide advanced" : "Advanced options"}
            </button>
            {showAdvanced && (
              <>
                <div className="field">
                  <label htmlFor="port">Server Port</label>
                  <input id="port" type="number" min="1" max="65535" value={port} onChange={(e) => setPort(e.target.value)} />
                  <p className="hint">Default 3001. Change only if another service uses this port.</p>
                </div>
                <div className="clean-url-tip">
                  <h4>Want a clean URL without the port number?</h4>
                  <p>
                    Run this command once in Terminal to forward port 443 to {port}.
                    After this, users can access Edgebric at <strong>https://edgebric.local</strong>.
                  </p>
                  <div className="code-block">
                    <code>{`sudo bash -c 'echo "rdr pass on lo0 inet proto tcp from any to any port 443 -> 127.0.0.1 port ${port}" > /etc/pf.anchors/edgebric && grep -q edgebric /etc/pf.conf || echo -e "rdr-anchor \\"edgebric\\"\\nload anchor \\"edgebric\\" from \\"/etc/pf.anchors/edgebric\\"" | sudo tee -a /etc/pf.conf > /dev/null && sudo pfctl -ef /etc/pf.conf'`}</code>
                  </div>
                  <p className="hint" style={{ marginTop: 6 }}>
                    Requires your Mac password. Only needs to be done once — survives reboots.
                  </p>
                </div>
              </>
            )}
          </>
        )}

        {/* ─── Step: AI Engine ─────────────────────────────────────────── */}
        {currentStep === "aiEngine" && (
          <>
            <h2>AI Engine</h2>
            <p className="description">
              Edgebric uses a local AI engine to process queries privately on this machine. No data leaves your network.
            </p>

            {engineStatus === "idle" && (
              <div className="ai-engine-actions">
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    setEngineStatus("downloading");
                    setEngineError("");
                    setEngineProgress(0);
                    const cleanup = window.electronAPI.onEngineDownloadProgress((percent: number) => {
                      setEngineProgress(percent);
                    });
                    const result = await window.electronAPI.installEngine();
                    cleanup();
                    if (result.success) {
                      setEngineStatus("done");
                    } else {
                      setEngineStatus("error");
                      setEngineError(result.error ?? "Download failed");
                    }
                  }}
                >
                  Download AI Engine
                </button>
                <p className="hint">
                  Downloads approximately 90 MB. You can also skip this step and set it up later from Settings.
                </p>
              </div>
            )}

            {engineStatus === "downloading" && (
              <div className="ai-engine-progress">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${engineProgress}%` }} />
                </div>
                <p className="progress-label">Downloading... {engineProgress}%</p>
              </div>
            )}

            {engineStatus === "done" && (
              <div className="ai-engine-done">
                <p className="success-message">AI engine installed successfully.</p>

                {modelChoice === "undecided" && (
                  <>
                    <p style={{ fontSize: 13, marginTop: 12, marginBottom: 12 }}>
                      Would you like Edgebric to download a model now, or set it up yourself later?
                    </p>
                    <div className="provider-list">
                      <label
                        className="provider-option"
                        style={{ cursor: "pointer" }}
                        onClick={async () => {
                          setModelChoice("auto");
                          setModelStatus("downloading");
                          setModelProgress(0);
                          setModelError("");
                          const model = recommendedModel;
                          if (!model) {
                            setModelStatus("error");
                            setModelError("Could not determine a recommended model.");
                            return;
                          }
                          const cleanup = window.electronAPI.onModelPullProgress((data) => {
                            if (data.tag === model.tag) setModelProgress(data.percent);
                          });
                          const result = await window.electronAPI.modelsPull(model.tag);
                          cleanup();
                          if (result.success) {
                            setModelStatus("done");
                          } else {
                            setModelStatus("error");
                            setModelError(result.error ?? "Download failed");
                          }
                        }}
                      >
                        <span className="provider-icon">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                          </svg>
                        </span>
                        <div>
                          <span className="provider-name">Set me up</span>
                          <span className="provider-desc">
                            {recommendedModel
                              ? `Downloads ${recommendedModel.name} (~${recommendedModel.downloadSizeGB} GB). ${recommendedModel.description}`
                              : "Detecting best model for your hardware..."}
                          </span>
                        </div>
                      </label>

                      <label
                        className="provider-option"
                        style={{ cursor: "pointer" }}
                        onClick={() => setModelChoice("skip")}
                      >
                        <span className="provider-icon">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/><path d="M16 12H8"/>
                          </svg>
                        </span>
                        <div>
                          <span className="provider-name">I'll set it up myself</span>
                          <span className="provider-desc">Skip model download. You can configure models later from Settings &gt; Models.</span>
                        </div>
                      </label>
                    </div>
                  </>
                )}

                {modelChoice === "auto" && modelStatus === "downloading" && (
                  <div className="ai-engine-progress" style={{ marginTop: 16 }}>
                    <p style={{ fontSize: 13, marginBottom: 8 }}>
                      Downloading {recommendedModel?.name ?? "model"}...
                    </p>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${modelProgress}%` }} />
                    </div>
                    <p className="progress-label">{modelProgress}%</p>
                  </div>
                )}

                {modelChoice === "auto" && modelStatus === "done" && (
                  <div style={{ marginTop: 16 }}>
                    <p className="success-message">{recommendedModel?.name ?? "Model"} downloaded successfully.</p>
                  </div>
                )}

                {modelChoice === "auto" && modelStatus === "error" && (
                  <div style={{ marginTop: 16 }}>
                    <p className="error-message">{modelError}</p>
                    <button className="btn btn-secondary" onClick={() => { setModelChoice("undecided"); setModelStatus("idle"); }}>
                      Go Back
                    </button>
                  </div>
                )}

                {modelChoice === "skip" && (
                  <div style={{ marginTop: 16 }}>
                    <p className="hint">No model will be downloaded. You can set up models anytime from Settings &gt; Models.</p>
                    <button className="advanced-toggle" onClick={() => setModelChoice("undecided")}>
                      Change my mind
                    </button>
                  </div>
                )}
              </div>
            )}

            {engineStatus === "error" && (
              <div className="ai-engine-error">
                <p className="error-message">{engineError}</p>
                <button className="btn btn-secondary" onClick={() => setEngineStatus("idle")}>
                  Try Again
                </button>
              </div>
            )}

            <div className="card" style={{ marginTop: 20, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Launch at Login</p>
                <p className="hint">
                  Recommended. Starts Edgebric automatically when you log in so it's always ready.
                </p>
              </div>
              <button
                className={`toggle-btn ${launchAtLogin ? "toggle-on" : ""}`}
                onClick={() => setLaunchAtLogin(!launchAtLogin)}
                type="button"
                aria-pressed={launchAtLogin}
              >
                <span className="toggle-knob" />
              </button>
            </div>
          </>
        )}
      </div>

      <div className="wizard-footer">
        <span className="step-indicator">
          Step {stepIndex + 1} of {totalSteps}
        </span>
        <div className="buttons">
          {stepIndex > 0 && (
            <button className="btn btn-secondary" onClick={handleBack}>
              Back
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={handleNext}
            disabled={!canProceed() || saving || engineStatus === "downloading" || modelStatus === "downloading"}
          >
            {saving
              ? "Saving..."
              : engineStatus === "downloading" || modelStatus === "downloading"
                ? "Downloading..."
                : isLastStep
                  ? engineStatus === "idle" ? "Skip & Finish" : "Finish"
                  : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
