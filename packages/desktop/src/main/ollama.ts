/**
 * Ollama binary management — download, start, stop, auto-update with rollback.
 *
 * The Ollama binary is stored at ~/Edgebric/.ollama/ollama (isolated from any
 * system install). Model data goes to ~/Edgebric/.ollama/models. Users never
 * see the word "Ollama" — it's abstracted as the "AI engine."
 */
import path from "path";
import os from "os";
import fs from "fs";
import { spawn, execSync } from "child_process";
import type { ChildProcess } from "child_process";
import https from "https";
import http from "http";
import { DEFAULT_DATA_DIR } from "./config.js";

// ─── Configuration ──────────────────────────────────────────────────────────

/** Pinned Ollama version — tested and known to work with Edgebric. */
const PINNED_VERSION = "0.6.2";

const OLLAMA_HOST = "127.0.0.1";
const OLLAMA_PORT = 11434;
const OLLAMA_URL = `http://${OLLAMA_HOST}:${OLLAMA_PORT}`;

/** Directory for Ollama binary and model data. */
function ollamaDir(dataDir?: string): string {
  return path.join(dataDir ?? DEFAULT_DATA_DIR, ".ollama");
}

function ollamaBinaryPath(dataDir?: string): string {
  return path.join(ollamaDir(dataDir), "ollama");
}

function ollamaModelsDir(dataDir?: string): string {
  return path.join(ollamaDir(dataDir), "models");
}

function ollamaPidPath(dataDir?: string): string {
  return path.join(ollamaDir(dataDir), "ollama.pid");
}

// ─── Installation ────────────────────────────────────────────────────────────

/** Check if the Ollama binary exists on disk. */
export function isOllamaInstalled(dataDir?: string): boolean {
  return fs.existsSync(ollamaBinaryPath(dataDir));
}

/** Get the installed Ollama version, or null if not installed. */
export function getInstalledVersion(dataDir?: string): string | null {
  const bin = ollamaBinaryPath(dataDir);
  if (!fs.existsSync(bin)) return null;
  try {
    const output = execSync(`"${bin}" --version 2>&1`, { encoding: "utf8", timeout: 5000 });
    // Output format: "ollama version is 0.6.2" or "ollama version 0.6.2"
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Download the Ollama binary from GitHub releases.
 * Uses the raw darwin binary (not the .app installer) to avoid macOS auto-updates.
 */
export async function downloadOllama(
  version: string = PINNED_VERSION,
  dataDir?: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const dir = ollamaDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(ollamaModelsDir(dataDir), { recursive: true });

  const arch = os.arch() === "arm64" ? "arm64" : "amd64";
  const url = `https://github.com/ollama/ollama/releases/download/v${version}/ollama-darwin-${arch}`;

  const tmpPath = ollamaBinaryPath(dataDir) + ".tmp";
  const finalPath = ollamaBinaryPath(dataDir);

  await new Promise<void>((resolve, reject) => {
    const download = (downloadUrl: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error("Too many redirects"));
        return;
      }

      const protocol = downloadUrl.startsWith("https") ? https : http;
      protocol.get(downloadUrl, (res) => {
        // Follow redirects (GitHub releases redirect to CDN)
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          download(res.headers.location, redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }

        const totalBytes = parseInt(res.headers["content-length"] ?? "0", 10);
        let downloadedBytes = 0;
        const file = fs.createWriteStream(tmpPath);

        res.on("data", (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0 && onProgress) {
            onProgress(Math.round((downloadedBytes / totalBytes) * 100));
          }
        });

        res.pipe(file);
        file.on("finish", () => {
          file.close(() => {
            // Atomic rename
            fs.renameSync(tmpPath, finalPath);
            // Make executable
            fs.chmodSync(finalPath, 0o755);
            resolve();
          });
        });
        file.on("error", reject);
      }).on("error", reject);
    };

    download(url);
  });
}

// ─── Process Management ──────────────────────────────────────────────────────

let ollamaProcess: ChildProcess | null = null;

