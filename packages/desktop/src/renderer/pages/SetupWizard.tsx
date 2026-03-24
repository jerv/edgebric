import React, { useState, useEffect } from "react";
import logoSrc from "../assets/logo.png";

interface Props {
  onComplete: () => void;
}

interface AuthProvider {
  id: string;
  name: string;
  issuerUrl: string;
  instructions: string;
  docsUrl: string;
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

// Future provider icons — uncomment when supported:
// function MicrosoftIcon() {
//   return (
//     <svg width="20" height="20" viewBox="0 0 21 21">
//       <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
//       <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
//       <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
//       <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
//     </svg>
//   );
// }

// function OktaIcon() {
//   return (
//     <svg width="20" height="20" viewBox="0 0 24 24">
//       <circle cx="12" cy="12" r="10" fill="#007DC1"/>
//       <circle cx="12" cy="12" r="4" fill="#fff"/>
//     </svg>
//   );
// }

// function Auth0Icon() {
//   return (
//     <svg width="20" height="20" viewBox="0 0 24 24">
//       <path fill="#EB5424" d="M17.98 18.55L12 24l-5.98-5.45L8.8 12 2.82 5.45 12 0l9.18 5.45L14.2 12l3.78 6.55z"/>
//     </svg>
//   );
// }

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
    icon: <GoogleIcon />,
  },
  // Future providers — uncomment when supported:
  // {
  //   id: "microsoft",
  //   name: "Microsoft Entra ID",
  //   issuerUrl: "https://login.microsoftonline.com/{tenant}/v2.0",
  //   instructions:
  //     "Go to Azure Portal > App registrations > New registration. Set redirect URI and copy Application (client) ID.",
  //   docsUrl: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps",
  //   icon: <MicrosoftIcon />,
  // },
  // {
  //   id: "okta",
  //   name: "Okta",
  //   issuerUrl: "https://{your-domain}.okta.com",
  //   instructions:
  //     "Go to Okta Admin > Applications > Create App Integration. Choose OIDC and Web Application.",
  //   docsUrl: "https://developer.okta.com/docs/guides/implement-grant-type/authcode/main/",
  //   icon: <OktaIcon />,
  // },
  // {
  //   id: "auth0",
  //   name: "Auth0",
  //   issuerUrl: "https://{your-domain}.auth0.com",
  //   instructions:
  //     "Go to Auth0 Dashboard > Applications > Create Application. Choose Regular Web Application.",
  //   docsUrl: "https://auth0.com/docs/get-started/applications",
  //   icon: <Auth0Icon />,
  // },
  {
    id: "other",
    name: "Other OIDC Provider",
    issuerUrl: "",
    instructions:
      "Enter the issuer URL and OAuth credentials from your OIDC-compatible identity provider.",
    docsUrl: "",
    icon: <OidcIcon />,
  },
];

