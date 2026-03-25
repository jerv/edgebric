/**
 * Edgebric Configuration System
 *
 * Config is stored at ~/Edgebric/.edgebric.json (or DATA_DIR/.edgebric.json).
 * Advanced users can edit this file directly while the server is stopped.
 *
 * Available fields:
 *   dataDir          — Where Edgebric stores its database, uploads, and logs
 *   port             — Server port (default: 3001)
 *   hostname         — How users access Edgebric in the browser (default: "edgebric.local")
 *                      Use any *.local name for zero-config mDNS (Bonjour/Avahi),
 *                      or a real domain like "hr.acme.com" if you have DNS configured.
 *   oidcIssuer       — OIDC identity provider URL
 *   oidcClientId     — OAuth 2.0 client ID
 *   oidcClientSecret — OAuth 2.0 client secret
 *   adminEmails      — Array of email addresses with admin access
 *   chatBaseUrl      — (optional) LLM API endpoint (OpenAI-compatible)
 *   chatModel        — (optional) LLM model name
 *
 * After editing, restart the server from the tray menu for changes to take effect.
 * The .env file is regenerated automatically on save from the desktop app.
 */
import path from "path";
import os from "os";
import fs from "fs";

/** Default data directory: ~/Edgebric */
export const DEFAULT_DATA_DIR = path.join(os.homedir(), "Edgebric");

export type EdgebricMode = "solo" | "admin" | "member";

export interface EdgebricConfig {
  /** Setup mode: solo (no auth), admin (org server), member (connect to org). */
  mode: EdgebricMode;
  dataDir: string;
  port: number;
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  adminEmails?: string[];
  chatBaseUrl?: string;
  chatModel?: string;
  /** Org server URL for member mode. */
  orgServerUrl?: string;

  /**
   * Hostname for accessing Edgebric in the browser.
   *
   * Default: "edgebric.local" — uses mDNS (Bonjour/Avahi), works on any
   * network without DNS configuration. All devices on the LAN can reach it.
   *
   * Custom domain examples:
   *   "edgebric.yourcompany.com" — if your org has DNS pointing to this machine
   *   "edgebric.local"    — default mDNS name, zero-config
   *   "my-edgebric.local" — custom mDNS name (auto-published via Bonjour)
   *
   * To use a custom domain, set this field and configure your DNS (A record
   * pointing to this machine's IP) or use any *.local name for automatic
   * mDNS resolution.
   */
  hostname?: string;

  /** Whether Ollama should auto-update on app launch. Default: true. */
  ollamaAutoUpdate?: boolean;

  /** License key for org mode. Required to enable OIDC/SSO/multi-user features. */
  licenseKey?: string;
}

/** Config file location: DATA_DIR/.edgebric.json */
export function configPath(dataDir?: string): string {
  return path.join(dataDir ?? DEFAULT_DATA_DIR, ".edgebric.json");
}

/** PID file location: DATA_DIR/.edgebric.pid */
export function pidPath(dataDir?: string): string {
  return path.join(dataDir ?? DEFAULT_DATA_DIR, ".edgebric.pid");
}

/** Log file location: DATA_DIR/edgebric.log */
export function logPath(dataDir?: string): string {
  return path.join(dataDir ?? DEFAULT_DATA_DIR, "edgebric.log");
}

/** Env file location: DATA_DIR/.env */
export function envPath(dataDir?: string): string {
  return path.join(dataDir ?? DEFAULT_DATA_DIR, ".env");
}

/** Load config from disk. Returns null if not found. */
export function loadConfig(dataDir?: string): EdgebricConfig | null {
  const p = configPath(dataDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as EdgebricConfig;
  } catch {
    return null;
  }
}

/** Save config to disk. */
export function saveConfig(config: EdgebricConfig): void {
  const p = configPath(config.dataDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config, null, 2) + "\n", "utf8");
}

/** Check if first run (no config file) */
export function isFirstRun(): boolean {
  return loadConfig() === null;
}