/** Check if Ollama is currently running and reachable. */
export async function isOllamaRunning(): Promise<boolean> {
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/version`, {
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Check if port 11434 is already in use (e.g., by a system Ollama install).
 * If so, we can use the existing instance instead of starting our own.
 */
export async function isPortInUse(): Promise<boolean> {
  return isOllamaRunning();
}

/**
 * Start Ollama server. If the port is already in use (e.g., system Ollama),
 * we piggyback on the existing instance instead of starting our own.
 */
export async function startOllama(dataDir?: string): Promise<{ started: boolean; external: boolean }> {
  // Check if something is already running on the port
  if (await isOllamaRunning()) {
    return { started: true, external: true };
  }

  const bin = ollamaBinaryPath(dataDir);
  if (!fs.existsSync(bin)) {
    throw new Error("Ollama binary not found. Run setup first.");
  }

  const modelsDir = ollamaModelsDir(dataDir);
  fs.mkdirSync(modelsDir, { recursive: true });

  ollamaProcess = spawn(bin, ["serve"], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      OLLAMA_HOST: `${OLLAMA_HOST}:${OLLAMA_PORT}`,
      OLLAMA_MODELS: modelsDir,
      // Allow 2 concurrent inferences (default is 1 — sequential).
      // RAM cost: 2x KV-cache. Fine for <=8B models on 16GB+ Macs.
      OLLAMA_NUM_PARALLEL: process.env.OLLAMA_NUM_PARALLEL ?? "2",
      // Enable multi-user prompt cache optimization
      OLLAMA_MULTIUSER_CACHE: "1",
      // Disable Ollama's built-in update check since we manage updates
      OLLAMA_NOPRUNE: "1",
    },
  });

  ollamaProcess.unref();

  // Write PID file
  if (ollamaProcess.pid) {
    const pidFile = ollamaPidPath(dataDir);
    fs.writeFileSync(pidFile, String(ollamaProcess.pid), "utf8");
  }

  // Wait for Ollama to become responsive
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isOllamaRunning()) {
      return { started: true, external: false };
    }
    await sleep(500);
  }

  throw new Error("Ollama failed to start within 30 seconds");
}

/** Stop the Ollama server. */
export async function stopOllama(dataDir?: string): Promise<void> {
  // Try to kill our managed process first
  if (ollamaProcess && !ollamaProcess.killed) {
    ollamaProcess.kill("SIGTERM");

    // Wait up to 10 seconds for graceful shutdown
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !ollamaProcess.killed) {
      await sleep(500);
      // Check if still running
      try {
        if (ollamaProcess.pid) process.kill(ollamaProcess.pid, 0); // signal 0 = check existence
      } catch {
        break; // Process is gone
      }
    }

    // Force kill if still alive
    if (!ollamaProcess.killed) {
      try {
        ollamaProcess.kill("SIGKILL");
      } catch {
        // Already dead
      }
    }

    ollamaProcess = null;
  }

  // Also try PID file cleanup
  const pidFile = ollamaPidPath(dataDir);
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
      if (!isNaN(pid)) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Process already dead
        }
      }
    } catch {
      // Can't read PID file
    }
    try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
  }
}

// ─── Auto-Update ─────────────────────────────────────────────────────────────

interface UpdateCheckResult {
  available: boolean;
  currentVersion: string | null;
  latestVersion: string;
}

/** Check if a newer Ollama version is available on GitHub. */
export async function checkForUpdate(dataDir?: string): Promise<UpdateCheckResult> {
  const currentVersion = getInstalledVersion(dataDir);

  try {
    const resp = await fetch("https://api.github.com/repos/ollama/ollama/releases/latest", {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Edgebric" },
    });
    if (!resp.ok) {
      return { available: false, currentVersion, latestVersion: PINNED_VERSION };
    }
    const data = (await resp.json()) as { tag_name: string };
    const latestVersion = data.tag_name.replace(/^v/, "");

    const available = currentVersion !== null && latestVersion !== currentVersion;
    return { available, currentVersion, latestVersion };
  } catch {
    return { available: false, currentVersion, latestVersion: PINNED_VERSION };
  }
}

/**
 * Auto-update Ollama with automatic rollback if the new version fails.
 *
 * Flow:
 * 1. Stop Ollama
 * 2. Backup current binary
 * 3. Download new version
 * 4. Start new version, verify API responds
 * 5. If OK: remove backup
 * 6. If FAIL: restore backup, restart old version
 */
export async function autoUpdate(
  dataDir?: string,
  onProgress?: (status: string, percent?: number) => void,
): Promise<{ success: boolean; version: string; rolled_back?: boolean }> {
  const update = await checkForUpdate(dataDir);
  if (!update.available) {
    return { success: true, version: update.currentVersion ?? PINNED_VERSION };
  }

  const bin = ollamaBinaryPath(dataDir);
  const backupPath = bin + ".backup";

  try {
    // 1. Stop
    onProgress?.("Stopping AI engine...");
    await stopOllama(dataDir);

    // 2. Backup
    if (fs.existsSync(bin)) {
      fs.copyFileSync(bin, backupPath);
    }

    // 3. Download new version
    onProgress?.("Downloading update...");
    await downloadOllama(update.latestVersion, dataDir, (percent) => {
      onProgress?.("Downloading update...", percent);
    });

    // 4. Start and verify
    onProgress?.("Verifying update...");
    await startOllama(dataDir);
    const running = await isOllamaRunning();

    if (running) {
      // Success — remove backup
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
      onProgress?.("Update complete");
      return { success: true, version: update.latestVersion };
    }

    // Verification failed — rollback
    throw new Error("New version failed to start");
  } catch (err) {
    // 6. Rollback
    onProgress?.("Rolling back...");
    await stopOllama(dataDir).catch(() => {});

    if (fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, bin);
      fs.chmodSync(bin, 0o755);
    }

    // Restart old version
    try {
      await startOllama(dataDir);
    } catch {
      // Can't restart — user will need to restart manually
    }

    onProgress?.("Rolled back to previous version");
    return {
      success: false,
      version: update.currentVersion ?? PINNED_VERSION,
      rolled_back: true,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Get the base URL for the Ollama API. */
export function getOllamaBaseUrl(): string {
  return OLLAMA_URL;
}
