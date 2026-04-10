import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { app } from "electron";
import Bonjour from "bonjour-service";
import { loadConfig, saveConfig, pidPath, logPath, envPath, type EdgebricConfig } from "./config.js";
import { certsExist, certPaths } from "./certs.js";
import {
  isLlamaInstalled,
  downloadLlama,
  downloadModel,
  startInstance,
  stopLlama,
  isLlamaRunning,
  autoUpdate,
  getInstalledVersion,
  llamaModelsDir,
} from "./llama-server.js";

let serverProcess: ChildProcess | null = null;
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
let bonjourInstance: InstanceType<typeof Bonjour> | null = null;
let operationInProgress = false;
let serverStartedAt: number | null = null;

export type ServerStatus = "stopped" | "starting" | "running" | "error";

type StatusChangeCallback = (status: ServerStatus, errorMsg?: string) => void;
const listeners: StatusChangeCallback[] = [];
let currentStatus: ServerStatus = "stopped";
let currentErrorMsg: string | undefined;

function setStatus(status: ServerStatus, errorMsg?: string) {
  currentStatus = status;
  currentErrorMsg = status === "error" ? errorMsg : undefined;
  if (status === "running" && !serverStartedAt) serverStartedAt = Date.now();
  if (status === "stopped" || status === "error") serverStartedAt = null;
  for (const cb of listeners) cb(status, currentErrorMsg);
}

export function getErrorMsg(): string | undefined {
  return currentErrorMsg;
}

