import React, { useState, useEffect } from "react";
import logoLight from "../assets/logo-black.svg";
import logoDark from "../assets/logo-white.svg";

interface Props {
  onComplete: () => void;
}

type EdgebricMode = "solo" | "admin" | "member";

interface AuthProvider {
  id: string;
  name: string;
  issuerUrl: string;
  /** Placeholder hint for the issuer field. */
  issuerHint?: string;
  instructions: string;
  docsUrl: string;
  /** Placeholder for Client ID field. */
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

const AUTH_PROVIDERS: AuthProvider[] = [
  {
    id: "google",
    name: "Google Workspace",
    issuerUrl: "https://accounts.google.com",
    instructions:
      "You'll need to create an OAuth app in Google Cloud Console. Follow the numbered steps below.",
    docsUrl: "https://console.cloud.google.com/apis/credentials",
    clientIdHint: "xxxxxxxxxx.apps.googleusercontent.com",
    icon: <GoogleIcon />,
  },
  {
    id: "microsoft",
    name: "Microsoft Entra ID",
    issuerUrl: "",
    issuerHint: "https://login.microsoftonline.com/<tenant-id>/v2.0",
    instructions:
      "Register an app in Microsoft Entra ID (Azure AD). Follow the numbered steps below.",
    docsUrl: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    clientIdHint: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    icon: <MicrosoftIcon />,
  },
  {
    id: "okta",
    name: "Okta",
    issuerUrl: "",
    issuerHint: "https://your-domain.okta.com/oauth2/default",
    instructions:
      "Create an OIDC Web App integration in Okta. Follow the numbered steps below.",
    docsUrl: "https://login.okta.com/",
    icon: <OktaIcon />,
  },
  {
    id: "onelogin",
    name: "OneLogin",
    issuerUrl: "",
    issuerHint: "https://your-subdomain.onelogin.com/oidc/2",
    instructions:
      "Create an OpenID Connect app in OneLogin. Follow the numbered steps below.",
    docsUrl: "https://app.onelogin.com/apps",
    icon: <OneLoginIcon />,
  },
  {
    id: "ping",
    name: "Ping Identity",
    issuerUrl: "",
    issuerHint: "https://auth.pingone.com/<environment-id>/as",
    instructions:
      "Create an OIDC application in PingOne or PingFederate. Follow the numbered steps below.",
    docsUrl: "https://console.pingone.com/",
    icon: <PingIcon />,
  },
  {
    id: "generic",
    name: "Custom OIDC Provider",
    issuerUrl: "",
    issuerHint: "https://your-provider.com",
    instructions:
      "Enter the issuer URL and OAuth credentials from your OIDC-compatible identity provider.",
    docsUrl: "",
    icon: <OidcIcon />,
  },
];

// ─── Step definitions per mode ──────────────────────────────────────────────

type StepId = "mode" | "dataDir" | "license" | "authProvider" | "authCredentials" | "adminAccess" | "memberConnect" | "aiEngine";

const STEPS_BY_MODE: Record<EdgebricMode, StepId[]> = {
  solo:   ["mode", "dataDir", "aiEngine"],
  admin:  ["mode", "dataDir", "license", "authProvider", "authCredentials", "adminAccess", "aiEngine"],
  member: ["mode", "memberConnect", "dataDir", "aiEngine"],
};

// ─── Main component ─────────────────────────────────────────────────────────

export default function SetupWizard({ onComplete }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Mode
  const [mode, setMode] = useState<EdgebricMode>("solo");

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

  const [licenseKey, setLicenseKey] = useState("");
  const [licenseValid, setLicenseValid] = useState(false);
  const [licenseError, setLicenseError] = useState("");
  const [licenseValidating, setLicenseValidating] = useState(false);
  // Member connect
  const [discoveredInstances, setDiscoveredInstances] = useState<Array<{ name: string; host: string; port: number; addresses: string[] }>>([]);
  const [discovering, setDiscovering] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<string>(""); // host:port
  const [manualServerUrl, setManualServerUrl] = useState("");
  const [useManualUrl, setUseManualUrl] = useState(false);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [ollamaProgress, setOllamaProgress] = useState(-1);
  const [ollamaStatus, setOllamaStatus] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [ollamaError, setOllamaError] = useState("");
  const [launchAtLogin, setLaunchAtLogin] = useState(true);

  const steps = STEPS_BY_MODE[mode];
  const currentStep = steps[stepIndex];
  const totalSteps = steps.length;

  useEffect(() => {
    window.electronAPI.getDefaultDataDir().then(setDataDir);
  }, []);

  const selectedProvider = AUTH_PROVIDERS.find((p) => p.id === authProvider)!;

  function handleProviderChange(providerId: string) {
    setAuthProvider(providerId);
    const provider = AUTH_PROVIDERS.find((p) => p.id === providerId);
    setOidcIssuer(provider?.issuerUrl ?? "");
  }

  function canProceed(): boolean {
    switch (currentStep) {
      case "mode":
        return true;
      case "dataDir":
        return dataDir.trim().length > 0;
      case "license":
        return licenseValid;
      case "authProvider":
        return authProvider.length > 0;
      case "authCredentials":
        return (
          oidcIssuer.trim().length > 0 &&
          oidcClientId.trim().length > 0 &&
          oidcClientSecret.trim().length > 0
        );
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
      case "aiEngine":
        return ollamaStatus === "done" || ollamaStatus === "idle";
      default:
        return false;
    }
  }

  /** The step just before AI Engine is where we save config + .env */
  function isPreSaveStep(): boolean {
    const aiIdx = steps.indexOf("aiEngine");
    return aiIdx > 0 && stepIndex === aiIdx - 1;
  }

  async function saveConfig() {
    const emails = adminEmails
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    // Determine the org server URL for member mode
    let orgServerUrl: string | undefined;
    if (mode === "member") {
      if (useManualUrl) {
        orgServerUrl = manualServerUrl.trim();
      } else if (selectedInstance) {
        orgServerUrl = `https://${selectedInstance}`;
      }
    }

    await window.electronAPI.saveSetup({
      mode,
      dataDir: dataDir.trim(),
      port: parseInt(port, 10),
      ...(mode === "admin" && {
        oidcProvider: authProvider,
        oidcIssuer: oidcIssuer.trim(),
        oidcClientId: oidcClientId.trim(),
        oidcClientSecret: oidcClientSecret.trim(),
        adminEmails: emails,
      }),
      ...(mode === "member" && orgServerUrl && {
        orgServerUrl,
      }),
    });
  }

  async function handleNext() {
    setError("");

    // Save config before AI engine step
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

    // Final step — apply launch-at-login preference, then complete
    await window.electronAPI.setLaunchAtLogin(launchAtLogin);
    onComplete();
  }

  function handleBack() {
    setError("");
    if (stepIndex === 0) return;

    // If going back from step 1 (dataDir) to mode selector, reset step index
    // to 0 since mode change may change step sequence
    if (currentStep === "dataDir") {
      setStepIndex(0);
      return;
    }

    setStepIndex(stepIndex - 1);
  }

  function handleModeSelect(newMode: EdgebricMode) {
    setMode(newMode);
    // Reset step index when mode changes (stays on mode step)
  }

  const isLastStep = stepIndex === totalSteps - 1;

  return (
    <div className="wizard">
      <div className="wizard-header">
        <img src={isDark ? logoDark : logoLight} alt="Edgebric" className="wizard-logo" />
        <div className="wizard-header-text">
          <h1>Edgebric Setup</h1>
          <p>Configure Edgebric for first-time use.</p>
        </div>
      </div>

      <div className="wizard-step">
        {error && <div className="error-message">{error}</div>}

        {currentStep === "mode" && (
          <>
            <h2>How will you use Edgebric?</h2>
            <p className="description">
              You can change this later from Settings.
            </p>
            <div className="provider-list">
              <label className={`provider-option ${mode === "solo" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="mode"
                  value="solo"
                  checked={mode === "solo"}
                  onChange={() => handleModeSelect("solo")}
                />
                <span className="provider-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                </span>
                <div>
                  <span className="provider-name">Just for me</span>
                  <span className="provider-desc">Run Edgebric locally for personal use. No account needed.</span>
                </div>
              </label>

              <label className={`provider-option ${mode === "admin" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="mode"
                  value="admin"
                  checked={mode === "admin"}
                  onChange={() => handleModeSelect("admin")}
                />
                <span className="provider-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </span>
                <div>
                  <span className="provider-name">Run a server for my team</span>
                  <span className="provider-desc">Set up Edgebric for your organization with SSO login.</span>
                </div>
              </label>

              <label className={`provider-option ${mode === "member" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="mode"
                  value="member"
                  checked={mode === "member"}
                  onChange={() => handleModeSelect("member")}
                />
                <span className="provider-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <line x1="19" y1="8" x2="19" y2="14"/>
                    <line x1="22" y1="11" x2="16" y2="11"/>
                  </svg>
                </span>
                <div>
                  <span className="provider-name">Member of an organization</span>
                  <span className="provider-desc">Connect to your team's Edgebric server on the network.</span>
                </div>
              </label>
            </div>
          </>
        )}

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

        {currentStep === "memberConnect" && (
          <>
            <h2>Connect to Server</h2>
            <p className="description">
              Find your organization's Edgebric server on the local network, or enter the address manually.
            </p>

            {!useManualUrl && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <button
                    className="btn btn-secondary"
                    disabled={discovering}
                    onClick={async () => {
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
                    }}
                  >
                    {discovering ? "Scanning..." : discoveredInstances.length > 0 ? "Scan Again" : "Scan Network"}
                  </button>
                  <button
                    className="advanced-toggle"
                    onClick={() => setUseManualUrl(true)}
                  >
                    Enter address manually
                  </button>
                </div>

                {discovering && (
                  <p className="hint">Scanning for Edgebric servers on your network...</p>
                )}

                {!discovering && discoveredInstances.length === 0 && (
                  <p className="hint">
                    No servers found yet. Make sure the server is running, then click "Scan Network".
                    Or enter the server address manually.
                  </p>
                )}

                {discoveredInstances.length > 0 && (
                  <div className="provider-list">
                    {discoveredInstances.map((instance) => {
                      const key = `${instance.host}:${instance.port}`;
                      return (
                        <label
                          key={key}
                          className={`provider-option ${selectedInstance === key ? "selected" : ""}`}
                        >
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
                <button
                  className="advanced-toggle"
                  onClick={() => setUseManualUrl(false)}
                >
                  Scan network instead
                </button>
              </>
            )}
          </>
        )}

        {currentStep === "license" && (
          <>
            <h2>License Key</h2>
            <p className="description">
              A license is required to enable multi-user organization mode with SSO authentication.
            </p>
            <div className="form-fields">
              <div className="field-group">
                <label className="field-label">License Key</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    value={licenseKey}
                    onChange={(e) => { setLicenseKey(e.target.value); setLicenseValid(false); setLicenseError(""); }}
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    className="field-input"
                    style={{ flex: 1, fontFamily: "monospace" }}
                  />
                  <button
                    className="btn-primary"
                    disabled={!licenseKey.trim() || licenseValidating}
                    onClick={async () => {
                      setLicenseValidating(true);
                      setLicenseError("");
                      try {
                        const result = await window.electronAPI.validateLicense(licenseKey.trim());
                        if (result.valid) {
                          setLicenseValid(true);
                        } else {
                          setLicenseError(result.error ?? "Invalid license key");
                        }
                      } catch {
                        setLicenseError("Could not validate license key");
                      } finally {
                        setLicenseValidating(false);
                      }
                    }}
                  >
                    {licenseValidating ? "Validating..." : "Activate"}
                  </button>
                </div>
                {licenseError && <p className="hint" style={{ color: "#e53e3e" }}>{licenseError}</p>}
                {licenseValid && <p className="hint" style={{ color: "#38a169" }}>License activated successfully.</p>}
              </div>
              <p className="hint" style={{ marginTop: 16 }}>
                Don't have a license?{" "}
                <a href="https://edgebric.com/pricing" target="_blank" rel="noopener noreferrer" className="docs-link">
                  Purchase one here
                </a>
                {" "}or go back and choose "Just for me" to use Edgebric for free.
              </p>
            </div>
          </>
        )}

        {currentStep === "authProvider" && (
          <>
            <h2>Authentication Provider</h2>
            <p className="description">
              Choose the identity provider your organization uses for single sign-on.
            </p>
            <div className="provider-list">
              {AUTH_PROVIDERS.map((provider) => (
                <label
                  key={provider.id}
                  className={`provider-option ${authProvider === provider.id ? "selected" : ""}`}
                >
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

        {currentStep === "authCredentials" && (
          <>
            <h2>{selectedProvider.name} Credentials</h2>
            <div className={authProvider !== "generic" ? "step3-split" : ""}>
              {/* ── Provider-specific setup guides ─────────────────────── */}
              {authProvider === "google" && (
                <div className="step3-guide">
                  <h3 className="guide-heading">Setup Guide</h3>
                  <ol className="setup-steps">
                    <li>
                      Go to{" "}
                      <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="docs-link">
                        Google Cloud Console &gt; Credentials
                      </a>
                    </li>
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
                    <li>
                      Go to{" "}
                      <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer" className="docs-link">
                        Microsoft Entra admin center &gt; App registrations
                      </a>
                    </li>
                    <li>Click <strong>+ New registration</strong></li>
                    <li>Name: <strong>Edgebric</strong></li>
                    <li>Supported account types: <strong>Accounts in this organizational directory only</strong> (single tenant)</li>
                    <li>Redirect URI: select <strong>Web</strong>, paste the redirect URI from the form</li>
                    <li>Click <strong>Register</strong></li>
                    <li>Copy the <strong>Application (client) ID</strong> (a UUID) from the overview page</li>
                    <li>Copy the <strong>Directory (tenant) ID</strong> and paste it below to build the issuer URL</li>
                    <li>Go to <strong>Certificates &amp; secrets</strong> &gt; <strong>+ New client secret</strong> &gt; <strong>Add</strong></li>
                    <li>Copy the <strong>Value</strong> (not the Secret ID) immediately &mdash; it's only shown once</li>
                    <li>Go to <strong>API permissions</strong> &gt; <strong>+ Add a permission</strong> &gt; <strong>Microsoft Graph</strong> &gt; <strong>Delegated</strong> &gt; search <strong>User.Read</strong> &gt; <strong>Add permissions</strong></li>
                    <li>Go to <strong>Token configuration</strong> &gt; <strong>+ Add optional claim</strong> &gt; Token type: <strong>ID</strong> &gt; select <strong>email</strong> &gt; <strong>Add</strong>. If prompted, check "Turn on the Microsoft Graph email permission".</li>
                  </ol>
                  <p className="hint" style={{ marginTop: 8 }}>
                    Steps 11-12 are critical: User.Read enables profile photo sync, and the email claim ensures Entra includes the user's email in the ID token. Without these, login will fail.
                  </p>
                </div>
              )}
              {authProvider === "okta" && (
                <div className="step3-guide">
                  <h3 className="guide-heading">Setup Guide</h3>
                  <ol className="setup-steps">
                    <li>
                      Sign in to your{" "}
                      <a href="https://login.okta.com/" target="_blank" rel="noopener noreferrer" className="docs-link">
                        Okta admin console
                      </a>
                    </li>
                    <li>Go to <strong>Applications</strong> &gt; <strong>Applications</strong></li>
                    <li>Click <strong>Create App Integration</strong></li>
                    <li>Sign-in method: <strong>OIDC - OpenID Connect</strong></li>
                    <li>Application type: <strong>Web Application</strong> &gt; <strong>Next</strong></li>
                    <li>App integration name: <strong>Edgebric</strong></li>
                    <li>Sign-in redirect URIs: paste the redirect URI from the form</li>
                    <li>Under <strong>Assignments</strong>, select <strong>Allow everyone in your organization to access</strong> (or limit to specific groups)</li>
                    <li>Click <strong>Save</strong></li>
                    <li>Copy the <strong>Client ID</strong> and <strong>Client secret</strong> from the app's <strong>General</strong> tab</li>
                  </ol>
                  <p className="hint" style={{ marginTop: 8 }}>
                    Your issuer URL is typically <code>https://your-company.okta.com/oauth2/default</code> (using the default authorization server). If you use a custom authorization server, replace <code>/default</code> with your server ID. Find your Okta domain in <strong>Settings</strong> &gt; <strong>Customization</strong> &gt; <strong>Org Contact</strong>.
                  </p>
                </div>
              )}
              {authProvider === "onelogin" && (
                <div className="step3-guide">
                  <h3 className="guide-heading">Setup Guide</h3>
                  <ol className="setup-steps">
                    <li>
                      Sign in to your{" "}
                      <a href="https://app.onelogin.com/apps" target="_blank" rel="noopener noreferrer" className="docs-link">
                        OneLogin admin portal
                      </a>
                    </li>
                    <li>Go to <strong>Applications</strong> &gt; <strong>Applications</strong></li>
                    <li>Click <strong>Add App</strong></li>
                    <li>Search for <strong>OpenID Connect (OIDC)</strong> and select it</li>
                    <li>Display name: <strong>Edgebric</strong> &gt; <strong>Save</strong></li>
                    <li>Go to the <strong>Configuration</strong> tab</li>
                    <li>Redirect URI: paste the redirect URI from the form</li>
                    <li>Set <strong>Token Endpoint</strong> authentication method to <strong>POST</strong></li>
                    <li>Click <strong>Save</strong></li>
                    <li>Go to the <strong>SSO</strong> tab</li>
                    <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong></li>
                  </ol>
                  <p className="hint" style={{ marginTop: 8 }}>
                    Your issuer URL is <code>https://YOUR-SUBDOMAIN.onelogin.com/oidc/2</code>. Find your subdomain in the browser URL bar when logged in to OneLogin admin (e.g. <code>your-company.onelogin.com</code>).
                  </p>
                </div>
              )}
              {authProvider === "ping" && (
                <div className="step3-guide">
                  <h3 className="guide-heading">Setup Guide</h3>
                  <ol className="setup-steps">
                    <li>
                      Sign in to your{" "}
                      <a href="https://console.pingone.com/" target="_blank" rel="noopener noreferrer" className="docs-link">
                        PingOne admin console
                      </a>
                    </li>
                    <li>Go to <strong>Applications</strong> &gt; <strong>Applications</strong></li>
                    <li>Click <strong>+</strong> to add an application</li>
                    <li>Name: <strong>Edgebric</strong>, Application type: <strong>OIDC Web App</strong></li>
                    <li>Click <strong>Configure</strong></li>
                    <li>Redirect URIs: paste the redirect URI from the form</li>
                    <li>Grant type: <strong>Authorization Code</strong></li>
                    <li>Click <strong>Save</strong></li>
                    <li>On the app's <strong>Configuration</strong> tab, copy the <strong>Client ID</strong> and <strong>Client Secret</strong></li>
                    <li>On the <strong>Configuration</strong> tab, note the <strong>Issuer</strong> URL (or find it under your environment settings)</li>
                  </ol>
                  <p className="hint" style={{ marginTop: 8 }}>
                    PingOne issuer URL varies by region: <code>auth.pingone.com</code> (US), <code>auth.pingone.eu</code> (EU), <code>auth.pingone.ca</code> (Canada), <code>auth.pingone.asia</code> (Asia). For PingFederate (self-hosted), use your PingFederate base URL, e.g. <code>https://sso.yourcompany.com</code>.
                  </p>
                </div>
              )}

              {/* ── Credential form ─────────────────────────────────── */}
              <div className="step3-form">
                {/* Issuer URL — shown for all providers except Google (which has a fixed issuer) */}
                {authProvider !== "google" && (
                  <div className="field">
                    <label htmlFor="oidcIssuer">Issuer URL</label>
                    <input
                      id="oidcIssuer"
                      type="text"
                      value={oidcIssuer}
                      onChange={(e) => setOidcIssuer(e.target.value)}
                      placeholder={selectedProvider.issuerHint ?? "https://your-provider.com"}
                    />
                    {authProvider === "microsoft" && (
                      <p className="hint">
                        Format: <code>https://login.microsoftonline.com/TENANT-ID/v2.0</code> &mdash; replace TENANT-ID with your Directory (tenant) ID from step 8.
                      </p>
                    )}
                    {authProvider === "okta" && (
                      <p className="hint">
                        Your Okta domain, e.g. <code>https://your-company.okta.com</code>
                      </p>
                    )}
                    {authProvider === "onelogin" && (
                      <p className="hint">
                        Format: <code>https://YOUR-SUBDOMAIN.onelogin.com/oidc/2</code>
                      </p>
                    )}
                  </div>
                )}
                <div className="field">
                  <label>Redirect URI</label>
                  <div className="input-with-copy">
                    <input
                      type="text"
                      readOnly
                      value={`https://localhost:${port}/api/auth/callback`}
                      className="readonly"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button
                      type="button"
                      className="copy-btn"
                      onClick={() => {
                        navigator.clipboard.writeText(`https://localhost:${port}/api/auth/callback`);
                        const btn = document.querySelector(".copy-btn") as HTMLButtonElement;
                        btn.textContent = "Copied!";
                        setTimeout(() => { btn.textContent = "Copy"; }, 1500);
                      }}
                    >
                      Copy
                    </button>
                  </div>
                  <p className="hint">
                    {authProvider === "google"
                      ? "Paste this into Google's \"Authorized redirect URIs\" field (step 5)."
                      : `Paste this as the redirect URI in your ${selectedProvider.name} app configuration.`}
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="oidcClientId">Client ID</label>
                  <input
                    id="oidcClientId"
                    type="text"
                    value={oidcClientId}
                    onChange={(e) => setOidcClientId(e.target.value)}
                    placeholder={selectedProvider.clientIdHint ?? ""}
                  />
                  <p className="hint">
                    {authProvider === "google"
                      ? "NOT the name you typed \u2014 it's the long string ending in .apps.googleusercontent.com"
                      : authProvider === "microsoft"
                        ? "The Application (client) ID from your app registration's overview page (a UUID)."
                        : `Found in your ${selectedProvider.name} app's settings or credentials page.`}
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="oidcClientSecret">Client Secret</label>
                  <input
                    id="oidcClientSecret"
                    type="password"
                    value={oidcClientSecret}
                    onChange={(e) => setOidcClientSecret(e.target.value)}
                  />
                  <p className="hint">
                    {authProvider === "google"
                      ? "Shown right after you click CREATE. Can also be found later on the client details page."
                      : authProvider === "microsoft"
                        ? "The Value (not Secret ID) from Certificates & secrets. Only shown once \u2014 copy it immediately."
                        : "Some providers only show this once \u2014 you may need to generate a new one."}
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {currentStep === "adminAccess" && (
          <>
            <h2>Admin Access &amp; Network</h2>
            <p className="description">
              Enter the email address(es) that should have admin access.
              Separate multiple emails with commas.
            </p>
            <div className="field">
              <label htmlFor="adminEmails">Admin email(s)</label>
              <input
                id="adminEmails"
                type="text"
                value={adminEmails}
                onChange={(e) => setAdminEmails(e.target.value)}
                placeholder="admin@yourcompany.com"
              />
            </div>
            <button
              type="button"
              className="advanced-toggle"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? "Hide advanced" : "Advanced options"}
            </button>
            {showAdvanced && (
              <>
                <div className="field">
                  <label htmlFor="port">Server Port</label>
                  <input
                    id="port"
                    type="number"
                    min="1"
                    max="65535"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                  />
                  <p className="hint">Default 3001. Change only if another service uses this port.</p>
                </div>
                <div className="clean-url-tip">
                  <h4>Want a clean URL without the port number?</h4>
                  <p>
                    Run this command once in Terminal to forward port 443 to {port}.
                    After this, users can access Edgebric at <strong>https://edgebric.local</strong> instead
                    of <strong>https://edgebric.local:{port}</strong>.
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

        {currentStep === "aiEngine" && (
          <>
            <h2>AI Engine</h2>
            <p className="description">
              Edgebric uses a local AI engine to process queries privately on this machine.
              No data leaves your network.
            </p>

            {ollamaStatus === "idle" && (
              <div className="ai-engine-actions">
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    setOllamaStatus("downloading");
                    setOllamaError("");
                    setOllamaProgress(0);
                    const cleanup = window.electronAPI.onOllamaDownloadProgress((percent: number) => {
                      setOllamaProgress(percent);
                    });
                    const result = await window.electronAPI.installOllama();
                    cleanup();
                    if (result.success) {
                      setOllamaStatus("done");
                    } else {
                      setOllamaStatus("error");
                      setOllamaError(result.error ?? "Download failed");
                    }
                  }}
                >
                  Download AI Engine
                </button>
                <p className="hint">
                  Downloads approximately 90 MB. You can also skip this step and
                  set it up later from Settings.
                </p>
              </div>
            )}

            {ollamaStatus === "downloading" && (
              <div className="ai-engine-progress">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${ollamaProgress}%` }} />
                </div>
                <p className="progress-label">Downloading... {ollamaProgress}%</p>
              </div>
            )}

            {ollamaStatus === "done" && (
              <div className="ai-engine-done">
                <p className="success-message">AI engine installed successfully.</p>
                <div style={{ marginTop: 16, padding: "12px 16px", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Recommended model for your system</p>
                  <p style={{ fontSize: 12, color: "#718096" }}>
                    Edgebric will automatically download the best model for your hardware when the server starts.
                    You can change models anytime from Settings &gt; Models.
                  </p>
                </div>
              </div>
            )}

            {ollamaStatus === "error" && (
              <div className="ai-engine-error">
                <p className="error-message">{ollamaError}</p>
                <button
                  className="btn btn-secondary"
                  onClick={() => setOllamaStatus("idle")}
                >
                  Try Again
                </button>
              </div>
            )}

            <div style={{ marginTop: 20, padding: "12px 16px", border: "1px solid #e2e8f0", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Launch at Login</p>
                <p style={{ fontSize: 12, color: "#718096" }}>
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
            disabled={!canProceed() || saving || ollamaStatus === "downloading"}
          >
            {saving
              ? "Saving..."
              : ollamaStatus === "downloading"
                ? "Downloading..."
                : isLastStep
                  ? ollamaStatus === "idle" ? "Skip & Finish" : "Finish"
                  : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
