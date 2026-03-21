import React, { useState, useEffect } from "react";

interface Props {
  onComplete: () => void;
}

interface AuthProvider {
  id: string;
  name: string;
  issuerUrl: string;
  instructions: string;
  docsUrl: string;
}

const AUTH_PROVIDERS: AuthProvider[] = [
  {
    id: "google",
    name: "Google Workspace",
    issuerUrl: "https://accounts.google.com",
    instructions:
      "Go to console.cloud.google.com > APIs & Services > Credentials. Create an OAuth 2.0 Client ID and set the redirect URI.",
    docsUrl: "https://console.cloud.google.com/apis/credentials",
  },
  // Future providers — uncomment when supported:
  // {
  //   id: "microsoft",
  //   name: "Microsoft Entra ID",
  //   issuerUrl: "https://login.microsoftonline.com/{tenant}/v2.0",
  //   instructions:
  //     "Go to Azure Portal > App registrations > New registration. Set redirect URI and copy Application (client) ID.",
  //   docsUrl: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps",
  // },
  // {
  //   id: "okta",
  //   name: "Okta",
  //   issuerUrl: "https://{your-domain}.okta.com",
  //   instructions:
  //     "Go to Okta Admin > Applications > Create App Integration. Choose OIDC and Web Application.",
  //   docsUrl: "https://developer.okta.com/docs/guides/implement-grant-type/authcode/main/",
  // },
  // {
  //   id: "auth0",
  //   name: "Auth0",
  //   issuerUrl: "https://{your-domain}.auth0.com",
  //   instructions:
  //     "Go to Auth0 Dashboard > Applications > Create Application. Choose Regular Web Application.",
  //   docsUrl: "https://auth0.com/docs/get-started/applications",
  // },
  {
    id: "other",
    name: "Other OIDC Provider",
    issuerUrl: "",
    instructions:
      "Enter the issuer URL and OAuth credentials from your OIDC-compatible identity provider.",
    docsUrl: "",
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

  const TOTAL_STEPS = 5;

  useEffect(() => {
    window.electronAPI.getDefaultDataDir().then(setDataDir);
  }, []);

  const selectedProvider = AUTH_PROVIDERS.find((p) => p.id === authProvider)!;

  function handleProviderChange(providerId: string) {
    setAuthProvider(providerId);
    const provider = AUTH_PROVIDERS.find((p) => p.id === providerId);
    if (provider && provider.issuerUrl) {
      setOidcIssuer(provider.issuerUrl);
    }
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
      case 4:
        return adminEmails.trim().length > 0;
      case 5:
        return parseInt(port, 10) > 0 && parseInt(port, 10) < 65536;
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
        <h1>Edgebric Setup</h1>
        <p>Configure Edgebric for first-time use.</p>
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
                  <span className="provider-name">{provider.name}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2>{selectedProvider.name} Credentials</h2>
            <p className="description">{selectedProvider.instructions}</p>
            {selectedProvider.docsUrl && (
              <p className="description">
                <a
                  href={selectedProvider.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="docs-link"
                >
                  Open {selectedProvider.name} console
                </a>
              </p>
            )}
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
              <label htmlFor="oidcClientId">Client ID</label>
              <input
                id="oidcClientId"
                type="text"
                value={oidcClientId}
                onChange={(e) => setOidcClientId(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="oidcClientSecret">Client Secret</label>
              <input
                id="oidcClientSecret"
                type="password"
                value={oidcClientSecret}
                onChange={(e) => setOidcClientSecret(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Redirect URI</label>
              <input
                type="text"
                readOnly
                value={`http://localhost:${port}/api/auth/callback`}
                className="readonly"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <p className="hint">
                Copy this into your provider's redirect URI / callback URL field.
              </p>
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
          </>
        )}

        {step === 5 && (
          <>
            <h2>Server Port</h2>
            <p className="description">
              Which port should Edgebric run on? The default (3001) works for most setups.
            </p>
            <div className="field">
              <label htmlFor="port">Port</label>
              <input
                id="port"
                type="number"
                min="1"
                max="65535"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
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
