import { useState } from "react";
import logoSrc from "../assets/logo.png";

interface NameSetupProps {
  onComplete: () => void;
}

export function NameSetup({ onComplete }: NameSetupProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim()) return;

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Failed to save");
        return;
      }

      onComplete();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-white dark:bg-gray-950">
      <div className="w-full max-w-sm mx-auto px-6">
        <div className="flex items-center gap-3 mb-1">
          <img src={logoSrc} alt="" className="w-10 h-10 rounded-xl" />
          <h1 className="text-xl font-semibold text-slate-900 dark:text-gray-100">Welcome to Edgebric</h1>
        </div>
        <p className="text-sm text-slate-500 dark:text-gray-400 mb-6">What should we call you?</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-gray-400 mb-1">First name</label>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoFocus
              required
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600"
              placeholder="Jane"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-gray-400 mb-1">
              Last name <span className="text-slate-400 dark:text-gray-500">(optional)</span>
            </label>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-gray-600"
              placeholder="Doe"
            />
          </div>

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={!firstName.trim() || saving}
            className="w-full py-2.5 text-sm font-medium bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-xl hover:bg-slate-800 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
