/**
 * llama-server (llama.cpp) lifecycle manager — download, start, stop, auto-update with rollback.
 *
 * Runs TWO llama-server instances:
 *   - Chat server (port 8080): loads the active chat model
 *   - Embedding server (port 8081): loads the embedding model (nomic-embed-text)
 *
 * Binaries and models are stored at ~/Edgebric/.llama/. Users never see
 * "llama.cpp" — it's abstracted as the "AI engine."
 */
import path from "path";
import os from "os";
import fs from "fs";
import crypto from "crypto";
import { spawn, execSync } from "child_process";
import type { ChildProcess } from "child_process";
import https from "https";
import http from "http";
import { DEFAULT_DATA_DIR } from "./config.js";

// ─── Configuration ──────────────────────────────────────────────────────────

/** Pinned llama.cpp build number — tested and known to work with Edgebric. */
const PINNED_BUILD = "b8660";

const LLAMA_HOST = "127.0.0.1";
const CHAT_PORT = 8080;
const EMBEDDING_PORT = 8081;

export const CHAT_BASE_URL = `http://${LLAMA_HOST}:${CHAT_PORT}`;
export const EMBEDDING_BASE_URL = `http://${LLAMA_HOST}:${EMBEDDING_PORT}`;

// ─── Per-session API keys for llama-server authentication ───────────────────
// Generated fresh each time a llama-server instance is spawned.
// Prevents rogue processes from intercepting inference requests.
let chatApiKey: string | null = null;
let embeddingApiKey: string | null = null;

function generateApiKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Get the current API key for a llama-server role. Null if not yet started. */
export function getLlamaApiKey(role: "chat" | "embedding"): string | null {
  return role === "chat" ? chatApiKey : embeddingApiKey;
}

/** Directory for llama-server binary and model files. */
function llamaDir(dataDir?: string): string {
  return path.join(dataDir ?? DEFAULT_DATA_DIR, ".llama");
}

function llamaBinaryPath(dataDir?: string): string {
  return path.join(llamaDir(dataDir), "llama-server");
}

export function llamaModelsDir(dataDir?: string): string {
  return path.join(llamaDir(dataDir), "models");
}

function llamaPidPath(instance: "chat" | "embedding", dataDir?: string): string {
  return path.join(llamaDir(dataDir), `llama-${instance}.pid`);
}

// ─── Installation ────────────────────────────────────────────────────────────

/** Check if the llama-server binary exists on disk. */
export function isLlamaInstalled(dataDir?: string): boolean {
  return fs.existsSync(llamaBinaryPath(dataDir));
}

/** Get the installed llama-server build, or null if not installed. */
export function getInstalledVersion(dataDir?: string): string | null {
  const versionFile = path.join(llamaDir(dataDir), "version");
  if (!fs.existsSync(versionFile)) return null;
  try {
    return fs.readFileSync(versionFile, "utf8").trim();
  } catch {
    return null;
  }
}

/**
 * Download the llama-server binary from llama.cpp GitHub releases.
 * Downloads the pre-built macOS binary (arm64 or x64).
 */