export default function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Form state
  const [dataDir, setDataDir] = useState("");
  const [authProvider, setAuthProvider] = useState<string>("google");
  const [oidcIssuer, setOidcIssuer] = useState("https://accounts.google.com");
  const [oidcClientId, setOidcClientId] = useState("");
  const [oidcClientSecret, setOidcClientSecret] = useState("");
  const [adminEmails, setAdminEmails] = useState("");
  const [port, setPort] = useState("3001");

  const [showAdvanced, setShowAdvanced] = useState(false);
  const TOTAL_STEPS = 4;

  useEffect(() => {
    window.electronAPI.getDefaultDataDir().then(setDataDir);
  }, []);

  const selectedProvider = AUTH_PROVIDERS.find((p) => p.id === authProvider)!;

  function handleProviderChange(providerId: string) {
    setAuthProvider(providerId);
    const provider = AUTH_PROVIDERS.find((p) => p.id === providerId);
    // Pre-fill issuer for known providers, clear it for "other"
    setOidcIssuer(provider?.issuerUrl ?? "");
  }

  function canProceed(): boolean {
    switch (step) {
      case 1:
        return dataDir.trim().length > 0;
      case 2:
        return authProvider.length > 0;
      case 3:
        return (
          oidcIssuer.trim().length > 0 &&
          oidcClientId.trim().length > 0 &&
          oidcClientSecret.trim().length > 0
        );
      case 4: {
        const portNum = parseInt(port, 10);
        return adminEmails.trim().length > 0 && portNum > 0 && portNum < 65536;
      }
      default:
        return false;
    }
  }

  async function handleNext() {
    setError("");

    if (step < TOTAL_STEPS) {
      setStep(step + 1);
      return;
    }

    // Final step — save config
    setSaving(true);
    try {
      const emails = adminEmails
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

      await window.electronAPI.saveSetup({
        dataDir: dataDir.trim(),
        port: parseInt(port, 10),
        oidcIssuer: oidcIssuer.trim(),
        oidcClientId: oidcClientId.trim(),
        oidcClientSecret: oidcClientSecret.trim(),
        adminEmails: emails,
      });

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    setError("");
    setStep(step - 1);
  }

  return (
    <div className="wizard">
      <div className="wizard-header">
        <img src={logoSrc} alt="Edgebric" className="wizard-logo" />
        <div className="wizard-header-text">
          <h1>Edgebric Setup</h1>
          <p>Configure Edgebric for first-time use.</p>
        </div>
      </div>

      <div className="wizard-step">
        {error && <div className="error-message">{error}</div>}

        {step === 1 && (
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

        {step === 2 && (
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

        {step === 3 && (
          <>
            <h2>{selectedProvider.name} Credentials</h2>
            <div className={authProvider === "google" ? "step3-split" : ""}>
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
                    <li>Click <strong>+ CREATE CREDENTIALS</strong>, then <strong>OAuth client ID</strong></li>
                    <li>Application type: <strong>Web application</strong></li>
                    <li>Name it anything (e.g. "Edgebric")</li>
                    <li>Under <strong>Authorized redirect URIs</strong>, add the URI from the form</li>
                    <li>Click <strong>CREATE</strong></li>
                    <li>Copy the <strong>Client ID</strong> (ends in <code>.apps.googleusercontent.com</code>) and <strong>Client Secret</strong> into the form</li>
                  </ol>
                </div>
              )}
              {selectedProvider.docsUrl && authProvider !== "google" && (
                <p className="description">
                  <a href={selectedProvider.docsUrl} target="_blank" rel="noopener noreferrer" className="docs-link">
                    Open {selectedProvider.name} console
                  </a>
                </p>
              )}
              <div className="step3-form">
                {authProvider === "other" && (
                  <div className="field">
                    <label htmlFor="oidcIssuer">Issuer URL</label>
                    <input
                      id="oidcIssuer"
                      type="text"
                      value={oidcIssuer}
                      onChange={(e) => setOidcIssuer(e.target.value)}
                      placeholder="https://your-provider.com"
                    />
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
                    Paste this into Google's "Authorized redirect URIs" field (step 5).
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="oidcClientId">Client ID</label>
                  <input
                    id="oidcClientId"
                    type="text"
                    value={oidcClientId}
                    onChange={(e) => setOidcClientId(e.target.value)}
                    placeholder={authProvider === "google" ? "xxxxxxxxxx.apps.googleusercontent.com" : ""}
                  />
                  <p className="hint">
                    {authProvider === "google"
                      ? "NOT the name you typed — it's the long string ending in .apps.googleusercontent.com"
                      : "Found in your OIDC provider's app registration page."}
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
                      : "Some providers only show this once — you may need to generate a new one."}
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2>Admin Access</h2>
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
                    <code>echo "rdr pass on lo0 inet proto tcp from any to any port 443 -&gt; 127.0.0.1 port {port}" | sudo pfctl -ef -</code>
                  </div>
                  <p className="hint" style={{ marginTop: 6 }}>
                    This survives until reboot. To make it permanent, add the rule to <code>/etc/pf.anchors/edgebric</code> and
                    load it from <code>/etc/pf.conf</code>. Requires admin (sudo) password.
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="wizard-footer">
        <span className="step-indicator">
          Step {step} of {TOTAL_STEPS}
        </span>
        <div className="buttons">
          {step > 1 && (
            <button className="btn btn-secondary" onClick={handleBack}>
              Back
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={handleNext}
            disabled={!canProceed() || saving}
          >
            {saving ? "Saving..." : step === TOTAL_STEPS ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
