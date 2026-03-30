import { app, ipcMain, BrowserWindow, dialog } from "electron";
import { readLogs, getStatus, getErrorMsg, getPort, getHostname, getUptime, startServer, stopServer, onStatusChange, discoverInstances } from "./server.js";
import { loadConfig, saveConfig, isFirstRun, DEFAULT_DATA_DIR, envPath, type EdgebricConfig } from "./config.js";
import { generateCerts, trustCA, certsExist, certPaths } from "./certs.js";
import { openLogWindow } from "./index.js";
import {
  isOllamaInstalled,
  isOllamaRunning,
  getInstalledVersion,
  downloadOllama,
  startOllama,
  stopOllama,
} from "./ollama.js";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { execSync, execFile } from "child_process";

const OLLAMA_BASE = "http://127.0.0.1:11434";
const EMBEDDING_TAG = "nomic-embed-text";

export function registerIpcHandlers() {
  // Log viewer
  ipcMain.handle("read-logs", (_event, lines?: number) => {
    return readLogs(lines);
  });

  // Server status
  ipcMain.handle("get-status", () => {
    return { status: getStatus(), port: getPort(), hostname: getHostname(), errorMsg: getErrorMsg() };
  });

  // Health check (mirrors /api/health for the desktop home view)
  ipcMain.handle("get-health", async () => {
    if (getStatus() !== "running") return null;
    const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

    // Database: if server is running, DB initialized successfully
    checks.database = { status: "ok" };

    // Inference (direct Ollama ping)
    try {
      const t = Date.now();
      const resp = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
      checks.inference = { status: resp.ok ? "ok" : "degraded", latencyMs: Date.now() - t };
    } catch (err) {
      checks.inference = { status: "unavailable", error: err instanceof Error ? err.message : "Connection failed" };
    }

    // Vector store: assume ok if server is running (sqlite-vec initializes at startup)
    checks.vectorStore = { status: "ok" };

    // Disk
    try {
      const config = loadConfig();
      const dir = config?.dataDir ?? os.homedir();
      const output = execSync(`df -k "${dir}" 2>/dev/null`, { encoding: "utf8" });
      const lines = output.trim().split("\n");
      if (lines.length >= 2) {
        const parts = lines[1]!.split(/\s+/);
        const usedPercent = parseInt(parts[4]!.replace("%", ""), 10);
        checks.disk = { status: usedPercent >= 95 ? "critical" : usedPercent >= 85 ? "warning" : "ok" };
      }
    } catch {
      checks.disk = { status: "ok" };
    }

    return { uptime: getUptime(), checks };
  });

  // Server control
  ipcMain.handle("start-server", async () => {
    try {
      await startServer();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("stop-server", async () => {
    try {
      await stopServer();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Push status changes to all renderer windows
  onStatusChange((status, errorMsg) => {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send("server-status-changed", status, errorMsg); } catch { /* frame may be disposed */ }
    }
  });

  // mDNS discovery — find Edgebric instances on the local network
  ipcMain.handle("discover-instances", async () => {
    return discoverInstances();
  });

  // Config
  ipcMain.handle("get-config", () => {
    return loadConfig();
  });

  ipcMain.handle("is-first-run", () => {
    return isFirstRun();
  });

  ipcMain.handle("get-default-data-dir", () => {
    return DEFAULT_DATA_DIR;
  });

  // Setup wizard — save config
  ipcMain.handle("save-setup", (_event, setupData: {
    mode: "solo" | "admin" | "member";
    dataDir: string;
    port: number;
    oidcProvider?: string;
    oidcIssuer?: string;
    oidcClientId?: string;
    oidcClientSecret?: string;
    adminEmails?: string[];
    chatBaseUrl?: string;
    chatModel?: string;
    orgServerUrl?: string;
  }) => {
    const config: EdgebricConfig = {
      mode: setupData.mode,
      dataDir: setupData.dataDir,
      port: setupData.port,
      ...(setupData.oidcProvider && { oidcProvider: setupData.oidcProvider }),
      ...(setupData.oidcIssuer && { oidcIssuer: setupData.oidcIssuer }),
      ...(setupData.oidcClientId && { oidcClientId: setupData.oidcClientId }),
      ...(setupData.oidcClientSecret && { oidcClientSecret: setupData.oidcClientSecret }),
      ...(setupData.adminEmails && { adminEmails: setupData.adminEmails }),
      ...(setupData.chatBaseUrl && { chatBaseUrl: setupData.chatBaseUrl }),
      ...(setupData.chatModel && { chatModel: setupData.chatModel }),
      ...(setupData.orgServerUrl && { orgServerUrl: setupData.orgServerUrl }),
    };

    const isSolo = setupData.mode === "solo" || setupData.mode === "member";

    // Validate data directory is within user's home (prevent path traversal)
    const resolvedDataDir = path.resolve(config.dataDir);
    const homeDir = path.resolve(os.homedir());
    if (!resolvedDataDir.startsWith(homeDir)) {
      return { success: false, error: "Data directory must be within your home folder" };
    }
    config.dataDir = resolvedDataDir;

    // Ensure data directory exists
    fs.mkdirSync(config.dataDir, { recursive: true });

    saveConfig(config);

    // Solo mode: no TLS, no mDNS — localhost only
    const hostname = config.hostname ?? "edgebric.local";
    let protocol = "http";
    let certs = certPaths(config.dataDir);

    if (!isSolo) {
      // Generate HTTPS certificates if they don't exist yet
      if (!certsExist(config.dataDir)) {
        generateCerts(config.dataDir, hostname, config.port);
        trustCA(config.dataDir);
      }
      certs = certPaths(config.dataDir);
      protocol = fs.existsSync(certs.serverCert) ? "https" : "http";
    }

    // Write .env file for the API server
    const sessionSecret = crypto.randomBytes(64).toString("hex");
    const envLines = [
      `# Generated by Edgebric Desktop — ${new Date().toISOString()}`,
      `DATA_DIR=${config.dataDir}`,
      `PORT=${config.port}`,
      `SESSION_SECRET=${sessionSecret}`,
      `AUTH_MODE=${isSolo ? "none" : "oidc"}`,
      `LISTEN_HOST=${isSolo ? "127.0.0.1" : "0.0.0.0"}`,
    ];

    if (!isSolo) {
      envLines.push(
        `OIDC_PROVIDER=${config.oidcProvider ?? "generic"}`,
        `OIDC_ISSUER=${config.oidcIssuer ?? ""}`,
        `OIDC_CLIENT_ID=${config.oidcClientId ?? ""}`,
        `OIDC_CLIENT_SECRET=${config.oidcClientSecret ?? ""}`,
        `OIDC_REDIRECT_URI=${protocol}://localhost:${config.port}/api/auth/callback`,
        `ADMIN_EMAILS=${(config.adminEmails ?? []).join(",")}`,
        `FRONTEND_URL=${protocol}://${hostname}:${config.port}`,
        `TLS_CERT=${certs.serverCert}`,
        `TLS_KEY=${certs.serverKey}`,
      );
    } else {
      envLines.push(
        `FRONTEND_URL=http://localhost:${config.port}`,
      );
    }

    if (config.chatBaseUrl) envLines.push(`CHAT_BASE_URL=${config.chatBaseUrl}`);
    if (config.chatModel) envLines.push(`CHAT_MODEL=${config.chatModel}`);
    if (config.orgServerUrl) envLines.push(`ORG_SERVER_URL=${config.orgServerUrl}`);

    const envContent = [...envLines,
      "",
    ].join("\n");

    const envFile = envPath(config.dataDir);
    fs.writeFileSync(envFile, envContent, "utf8");

    return { success: true };
  });

  // ─── Settings ──────────────────────────────────────────────────────────────

  /** Save hostname/port settings from the dashboard. Updates config + .env. */
  ipcMain.handle("save-settings", (_event, settings: { hostname: string; port: number }) => {
    const config = loadConfig();
    if (!config) return { success: false, error: "No config found" };

    const newHostname = settings.hostname?.trim();
    const newPort = settings.port;
    if (!newHostname) return { success: false, error: "Hostname cannot be empty" };
    if (isNaN(newPort) || newPort < 1 || newPort > 65535) return { success: false, error: "Port must be between 1 and 65535" };

    config.hostname = newHostname;
    config.port = newPort;
    saveConfig(config);

    // Update .env with new hostname/port
    const proto = certsExist(config.dataDir) ? "https" : "http";
    const envFile = envPath(config.dataDir);
    if (fs.existsSync(envFile)) {
      let env = fs.readFileSync(envFile, "utf8");
      env = env.replace(/^OIDC_REDIRECT_URI=.*$/m, `OIDC_REDIRECT_URI=${proto}://localhost:${newPort}/api/auth/callback`);
      env = env.replace(/^FRONTEND_URL=.*$/m, `FRONTEND_URL=${proto}://${newHostname}:${newPort}`);
      env = env.replace(/^PORT=.*$/m, `PORT=${newPort}`);
      fs.writeFileSync(envFile, env, "utf8");
    }

    return { success: true };
  });

  // ─── Launch at Login ─────────────────────────────────────────────────────────

  ipcMain.handle("get-launch-at-login", () => {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
  });

  ipcMain.handle("set-launch-at-login", (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
    const config = loadConfig();
    if (config) {
      config.launchAtLogin = enabled;
      saveConfig(config);
    }
    return { success: true };
  });

  // ─── Log Window ──────────────────────────────────────────────────────────────

  ipcMain.handle("open-log-window", () => {
    openLogWindow();
  });

  // ─── Ollama ─────────────────────────────────────────────────────────────────

  ipcMain.handle("ollama-status", async () => {
    const config = loadConfig();
    const dataDir = config?.dataDir;
    return {
      installed: isOllamaInstalled(dataDir),
      running: await isOllamaRunning(),
      version: getInstalledVersion(dataDir),
    };
  });

  ipcMain.handle("install-ollama", async (_event, version?: string) => {
    const config = loadConfig();
    try {
      await downloadOllama(version, config?.dataDir, (percent) => {
        for (const win of BrowserWindow.getAllWindows()) {
          try { win.webContents.send("ollama-download-progress", percent); } catch { /* frame disposed */ }
        }
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("start-ollama", async () => {
    const config = loadConfig();
    try {
      const result = await startOllama(config?.dataDir);
      return { success: true, external: result.external };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("stop-ollama", async () => {
    const config = loadConfig();
    try {
      await stopOllama(config?.dataDir);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Model Management (talks directly to Ollama, bypasses API server auth) ──

  ipcMain.handle("models-list", async () => {
    try {
      const running = await isOllamaRunning();
      if (!running) {
        return { models: [], catalog: [], activeModel: "", system: getSystemRes() };
      }

      // Fetch installed models
      const tagsResp = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
      const tagsData = (tagsResp.ok ? await tagsResp.json() : { models: [] }) as {
        models: Array<{ name: string; size: number; digest: string; modified_at: string; details: { family: string; parameter_size: string } }>;
      };

      // Fetch running models
      const psResp = await fetch(`${OLLAMA_BASE}/api/ps`, { signal: AbortSignal.timeout(5000) });
      const psData = (psResp.ok ? await psResp.json() : { models: [] }) as {
        models: Array<{ name: string; size_vram: number }>;
      };
      const runningMap = new Map<string, number>();
      for (const m of psData.models) {
        runningMap.set(normTag(m.name), m.size_vram);
      }

      const CATALOG = getCatalog();
      const catalogMap = new Map(CATALOG.map((c) => [c.tag, c]));

      const models = tagsData.models.map((m) => {
        const tag = normTag(m.name);
        const cat = catalogMap.get(tag);
        const vram = runningMap.get(tag);
        return {
          tag,
          name: cat?.name ?? m.details?.family ?? tag,
          sizeBytes: m.size,
          digest: m.digest,
          modifiedAt: m.modified_at,
          status: vram !== undefined ? "loaded" : "installed",
          ramUsageBytes: vram,
          catalogEntry: cat ?? undefined,
        };
      });

      const installedTags = new Set(models.map((m) => m.tag));
      const catalog = CATALOG.filter((c) => !c.hidden && !installedTags.has(c.tag));

      // Read active model from config or env
      const config = loadConfig();
      let activeModel = config?.chatModel ?? "";
      if (!activeModel) {
        try {
          const envContent = fs.readFileSync(envPath(config?.dataDir ?? ""), "utf8");
          const match = envContent.match(/^CHAT_MODEL=(.+)$/m);
          if (match) activeModel = match[1]!.trim();
        } catch { /* no env */ }
      }

      const mode = config?.mode ?? "solo";
      const storage = getStorageBreakdown(config?.dataDir);
      return { models, catalog, activeModel, system: getSystemRes(), mode, storage };
    } catch (err) {
      const config = loadConfig();
      return { models: [], catalog: getCatalog().filter((c) => !c.hidden), activeModel: "", system: getSystemRes(), mode: config?.mode ?? "solo", storage: getStorageBreakdown(config?.dataDir), error: String(err) };
    }
  });

  ipcMain.handle("models-load", async (_event, tag: string) => {
    try {
      const resp = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: tag, keep_alive: "30m" }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!resp.ok) return { success: false, error: `Failed: HTTP ${resp.status}` };
      await resp.text(); // consume

      // Auto-set as active model when loaded
      const config = loadConfig();
      if (config) {
        config.chatModel = tag;
        saveConfig(config);
        try {
          const envFile = envPath(config.dataDir);
          if (fs.existsSync(envFile)) {
            let env = fs.readFileSync(envFile, "utf8");
            if (/^CHAT_MODEL=/m.test(env)) {
              env = env.replace(/^CHAT_MODEL=.*$/m, `CHAT_MODEL=${tag}`);
            } else {
              env += `\nCHAT_MODEL=${tag}\n`;
            }
            if (/^CHAT_BASE_URL=/m.test(env)) {
              env = env.replace(/^CHAT_BASE_URL=.*$/m, `CHAT_BASE_URL=${OLLAMA_BASE}/v1`);
            } else {
              env += `CHAT_BASE_URL=${OLLAMA_BASE}/v1\n`;
            }
            fs.writeFileSync(envFile, env, "utf8");
          }
        } catch { /* best effort */ }
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("models-unload", async (_event, tag: string) => {
    try {
      const resp = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: tag, keep_alive: "0" }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) return { success: false, error: `Failed: HTTP ${resp.status}` };
      await resp.text();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("models-delete", async (_event, tag: string) => {
    if (tag === EMBEDDING_TAG) return { success: false, error: "Cannot delete the embedding model" };
    try {
      const resp = await fetch(`${OLLAMA_BASE}/api/delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tag }),
      });
      if (!resp.ok) return { success: false, error: `Failed: HTTP ${resp.status}` };
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("models-pull", async (event, tag: string) => {
    try {
      const resp = await fetch(`${OLLAMA_BASE}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tag, stream: true }),
      });
      if (!resp.ok) return { success: false, error: `Failed: HTTP ${resp.status}` };
      if (!resp.body) return { success: false, error: "No response body" };

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line) as { status: string; completed?: number; total?: number };
            const percent = ev.total && ev.total > 0 ? Math.round((ev.completed ?? 0) / ev.total * 100) : undefined;
            for (const win of BrowserWindow.getAllWindows()) {
              try { win.webContents.send("model-pull-progress", { tag, status: ev.status, percent: percent ?? 0 }); } catch { /* frame disposed */ }
            }
          } catch { /* skip */ }
        }
      }

      // Send completion
      for (const win of BrowserWindow.getAllWindows()) {
        try { win.webContents.send("model-pull-progress", { tag, status: "done", percent: 100 }); } catch { /* frame disposed */ }
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("models-set-active", async (_event, tag: string) => {
    // Update .env CHAT_MODEL and config
    const config = loadConfig();
    if (config) {
      config.chatModel = tag;
      saveConfig(config);
      // Also update .env so the running API server picks it up on restart
      try {
        const envFile = envPath(config.dataDir);
        if (fs.existsSync(envFile)) {
          let env = fs.readFileSync(envFile, "utf8");
          if (/^CHAT_MODEL=/m.test(env)) {
            env = env.replace(/^CHAT_MODEL=.*$/m, `CHAT_MODEL=${tag}`);
          } else {
            env += `\nCHAT_MODEL=${tag}\n`;
          }
          if (/^CHAT_BASE_URL=/m.test(env)) {
            env = env.replace(/^CHAT_BASE_URL=.*$/m, `CHAT_BASE_URL=${OLLAMA_BASE}/v1`);
          } else {
            env += `CHAT_BASE_URL=${OLLAMA_BASE}/v1\n`;
          }
          fs.writeFileSync(envFile, env, "utf8");
        }
      } catch { /* best effort */ }
    }
    return { success: true };
  });

  // ─── GGUF Import ──────────────────────────────────────────────────────────

  /** Open file picker for GGUF files. Returns the selected path or null. */
  ipcMain.handle("models-pick-gguf", async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const dialogOptions = {
      title: "Select a GGUF model file",
      filters: [{ name: "GGUF Models", extensions: ["gguf"] }],
      properties: ["openFile"] as Array<"openFile">,
    };
    const result = focusedWindow
      ? await dialog.showOpenDialog(focusedWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) return { path: null };
    return { path: result.filePaths[0] };
  });

  /** Import a GGUF file into Ollama via `ollama create`. */
  ipcMain.handle("models-import-gguf", async (_event, ggufPath: string, modelName: string) => {
    if (!ggufPath || !modelName) return { success: false, error: "Path and model name are required" };
    if (!fs.existsSync(ggufPath)) return { success: false, error: "File not found" };
    if (!ggufPath.endsWith(".gguf")) return { success: false, error: "File must be a .gguf file" };

    // Sanitize model name: lowercase, alphanumeric + hyphens only
    const sanitized = modelName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!sanitized) return { success: false, error: "Invalid model name" };

    // Create a temporary Modelfile
    const tmpDir = os.tmpdir();
    const modelfilePath = path.join(tmpDir, `edgebric-modelfile-${Date.now()}`);
    fs.writeFileSync(modelfilePath, `FROM "${ggufPath}"\n`, "utf8");

    try {
      // Find ollama binary
      let ollamaBin = "ollama";
      const config = loadConfig();
      if (config?.dataDir) {
        const localBin = path.join(config.dataDir, ".ollama", "ollama");
        if (fs.existsSync(localBin)) ollamaBin = localBin;
      }

      // Run `ollama create <name> -f <Modelfile>`
      return await new Promise<{ success: boolean; error?: string }>((resolve) => {
        const child = execFile(ollamaBin, ["create", sanitized, "-f", modelfilePath], { timeout: 300_000 }, (err, _stdout, stderr) => {
          // Clean up Modelfile
          try { fs.unlinkSync(modelfilePath); } catch { /* ignore */ }

          if (err) {
            resolve({ success: false, error: stderr?.trim() || err.message });
          } else {
            // Send progress update
            for (const win of BrowserWindow.getAllWindows()) {
              try { win.webContents.send("model-pull-progress", { tag: sanitized, status: "done", percent: 100 }); } catch { /* frame disposed */ }
            }
            resolve({ success: true });
          }
        });

        // Stream stdout for progress
        child.stdout?.on("data", (data: Buffer) => {
          const line = data.toString().trim();
          if (line) {
            for (const win of BrowserWindow.getAllWindows()) {
              try { win.webContents.send("model-pull-progress", { tag: sanitized, status: line, percent: 50 }); } catch { /* frame disposed */ }
            }
          }
        });
      });
    } catch (err) {
      try { fs.unlinkSync(modelfilePath); } catch { /* ignore */ }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Model Search (Ollama registry) ────────────────────────────────────────

  /** Search the Ollama model registry. Fetched from main process to avoid CORS. */
  ipcMain.handle("models-search", async (_event, query: string) => {
    if (!query || query.trim().length < 2) return { models: [] };
    try {
      const resp = await fetch("https://ollama.com/api/tags", { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) return { models: [], error: `HTTP ${resp.status}` };
      const data = await resp.json() as { models: Array<{ name: string; tags?: string[]; description?: string }> };
      const q = query.trim().toLowerCase();
      const filtered = (data.models ?? [])
        .filter((m) => m.name.toLowerCase().includes(q))
        .slice(0, 30)
        .map((m) => ({
          name: m.name,
          description: m.description ?? "",
        }));
      return { models: filtered };
    } catch (err) {
      return { models: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── License Validation ────────────────────────────────────────────────────

  /**
   * Validate a license key. Returns { valid: true } if the key is accepted.
   * TODO: Replace placeholder with LemonSqueezy/Paddle API call before distribution.
   */
  ipcMain.handle("validate-license", async (_event, key: string) => {
    const trimmed = key.trim();
    if (!trimmed) return { valid: false, error: "License key is required" };

    // Placeholder: accept any non-empty key that looks like a license (8+ chars)
    // In production, this will POST to LemonSqueezy API to validate
    if (trimmed.length < 8) {
      return { valid: false, error: "Invalid license key format" };
    }

    // Store the key in config
    const config = loadConfig();
    if (config) {
      config.licenseKey = trimmed;
      saveConfig(config);
    }

    return { valid: true };
  });

  // ─── Instance Management ──────────────────────────────────────────────────

  /** Full wipe: stop server, delete data dir contents, remove config. Triggers re-setup on next launch. */
  ipcMain.handle("instance-wipe", async () => {
    const config = loadConfig();
    if (!config) return { success: false, error: "No config found" };
    try {
      // Stop server + Ollama first
      const { stopServer } = await import("./server.js");
      await stopServer();
      try { await stopOllama(config.dataDir); } catch { /* may not be running */ }

      // Remove .env and config file, but preserve the data dir itself
      const envFile = envPath(config.dataDir);
      const configFile = path.join(config.dataDir, ".edgebric.json");
      if (fs.existsSync(envFile)) fs.unlinkSync(envFile);
      if (fs.existsSync(configFile)) fs.unlinkSync(configFile);

      // Remove database, sessions, uploads
      const toDelete = ["edgebric.db", "edgebric.db-wal", "edgebric.db-shm", "sessions", "uploads", "edgebric.log"];
      for (const name of toDelete) {
        const p = path.join(config.dataDir, name);
        if (fs.existsSync(p)) {
          fs.rmSync(p, { recursive: true, force: true });
        }
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /** Auth reset: stop server, clear OIDC config + sessions, regenerate .env with mode=solo. Keeps org data (DB, uploads). */
  ipcMain.handle("instance-reset-auth", async () => {
    const config = loadConfig();
    if (!config) return { success: false, error: "No config found" };
    try {
      const { stopServer } = await import("./server.js");
      await stopServer();

      // Clear sessions
      const sessionsDir = path.join(config.dataDir, "sessions");
      if (fs.existsSync(sessionsDir)) fs.rmSync(sessionsDir, { recursive: true, force: true });

      // Update config to solo mode, clear OIDC fields
      const newConfig = {
        ...config,
        mode: "solo" as const,
        oidcIssuer: undefined,
        oidcClientId: undefined,
        oidcClientSecret: undefined,
        adminEmails: undefined,
      };
      saveConfig(newConfig);

      // Regenerate .env for solo mode
      const sessionSecret = crypto.randomBytes(64).toString("hex");
      const envContent = [
        `# Generated by Edgebric Desktop — ${new Date().toISOString()}`,
        `DATA_DIR=${config.dataDir}`,
        `PORT=${config.port}`,
        `SESSION_SECRET=${sessionSecret}`,
        `AUTH_MODE=none`,
        `LISTEN_HOST=127.0.0.1`,
        `FRONTEND_URL=http://localhost:${config.port}`,
        "",
      ].join("\n");
      fs.writeFileSync(envPath(config.dataDir), envContent, "utf8");

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /** Reconfigure auth: stop server, update mode to admin, regenerate .env with new OIDC creds. Keeps all data. */
  ipcMain.handle("instance-reconfigure-auth", async (_event, authData: {
    oidcProvider?: string;
    oidcIssuer: string;
    oidcClientId: string;
    oidcClientSecret: string;
    adminEmails: string[];
  }) => {
    const config = loadConfig();
    if (!config) return { success: false, error: "No config found" };
    try {
      const { stopServer } = await import("./server.js");
      await stopServer();

      // Clear sessions (old auth tokens are invalid)
      const sessionsDir = path.join(config.dataDir, "sessions");
      if (fs.existsSync(sessionsDir)) fs.rmSync(sessionsDir, { recursive: true, force: true });

      // Update config
      const newConfig = {
        ...config,
        mode: "admin" as const,
        oidcProvider: authData.oidcProvider,
        oidcIssuer: authData.oidcIssuer,
        oidcClientId: authData.oidcClientId,
        oidcClientSecret: authData.oidcClientSecret,
        adminEmails: authData.adminEmails,
      };
      saveConfig(newConfig);

      // Generate certs if not present
      const hostname = config.hostname ?? "edgebric.local";
      let protocol = "http";
      const { certsExist: hasCerts, generateCerts, trustCA, certPaths: getCertPaths } = await import("./certs.js");
      if (!hasCerts(config.dataDir)) {
        generateCerts(config.dataDir, hostname, config.port);
        trustCA(config.dataDir);
      }
      const certs = getCertPaths(config.dataDir);
      protocol = fs.existsSync(certs.serverCert) ? "https" : "http";

      // Regenerate .env
      const sessionSecret = crypto.randomBytes(64).toString("hex");
      const envContent = [
        `# Generated by Edgebric Desktop — ${new Date().toISOString()}`,
        `DATA_DIR=${config.dataDir}`,
        `PORT=${config.port}`,
        `SESSION_SECRET=${sessionSecret}`,
        `AUTH_MODE=oidc`,
        `LISTEN_HOST=0.0.0.0`,
        ...(authData.oidcProvider ? [`OIDC_PROVIDER=${authData.oidcProvider}`] : []),
        `OIDC_ISSUER=${authData.oidcIssuer}`,
        `OIDC_CLIENT_ID=${authData.oidcClientId}`,
        `OIDC_CLIENT_SECRET=${authData.oidcClientSecret}`,
        `OIDC_REDIRECT_URI=${protocol}://localhost:${config.port}/api/auth/callback`,
        `ADMIN_EMAILS=${authData.adminEmails.join(",")}`,
        `FRONTEND_URL=${protocol}://${hostname}:${config.port}`,
        `TLS_CERT=${certs.serverCert}`,
        `TLS_KEY=${certs.serverKey}`,
        ...(config.chatBaseUrl ? [`CHAT_BASE_URL=${config.chatBaseUrl}`] : []),
        ...(config.chatModel ? [`CHAT_MODEL=${config.chatModel}`] : []),
        "",
      ].join("\n");
      fs.writeFileSync(envPath(config.dataDir), envContent, "utf8");

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normTag(name: string): string {
  return name.replace(/:latest$/, "");
}

function getSystemRes() {
  const ramTotalBytes = os.totalmem();
  let ramAvailableBytes = os.freemem();

  // macOS: os.freemem() only reports "free" pages, not "free + inactive + purgeable"
  // which is what's actually available. Use vm_stat for realistic numbers.
  if (process.platform === "darwin") {
    try {
      const vmstat = execSync("vm_stat 2>/dev/null", { encoding: "utf8" });
      const pageSize = parseInt(vmstat.match(/page size of (\d+)/)?.[1] ?? "16384", 10);
      const free = parseInt(vmstat.match(/Pages free:\s+(\d+)/)?.[1] ?? "0", 10);
      const inactive = parseInt(vmstat.match(/Pages inactive:\s+(\d+)/)?.[1] ?? "0", 10);
      const purgeable = parseInt(vmstat.match(/Pages purgeable:\s+(\d+)/)?.[1] ?? "0", 10);
      // "Available" = free + inactive + purgeable (what macOS can reclaim without swapping)
      ramAvailableBytes = (free + inactive + purgeable) * pageSize;
    } catch { /* fall back to os.freemem() */ }
  }

  // Measure actual Edgebric process memory (Electron main + renderer + API server child)
  let edgebricRamBytes = 0;
  // Electron main process RSS
  edgebricRamBytes += process.memoryUsage().rss;
  // API server child process — read from PID file
  try {
    const config = loadConfig();
    const pidFile = path.join(config?.dataDir ?? "", ".edgebric.pid");
    if (fs.existsSync(pidFile)) {
      const pid = fs.readFileSync(pidFile, "utf8").trim();
      if (pid) {
        // ps -o rss= returns RSS in KB
        const rssKB = parseInt(execSync(`ps -o rss= -p ${pid} 2>/dev/null`, { encoding: "utf8" }).trim(), 10);
        if (!isNaN(rssKB)) edgebricRamBytes += rssKB * 1024;
      }
    }
  } catch { /* process may not exist */ }

  let diskFreeBytes = 0;
  let diskTotalBytes = 0;
  try {
    const config = loadConfig();
    const dir = config?.dataDir ?? os.homedir();
    const output = execSync(`df -k "${dir}" 2>/dev/null`, { encoding: "utf8" });
    const lines = output.trim().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1]!.split(/\s+/);
      diskTotalBytes = parseInt(parts[1]!, 10) * 1024;
      diskFreeBytes = parseInt(parts[3]!, 10) * 1024;
    }
  } catch { /* ignore */ }
  return { ramTotalBytes, ramAvailableBytes, diskFreeBytes, diskTotalBytes, edgebricRamBytes };
}

function getStorageBreakdown(dataDir?: string) {
  const dir = dataDir ?? os.homedir() + "/Edgebric";
  let dbBytes = 0;
  let uploadsBytes = 0;
  let ollamaModelsBytes = 0;
  let vaultBytes = 0;

  // Database size
  try {
    for (const f of ["edgebric.db", "edgebric.db-wal", "edgebric.db-shm"]) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) dbBytes += fs.statSync(p).size;
    }
  } catch { /* ignore */ }

  // Uploads directory
  try {
    const uploadsDir = path.join(dir, "uploads");
    if (fs.existsSync(uploadsDir)) {
      uploadsBytes = dirSize(uploadsDir);
    }
  } catch { /* ignore */ }

  // Ollama models directory
  try {
    const modelsDir = path.join(dir, ".ollama", "models");
    if (fs.existsSync(modelsDir)) {
      ollamaModelsBytes = dirSize(modelsDir);
    }
  } catch { /* ignore */ }

  // Vault sources (encrypted files in uploads with vault markers — approximate)
  // For now vault is part of uploads total; we'd need DB queries to distinguish.
  // We'll report uploads as "Documents" and vault separately if we can detect it.

  return { dbBytes, uploadsBytes, ollamaModelsBytes, vaultBytes };
}

/** Recursively compute directory size in bytes. */
function dirSize(dirPath: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const p = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += dirSize(p);
      } else if (entry.isFile()) {
        total += fs.statSync(p).size;
      }
    }
  } catch { /* ignore permission errors */ }
  return total;
}

interface CatalogEntry {
  tag: string; name: string; family: string; description: string;
  paramCount: string; downloadSizeGB: number; ramUsageGB: number;
  origin: string; tier: string; minRAMGB: number; hidden?: boolean;
}

function getCatalog(): CatalogEntry[] {
  return [
    // Recommended
    { tag: "qwen3:4b", name: "Qwen 3 4B", family: "Qwen", description: "Best overall for most hardware. Fast, accurate, 256K context.", paramCount: "4B", downloadSizeGB: 2.5, ramUsageGB: 5.5, origin: "Alibaba", tier: "recommended", minRAMGB: 8 },
    { tag: "qwen3:8b", name: "Qwen 3 8B", family: "Qwen", description: "Stronger reasoning and analysis. Best for 16GB machines.", paramCount: "8B", downloadSizeGB: 5.2, ramUsageGB: 9, origin: "Alibaba", tier: "recommended", minRAMGB: 16 },
    { tag: "qwen3:14b", name: "Qwen 3 14B", family: "Qwen", description: "Highest quality answers. Needs 32GB RAM.", paramCount: "14B", downloadSizeGB: 9.3, ramUsageGB: 15, origin: "Alibaba", tier: "recommended", minRAMGB: 32 },
    // Supported
    { tag: "phi4-mini", name: "Phi-4 Mini", family: "Microsoft", description: "Compact, efficient, 128K context. Good for constrained setups.", paramCount: "3.8B", downloadSizeGB: 2.5, ramUsageGB: 5, origin: "Microsoft", tier: "supported", minRAMGB: 8 },
    { tag: "gemma3:4b", name: "Gemma 3 4B", family: "Google", description: "Google's efficient model. Multimodal capable, 128K context.", paramCount: "4B", downloadSizeGB: 3.3, ramUsageGB: 6, origin: "Google", tier: "supported", minRAMGB: 8 },
    { tag: "gemma3:12b", name: "Gemma 3 12B", family: "Google", description: "Strong document analysis. Multimodal, 128K context.", paramCount: "12B", downloadSizeGB: 8.1, ramUsageGB: 13, origin: "Google", tier: "supported", minRAMGB: 16 },
    // Hidden infrastructure
    { tag: "nomic-embed-text", name: "Nomic Embed Text", family: "Nomic", description: "Text embedding model for semantic search.", paramCount: "137M", downloadSizeGB: 0.27, ramUsageGB: 0.3, origin: "Nomic", tier: "recommended", minRAMGB: 4, hidden: true },
  ];
}
