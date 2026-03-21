import React, { useState, useEffect } from "react";

interface Props {
  onComplete: () => void;
}

export default function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Form state
  const [dataDir, setDataDir] = useState("");
  const [oidcIssuer, setOidcIssuer] = useState("https://accounts.google.com");
  const [oidcClientId, setOidcClientId] = useState("");
  const [oidcClientSecret, setOidcClientSecret] = useState("");
  const [adminEmails, setAdminEmails] = useState("");
  const [port, setPort] = useState("3001");

  const TOTAL_STEPS = 4;

  useEffect(() => {
    window.electronAPI.getDefaultDataDir().then(setDataDir);
  }, []);

  function canProceed(): boolean {
    switch (step) {
      case 1:
        return dataDir.trim().length > 0;
      case 2:
        return (
          oidcIssuer.trim().length > 0 &&
          oidcClientId.trim().length > 0 &&
          oidcClientSecret.trim().length > 0
        );
      case 3:
        return adminEmails.trim().length > 0;
      case 4:
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
            <h2>Single Sign-On (OIDC)</h2>
            <p className="description">
              Edgebric uses OIDC for authentication. You need credentials from your
              identity provider (Google Workspace, Microsoft 365, Okta, etc.).
            </p>
            <div className="field">
              <label htmlFor="oidcIssuer">Issuer URL</label>
              <input
                id="oidcIssuer"
                type="text"
                value={oidcIssuer}
                onChange={(e) => setOidcIssuer(e.target.value)}
                placeholder="https://accounts.google.com"
              />
            </div>
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
              <p className="hint">
                For Google: console.cloud.google.com &gt; APIs &amp; Services &gt; Credentials
              </p>
            </div>
          </>
        )}

        {step === 3 && (
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

        {step === 4 && (
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