export async function downloadLlama(
  build: string = PINNED_BUILD,
  dataDir?: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const dir = llamaDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(llamaModelsDir(dataDir), { recursive: true });

  const arch = os.arch() === "arm64" ? "arm64" : "x64";
  const assetName = `llama-${build}-bin-macos-${arch}.tar.gz`;
  const url = `https://github.com/ggml-org/llama.cpp/releases/download/${build}/${assetName}`;

  const tmpPath = path.join(dir, assetName);
  const finalPath = llamaBinaryPath(dataDir);

  await new Promise<void>((resolve, reject) => {
    const download = (downloadUrl: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error("Too many redirects"));
        return;
      }

      const protocol = downloadUrl.startsWith("https") ? https : http;
      protocol.get(downloadUrl, (res) => {
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
            try {
              // Extract llama-server and its shared libraries from the tar.gz
              // Archive extracts to llama-b{BUILD}/ containing binaries and dylibs
              const extractDir = path.join(dir, "extract-tmp");
              fs.mkdirSync(extractDir, { recursive: true });
              execSync(`tar xzf "${tmpPath}" -C "${extractDir}"`, { timeout: 30_000 });

              // Find the llama-server binary in the extracted directory
              const archiveDir = path.join(extractDir, `llama-${build}`);
              const extracted = fs.existsSync(path.join(archiveDir, "llama-server"))
                ? path.join(archiveDir, "llama-server")
                : path.join(extractDir, "build", "bin", "llama-server"); // fallback for older archives
              if (!fs.existsSync(extracted)) {
                throw new Error("llama-server binary not found in archive");
              }

              fs.copyFileSync(extracted, finalPath);
              fs.chmodSync(finalPath, 0o755);

              // Copy shared libraries (dylibs) required by llama-server
              const sourceDir = path.dirname(extracted);
              for (const entry of fs.readdirSync(sourceDir)) {
                if (entry.endsWith(".dylib")) {
                  const srcPath = path.join(sourceDir, entry);
                  const destPath = path.join(dir, entry);
                  // Preserve symlinks
                  const stat = fs.lstatSync(srcPath);
                  if (stat.isSymbolicLink()) {
                    const target = fs.readlinkSync(srcPath);
                    try { fs.unlinkSync(destPath); } catch { /* ignore */ }
                    fs.symlinkSync(target, destPath);
                  } else {
                    fs.copyFileSync(srcPath, destPath);
                  }
                }
              }

              // Cleanup
              fs.rmSync(extractDir, { recursive: true, force: true });
              fs.unlinkSync(tmpPath);

              // Write version file
              fs.writeFileSync(path.join(dir, "version"), build, "utf8");

              resolve();
            } catch (err) {
              reject(new Error(`Failed to extract llama-server binary: ${err}`));
            }
          });
        });
        file.on("error", reject);
      }).on("error", reject);
    };

    download(url);
  });
}

// ─── Process Management ──────────────────────────────────────────────────────

let chatProcess: ChildProcess | null = null;
let embeddingProcess: ChildProcess | null = null;

/** Currently loaded model paths */
let loadedChatModel: string | null = null;
let loadedEmbeddingModel: string | null = null;