export function onStatusChange(cb: StatusChangeCallback) {
  listeners.push(cb);
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

export function getStatus(): ServerStatus {
  return currentStatus;
}

export function getPort(): number {
  return loadConfig()?.port ?? 3001;
}

function isSoloConfig(config: EdgebricConfig | null | undefined): boolean {
  return config?.mode === "solo";
}

function getEffectiveHostname(config: EdgebricConfig | null | undefined): string {
  if (isSoloConfig(config)) return "localhost";
  return config?.hostname ?? "edgebric.local";
}

function hasHttps(config: EdgebricConfig | null | undefined): boolean {
  return !!config && !isSoloConfig(config) && certsExist(config.dataDir);
}

export function getHostname(): string {
  return getEffectiveHostname(loadConfig());
}

export function getProtocol(): "http" | "https" {
  return hasHttps(loadConfig()) ? "https" : "http";
}

export function getAccessUrl(): string {
  const hostname = getHostname();
  const port = getPort();
  const proto = getProtocol();
  const defaultPort = proto === "https" ? 443 : 80;
  return port === defaultPort ? `${proto}://${hostname}` : `${proto}://${hostname}:${port}`;
}

export function getUptime(): number | null {
  if (!serverStartedAt) return null;
  return Math.floor((Date.now() - serverStartedAt) / 1000);
}

/** Publish mDNS service so edgebric.local (or custom .local name) resolves on the LAN */
function publishMdns(hostname: string, port: number) {
  unpublishMdns();

  // Only publish mDNS for .local hostnames — custom domains use real DNS
  if (!hostname.endsWith(".local")) return;

  try {
    bonjourInstance = new Bonjour(undefined, (err: Error) => {
      // Swallow mDNS errors (e.g. EADDRNOTAVAIL after sleep/wake)
      console.warn("mDNS error (non-fatal):", err.message);
    });
    const name = hostname.replace(/\.local$/, "");
    bonjourInstance.publish({
      name,
      type: "_edgebric._tcp",
      port,
      host: hostname,
      txt: {
        version: app.getVersion(),
        protocol: "https",
      },
    });
  } catch (err) {
    console.error("mDNS publish failed:", err);
  }
}

function unpublishMdns() {
  if (bonjourInstance) {
    try {
      bonjourInstance.unpublishAll();
      bonjourInstance.destroy();
    } catch { /* ignore */ }
    bonjourInstance = null;
  }
}

/**
 * Find the API server entry point.
 * In development: packages/api/src/server.ts (run via tsx)
 * In production: bundled server (TBD — pre-compiled JS)
 */
function findServerPath(): string | null {
  const candidates = [
    // Monorepo development — relative to desktop package
    path.resolve(app.getAppPath(), "..", "api", "src", "server.ts"),
    // Monorepo development — from project root
    path.resolve(app.getAppPath(), "..", "..", "packages", "api", "src", "server.ts"),
    // Packaged app — bundled server (extraResources preserves "resources/" prefix)
    path.resolve(process.resourcesPath ?? "", "resources", "server", "server.js"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Check if a PID is still alive */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Extract a useful error message from the last lines of a log file */
function getLastError(logFile: string): string | null {
  try {
    const content = fs.readFileSync(logFile, "utf8");
    const lines = content.split("\n").filter(Boolean);
    // Look for common error patterns in the last 20 lines
    const tail = lines.slice(-20);
    for (const line of tail.reverse()) {
      if (line.includes("EADDRINUSE")) return "Port already in use. Stop any other servers or change the port in Settings.";
      if (line.includes("EACCES")) return "Permission denied. Try a port above 1024.";
      if (line.includes("ENOSPC")) return "No disk space available.";
      if (line.includes("Cannot find module")) return "Missing dependency. Try reinstalling.";
      if (line.includes("SyntaxError")) return "Configuration error. Check your .env file.";
    }
  } catch { /* ignore */ }
  return null;
}

/** Start the API server as a child process */
export async function startServer(): Promise<void> {
  if (operationInProgress) return;
  if (currentStatus === "starting" || currentStatus === "running") return;
  operationInProgress = true;
  try {
    await _startServer();
  } finally {
    operationInProgress = false;
  }
}

async function _startServer(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    setStatus("error", "No configuration found. Run setup first.");
    throw new Error("No configuration found. Run setup first.");
  }

  // Check if already running (via PID file from CLI or previous session)
  const pidFile = pidPath(config.dataDir);
  if (fs.existsSync(pidFile)) {
    const existingPid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    if (!isNaN(existingPid) && isProcessRunning(existingPid)) {
      // Adopt the existing process — don't spawn a new one
      setStatus("starting");
      startHealthCheck(config.port);
      return;
    }
    // Stale PID file, clean up
    try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
  }

  const envFile = envPath(config.dataDir);
  if (!fs.existsSync(envFile)) {
    setStatus("error", "Environment file not found. Run setup first.");
    throw new Error("Environment file not found. Run setup first.");
  }

  const serverPath = findServerPath();
  if (!serverPath) {
    setStatus("error", "Could not find the Edgebric API server.");
    throw new Error("Could not find the Edgebric API server.");
  }

  setStatus("starting");

  // Start llama-server before the API server
  try {
    if (!isLlamaInstalled(config.dataDir)) {
      await downloadLlama(undefined, config.dataDir);
    }

    const modelsDir = llamaModelsDir(config.dataDir);

    // Start embedding server (auto-download if missing)
    const embeddingFilename = "nomic-embed-text-v1.5.Q8_0.gguf";
    const embeddingModel = path.join(modelsDir, embeddingFilename);
    if (!fs.existsSync(embeddingModel)) {
      const embeddingUrl = "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf";
      console.log("Embedding model not found, downloading...");
      console.log("Downloading embedding model...");
      try {
        await downloadModel(embeddingUrl, embeddingFilename, config.dataDir, (pct) => {
          console.log(`Downloading embedding model... ${pct}%`);
        });
        console.log("Embedding model downloaded");
      } catch (err) {
        console.warn("Failed to download embedding model:", err);
      }
    }
    if (fs.existsSync(embeddingModel)) {
      await startInstance("embedding", embeddingModel, config.dataDir);
    }

    // Start chat server — auto-download default model if none installed
    const DEFAULT_CHAT_TAG = "qwen3.5-4b";
    const DEFAULT_CHAT_FILENAME = "Qwen3.5-4B-Q4_K_M.gguf";
    const DEFAULT_CHAT_URL = "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf";

    const files = fs.existsSync(modelsDir) ? fs.readdirSync(modelsDir) : [];
    const chatFiles = files.filter(f => f.endsWith(".gguf") && f !== "nomic-embed-text-v1.5.Q8_0.gguf");

    if (chatFiles.length === 0) {
      // No chat models at all — download the default
      console.log("No chat model found, downloading default...");
      try {
        await downloadModel(DEFAULT_CHAT_URL, DEFAULT_CHAT_FILENAME, config.dataDir, (pct) => {
          console.log(`Downloading chat model... ${pct}%`);
        });
        console.log("Default chat model downloaded");
        chatFiles.push(DEFAULT_CHAT_FILENAME);
        config.chatModel = DEFAULT_CHAT_TAG;
        saveConfig(config);
      } catch (err) {
        console.warn("Failed to download default chat model:", err);
      }
    }

    if (chatFiles.length > 0) {
      // Prefer the configured model, fall back to first available
      let chatFile: string | undefined;
      if (config.chatModel) {
        // Try to find the GGUF matching the configured tag
        chatFile = chatFiles.find(f => f.toLowerCase().includes(config.chatModel!.replace(/[.-]/g, "").toLowerCase()));
      }
      chatFile = chatFile ?? chatFiles[0];
      if (chatFile) {
        await startInstance("chat", path.join(modelsDir, chatFile), config.dataDir);
      }
    }

    // Auto-update if enabled (non-blocking)
    if (config.llamaAutoUpdate !== false) {
      autoUpdate(config.dataDir).catch((err) => {
        console.error("llama-server auto-update failed:", err);
      });
    }
  } catch (err) {
    console.error("llama-server startup failed:", err);
    // Continue anyway — the API will report AI as unavailable via health endpoint
  }

  const logFile = logPath(config.dataDir);
  const logFd = fs.openSync(logFile, "a");

  // Determine how to run the server
  const isTsFile = serverPath.endsWith(".ts");
  // serverPath = .../packages/api/src/server.ts → go up 2 levels to packages/api
  const apiDir = path.dirname(path.dirname(serverPath));

  // Resolve tsx loader path absolutely — bare "tsx/esm" won't resolve from
  // the desktop package since tsx is only in api/node_modules
  const tsxEsmPath = path.join(apiDir, "node_modules", "tsx", "dist", "esm", "index.mjs");
  const args = isTsFile
    ? [`--import=${tsxEsmPath}`, serverPath]
    : [serverPath];

  // Pass llama-server API keys to the API process so it can authenticate
  // inference requests. Keys are generated fresh each time llama-server starts.
  const { getLlamaApiKey } = await import("./llama-server.js");
  const llamaChatKey = getLlamaApiKey("chat");
  const llamaEmbeddingKey = getLlamaApiKey("embedding");

  // Pass TLS cert paths so the API server runs HTTPS when certs exist.
  // Without this, the desktop health check uses https:// (because certs exist
  // on disk) but the API runs http:// — causing a protocol mismatch that
  // makes the health check silently fail and the UI stick on "starting".
  const hasCerts = hasHttps(config);
  const certs = hasCerts ? certPaths(config.dataDir) : null;

  // In packaged apps, the web frontend is at resources/web/dist
  const isPackaged = serverPath.includes("resources/server/");
  const webDistDir = isPackaged
    ? path.resolve(process.resourcesPath ?? "", "resources", "web", "dist")
    : undefined;

  // Use Electron's own Node.js runtime to run the server so native modules
  // (better-sqlite3, sharp, sqlite-vec) are always compatible.
  // ELECTRON_RUN_AS_NODE=1 makes the Electron binary act as plain Node.
  const nodeExe = isPackaged ? process.execPath : "node";

  serverProcess = spawn(nodeExe, args, {
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      ...(isPackaged && { ELECTRON_RUN_AS_NODE: "1" }),
      DOTENV_CONFIG_PATH: envFile,
      SERVE_STATIC: "1",
      EDGEBRIC_VERSION: app.getVersion(),
      ...(llamaChatKey && { CHAT_API_KEY: llamaChatKey }),
      ...(llamaEmbeddingKey && { EMBEDDING_API_KEY: llamaEmbeddingKey }),
      ...(webDistDir && { WEB_DIST_DIR: webDistDir }),
      ...(certs && { TLS_CERT: certs.serverCert, TLS_KEY: certs.serverKey }),
    },
    cwd: apiDir,
  });

  fs.closeSync(logFd);

  if (serverProcess.pid) {
    fs.writeFileSync(pidFile, String(serverProcess.pid), "utf8");
  }

  serverProcess.on("exit", (code) => {
    serverProcess = null;
    stopHealthCheck();
    // Clean up PID file
    try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
    if (code === 0) {
      setStatus("stopped");
    } else {
      // Try to extract the crash reason from the log
      const errMsg = getLastError(logFile);
      setStatus("error", errMsg ?? `Server exited with code ${code}`);
    }
  });

  startHealthCheck(config.port);

  // Publish mDNS so edgebric.local resolves on the network (admin mode only)
  if (config.mode !== "solo") {
    const hostname = config.hostname ?? "edgebric.local";
    publishMdns(hostname, config.port);
  }
}

/** Stop the API server */
export async function stopServer(): Promise<void> {
  if (operationInProgress) return;
  operationInProgress = true;
  try {
    await _stopServer();
  } finally {
    operationInProgress = false;
  }
}

async function _stopServer(): Promise<void> {
  stopHealthCheck();
  unpublishMdns();

  const config = loadConfig();

  // Stop llama-server (only if we started it — external instances are left alone)
  try {
    await stopLlama(config?.dataDir);
  } catch {
    // Best effort
  }
  const pidFile = config ? pidPath(config.dataDir) : null;

  if (serverProcess) {
    serverProcess.kill("SIGTERM");

    // Wait for graceful shutdown (up to 10s)
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (serverProcess) {
          serverProcess.kill("SIGKILL");
        }
        resolve();
      }, 10_000);

      serverProcess!.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    serverProcess = null;
  } else if (pidFile && fs.existsSync(pidFile)) {
    // Server was started by CLI or previous session — kill by PID
    const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    if (!isNaN(pid) && isProcessRunning(pid)) {
      process.kill(pid, "SIGTERM");

      // Wait for exit
      const start = Date.now();
      while (Date.now() - start < 10_000) {
        if (!isProcessRunning(pid)) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
  }

  setStatus("stopped");
}

/** Restart the server */
export async function restartServer(): Promise<void> {
  if (operationInProgress) return;
  operationInProgress = true;
  try {
    await _stopServer();
    await _startServer();
  } finally {
    operationInProgress = false;
  }
}

/** Poll the health endpoint to determine when server is ready */
function startHealthCheck(port: number) {
  stopHealthCheck();

  const config = loadConfig();
  const proto = config && hasHttps(config) ? "https" : "http";
  const startTime = Date.now();
  const startupTimeoutMs = 60_000; // Give server 60s to start before marking as error

  healthCheckInterval = setInterval(async () => {
    try {
      // For self-signed certs, temporarily allow unauthorized for localhost health check
      const prevTls = process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
      if (proto === "https") process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
      const resp = await fetch(`${proto}://localhost:${port}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (proto === "https") {
        if (prevTls !== undefined) process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = prevTls;
        else delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
      }
      if (resp.ok) {
        setStatus("running");
      }
    } catch {
      if (currentStatus === "running") {
        // Server was running but is now unreachable
        setStatus("error", "Server became unreachable.");
      } else if (currentStatus === "starting" && Date.now() - startTime > startupTimeoutMs) {
        // Server never started within timeout
        const config2 = loadConfig();
        const logFile = config2 ? logPath(config2.dataDir) : null;
        const errMsg = logFile ? getLastError(logFile) : null;
        setStatus("error", errMsg ?? "Server failed to start. Check logs for details.");
        stopHealthCheck();
      }
    }
  }, 2000);
}

function stopHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

/** Read the last N lines of the log file */
export function readLogs(lines = 100): string {
  const config = loadConfig();
  if (!config) return "No configuration found.";

  const logFile = logPath(config.dataDir);
  if (!fs.existsSync(logFile)) return "No log file found.";

  const content = fs.readFileSync(logFile, "utf8");
  const allLines = content.split("\n");
  return allLines.slice(-lines).join("\n");
}

export interface DiscoveredInstance {
  name: string;
  host: string;
  port: number;
  addresses: string[];
  /** Endpoint URL constructed from discovery data */
  endpoint: string;
  txt: Record<string, string>;
}

/** Discover Edgebric instances on the local network via mDNS */
export function discoverInstances(timeoutMs = 5000): Promise<DiscoveredInstance[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredInstance>();
    let browser: InstanceType<typeof Bonjour> | null = null;

    try {
      browser = new Bonjour(undefined, (err: Error) => {
        console.warn("mDNS discovery error (non-fatal):", err.message);
      });
    } catch (err) {
      console.warn("mDNS discovery init failed:", err);
      resolve([]);
      return;
    }

    const svc = browser.find({ type: "_edgebric._tcp" }, (service) => {
      const protocol = (service.txt as Record<string, string>)?.protocol ?? "https";
      found.set(service.name, {
        name: service.name,
        host: service.host,
        port: service.port,
        addresses: service.addresses ?? [],
        endpoint: `${protocol}://${service.host}:${service.port}`,
        txt: (service.txt as Record<string, string>) ?? {},
      });
    });

    setTimeout(() => {
      try {
        svc.stop();
        browser!.destroy();
      } catch { /* cleanup errors are non-fatal */ }
      resolve(Array.from(found.values()));
    }, timeoutMs);
  });
}

/** Re-publish mDNS after network changes (sleep/wake, interface changes). */
export function refreshMdns() {
  const config = loadConfig();
  if (!config || config.mode === "solo") return;
  const hostname = config.hostname ?? "edgebric.local";
  publishMdns(hostname, config.port);
}

/** Clean up on app quit */
export async function cleanup() {
  stopHealthCheck();
  unpublishMdns();
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    // Give it a moment to shut down
    await new Promise((r) => setTimeout(r, 2000));
    if (serverProcess) {
      serverProcess.kill("SIGKILL");
    }
  }
  // Stop llama-server on app quit
  try {
    await stopLlama();
  } catch {
    // Best effort
  }
}
