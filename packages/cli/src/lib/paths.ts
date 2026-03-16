import path from "path";
import os from "os";
import fs from "fs";

/** Default data directory: ~/Edgebric */
export const DEFAULT_DATA_DIR = path.join(os.homedir(), "Edgebric");

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

export interface EdgebricConfig {
  dataDir: string;
  port: number;
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecret: string;
  adminEmails: string[];
  chatBaseUrl?: string;
  chatModel?: string;
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