/** Check if the chat server is running and reachable. */
export async function isChatServerRunning(): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (chatApiKey) headers["Authorization"] = `Bearer ${chatApiKey}`;
    const resp = await fetch(`${CHAT_BASE_URL}/health`, {
      headers,
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Check if the embedding server is running and reachable. */
export async function isEmbeddingServerRunning(): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (embeddingApiKey) headers["Authorization"] = `Bearer ${embeddingApiKey}`;
    const resp = await fetch(`${EMBEDDING_BASE_URL}/health`, {
      headers,
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Check if either server is running. */
export async function isLlamaRunning(): Promise<boolean> {
  const [chat, embed] = await Promise.all([
    isChatServerRunning(),
    isEmbeddingServerRunning(),
  ]);
  return chat || embed;
}

/**
 * Start a llama-server instance for the given role.
 * @param role - "chat" or "embedding"
 * @param modelPath - Absolute path to the GGUF model file
 */
export async function startInstance(
  role: "chat" | "embedding",
  modelPath: string,
  dataDir?: string,
): Promise<{ started: boolean }> {
  const port = role === "chat" ? CHAT_PORT : EMBEDDING_PORT;
  const checkFn = role === "chat" ? isChatServerRunning : isEmbeddingServerRunning;

  // Already running?
  if (await checkFn()) {
    return { started: true };
  }

  const bin = llamaBinaryPath(dataDir);
  if (!fs.existsSync(bin)) {
    throw new Error("llama-server binary not found. Run setup first.");
  }

  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model file not found: ${modelPath}`);
  }

  // Generate a fresh API key for this instance — prevents port-hijacking attacks
  const apiKey = generateApiKey();
  if (role === "chat") {
    chatApiKey = apiKey;
  } else {
    embeddingApiKey = apiKey;
  }

  const args = [
    "--model", modelPath,
    "--host", LLAMA_HOST,
    "--port", String(port),
    "--n-gpu-layers", "99",   // Use Metal (macOS GPU)
    "--ctx-size", "8192",
    "--api-key", apiKey,      // Require auth on all endpoints
  ];

  if (role === "embedding") {
    args.push("--embedding");   // Enable embedding endpoint
  } else {
    // Chat server: allow concurrent requests
    args.push("--parallel", "2");
    // Disable reasoning/thinking — wastes tokens with no quality benefit for RAG
    args.push("--reasoning", "off");
  }

  const child = spawn(bin, args, {
    detached: false,
    stdio: "ignore",
  });

  if (role === "chat") {
    chatProcess = child;
    loadedChatModel = modelPath;
  } else {
    embeddingProcess = child;
    loadedEmbeddingModel = modelPath;
  }

  // Write PID file
  if (child.pid) {
    fs.writeFileSync(llamaPidPath(role, dataDir), String(child.pid), "utf8");
  }

  // Wait for server to become responsive
  const deadline = Date.now() + 60_000; // llama-server can take longer to load
  while (Date.now() < deadline) {
    if (await checkFn()) {
      return { started: true };
    }
    await sleep(500);
  }

  throw new Error(`llama-server (${role}) failed to start within 60 seconds`);
}

/** Stop a llama-server instance. */
export async function stopInstance(role: "chat" | "embedding", dataDir?: string): Promise<void> {
  const proc = role === "chat" ? chatProcess : embeddingProcess;

  if (proc && !proc.killed) {
    proc.kill("SIGTERM");

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !proc.killed) {
      await sleep(500);
      try {
        if (proc.pid) process.kill(proc.pid, 0);
      } catch {
        break;
      }
    }

    if (!proc.killed) {
      try { proc.kill("SIGKILL"); } catch { /* already dead */ }
    }

    if (role === "chat") {
      chatProcess = null;
      loadedChatModel = null;
    } else {
      embeddingProcess = null;
      loadedEmbeddingModel = null;
    }
  }

  // PID file cleanup
  const pidFile = llamaPidPath(role, dataDir);
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
      if (!isNaN(pid)) {
        try { process.kill(pid, "SIGTERM"); } catch { /* already dead */ }
      }
    } catch { /* can't read PID file */ }
    try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
  }
}

/** Stop both instances. */
export async function stopLlama(dataDir?: string): Promise<void> {
  await Promise.all([
    stopInstance("chat", dataDir),
    stopInstance("embedding", dataDir),
  ]);
}

/** Kill any orphaned llama-server processes from previous runs. Call on app startup. */
export function killOrphanedLlamaProcesses(dataDir?: string): void {
  for (const role of ["chat", "embedding"] as const) {
    const pidFile = llamaPidPath(role, dataDir);
    if (!fs.existsSync(pidFile)) continue;

    try {
      const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
      if (isNaN(pid)) continue;

      // Check if process is alive
      try {
        process.kill(pid, 0);
        // Process exists — kill it
        process.kill(pid, "SIGTERM");
        // Give it a moment, then force kill
        setTimeout(() => {
          try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
        }, 3000);
      } catch {
        // Process doesn't exist — just clean up PID file
      }
    } catch { /* can't read PID file */ }

    try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
  }

  // Belt and suspenders: kill any llama-server process we didn't start
  try {
    execSync("pkill -f llama-server 2>/dev/null", { stdio: "ignore" });
  } catch { /* no processes found, that's fine */ }
}

/** Get the path of the currently loaded chat model. */
export function getLoadedChatModel(): string | null {
  return loadedChatModel;
}

/** Get the path of the currently loaded embedding model. */
export function getLoadedEmbeddingModel(): string | null {
  return loadedEmbeddingModel;
}

// ─── Model File Management ──────────────────────────────────────────────────

export interface LocalModel {
  /** Filename (e.g., "Qwen3-4B-Q4_K_M.gguf") */
  filename: string;
  /** Full path to the GGUF file */
  path: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Last modified timestamp */
  modifiedAt: string;
}

/** List all local GGUF model files. */
export function listLocalModels(dataDir?: string): LocalModel[] {
  const dir = llamaModelsDir(dataDir);
  if (!fs.existsSync(dir)) return [];

  const models: LocalModel[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".gguf")) {
      const fullPath = path.join(dir, entry.name);
      const stat = fs.statSync(fullPath);
      models.push({
        filename: entry.name,
        path: fullPath,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
  }
  return models;
}

/** Delete a local GGUF model file. */
export function deleteLocalModel(filename: string, dataDir?: string): void {
  const filePath = path.join(llamaModelsDir(dataDir), filename);
  if (!fs.existsSync(filePath)) throw new Error(`Model file not found: ${filename}`);
  fs.unlinkSync(filePath);
}

// ─── Auto-Update ─────────────────────────────────────────────────────────────

interface UpdateCheckResult {
  available: boolean;
  currentVersion: string | null;
  latestVersion: string;
}

/** Check if a newer llama.cpp build is available on GitHub. */
export async function checkForUpdate(dataDir?: string): Promise<UpdateCheckResult> {
  const currentVersion = getInstalledVersion(dataDir);

  try {
    const resp = await fetch("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Edgebric" },
    });
    if (!resp.ok) {
      return { available: false, currentVersion, latestVersion: PINNED_BUILD };
    }
    const data = (await resp.json()) as { tag_name: string };
    const latestVersion = data.tag_name;

    const available = currentVersion !== null && latestVersion !== currentVersion;
    return { available, currentVersion, latestVersion };
  } catch {
    return { available: false, currentVersion, latestVersion: PINNED_BUILD };
  }
}

/**
 * Auto-update llama-server with automatic rollback if the new version fails.
 */
export async function autoUpdate(
  dataDir?: string,
  onProgress?: (status: string, percent?: number) => void,
): Promise<{ success: boolean; version: string; rolled_back?: boolean }> {
  const update = await checkForUpdate(dataDir);
  if (!update.available) {
    return { success: true, version: update.currentVersion ?? PINNED_BUILD };
  }

  const bin = llamaBinaryPath(dataDir);
  const backupPath = bin + ".backup";

  try {
    onProgress?.("Stopping AI engine...");
    await stopLlama(dataDir);

    if (fs.existsSync(bin)) {
      fs.copyFileSync(bin, backupPath);
    }

    onProgress?.("Downloading update...");
    await downloadLlama(update.latestVersion, dataDir, (percent) => {
      onProgress?.("Downloading update...", percent);
    });

    // Verify the new binary exists
    if (!fs.existsSync(bin)) {
      throw new Error("New binary not found after download");
    }

    // Success — remove backup
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }
    onProgress?.("Update complete");
    return { success: true, version: update.latestVersion };
  } catch (err) {
    onProgress?.("Rolling back...");
    await stopLlama(dataDir).catch(() => {});

    if (fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, bin);
      fs.chmodSync(bin, 0o755);
    }

    onProgress?.("Rolled back to previous version");
    return {
      success: false,
      version: update.currentVersion ?? PINNED_BUILD,
      rolled_back: true,
    };
  }
}

// ─── HuggingFace Model Download ─────────────────────────────────────────────

/**
 * Download a GGUF model file from a URL (typically HuggingFace).
 * Streams to disk with progress reporting.
 */
export async function downloadModel(
  url: string,
  filename: string,
  dataDir?: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const dir = llamaModelsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });

  const finalPath = path.join(dir, filename);
  const tmpPath = finalPath + ".tmp";

  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Download cancelled")); return; }
    const onAbort = () => { reject(new Error("Download cancelled")); };
    signal?.addEventListener("abort", onAbort, { once: true });

    const download = (downloadUrl: string, redirectCount = 0) => {
      if (redirectCount > 10) {
        reject(new Error("Too many redirects"));
        return;
      }

      const protocol = downloadUrl.startsWith("https") ? https : http;
      const req = protocol.get(downloadUrl, (res) => {
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
            signal?.removeEventListener("abort", onAbort);
            // Rename tmp to final
            fs.renameSync(tmpPath, finalPath);
            resolve();
          });
        });
        file.on("error", (err) => {
          signal?.removeEventListener("abort", onAbort);
          reject(err);
        });
      });

      req.on("error", (err) => {
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      });

      signal?.addEventListener("abort", () => {
        req.destroy();
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      }, { once: true });
    };

    download(url);
  });

  return finalPath;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Get the base URL for the chat server. */
export function getChatBaseUrl(): string {
  return CHAT_BASE_URL;
}

/** Get the base URL for the embedding server. */
export function getEmbeddingBaseUrl(): string {
  return EMBEDDING_BASE_URL;
}
