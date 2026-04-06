import { app, ipcMain, BrowserWindow, dialog } from "electron";
import { readLogs, getStatus, getErrorMsg, getPort, getHostname, getUptime, startServer, stopServer, onStatusChange, discoverInstances } from "./server.js";
import { loadConfig, saveConfig, isFirstRun, DEFAULT_DATA_DIR, envPath, type EdgebricConfig } from "./config.js";
import { generateCerts, trustCA, certsExist, certPaths } from "./certs.js";
import { openLogWindow } from "./index.js";
import {
  isLlamaInstalled,
  isLlamaRunning,
  getInstalledVersion,
  downloadLlama,
  startInstance,
  stopLlama,
  listLocalModels,
  deleteLocalModel,
  downloadModel,
  llamaModelsDir,
  isChatServerRunning,
  stopInstance,
  CHAT_BASE_URL,
} from "./llama-server.js";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { execSync, execFileSync } from "child_process";

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

    // Inference (direct llama-server ping)
    try {
      const t = Date.now();
      const resp = await fetch(`${CHAT_BASE_URL}/health`, { signal: AbortSignal.timeout(5000) });
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
      const output = execFileSync("df", ["-k", dir], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
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

  /** Sanitize a value for .env file — strip newlines and control chars to prevent injection. */
  function sanitizeEnvValue(value: string): string {
    return value.replace(/[\n\r\0]/g, "").trim();
  }

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
    // Secondary node mesh setup
    meshToken?: string;
    secondaryNodeName?: string;
    primaryEndpoint?: string;
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

    // Secondary nodes are network-facing (not solo) — they need HTTPS and mesh config
    const isSecondaryNode = !!(setupData.meshToken && setupData.primaryEndpoint);
    const isSolo = setupData.mode === "solo" || (setupData.mode === "member" && !isSecondaryNode);

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

    if (isSecondaryNode) {
      // Secondary nodes: network-facing with OIDC auth, but no local OIDC
      // credentials — auth is proxied to the primary via the mesh protocol.
      // OIDC_CLIENT_ID/SECRET are placeholders so the config parser doesn't
      // reject the file; the auth route redirects to primary before using them.
      envLines.push(
        `OIDC_PROVIDER=generic`,
        `OIDC_ISSUER=https://placeholder.local`,
        `OIDC_CLIENT_ID=secondary-node`,
        `OIDC_CLIENT_SECRET=secondary-node`,
        `OIDC_REDIRECT_URI=${protocol}://localhost:${config.port}/api/auth/callback`,
        `ADMIN_EMAILS=`,
        `FRONTEND_URL=${protocol}://${hostname}:${config.port}`,
        `TLS_CERT=${certs.serverCert}`,
        `TLS_KEY=${certs.serverKey}`,
      );
    } else if (!isSolo) {
      // Primary / admin node: full OIDC config
      envLines.push(
        `OIDC_PROVIDER=${sanitizeEnvValue(config.oidcProvider ?? "generic")}`,
        `OIDC_ISSUER=${sanitizeEnvValue(config.oidcIssuer ?? "")}`,
        `OIDC_CLIENT_ID=${sanitizeEnvValue(config.oidcClientId ?? "")}`,
        `OIDC_CLIENT_SECRET=${sanitizeEnvValue(config.oidcClientSecret ?? "")}`,
        `OIDC_REDIRECT_URI=${protocol}://localhost:${config.port}/api/auth/callback`,
        `ADMIN_EMAILS=${sanitizeEnvValue((config.adminEmails ?? []).join(","))}`,
        `FRONTEND_URL=${protocol}://${hostname}:${config.port}`,
        `TLS_CERT=${certs.serverCert}`,
        `TLS_KEY=${certs.serverKey}`,
      );
    } else {
      // Solo mode: localhost only, no TLS, no auth
      envLines.push(
        `FRONTEND_URL=http://localhost:${config.port}`,
      );
    }

    if (config.chatBaseUrl) envLines.push(`CHAT_BASE_URL=${sanitizeEnvValue(config.chatBaseUrl)}`);
    if (config.chatModel) envLines.push(`CHAT_MODEL=${sanitizeEnvValue(config.chatModel)}`);
    if (config.orgServerUrl) envLines.push(`ORG_SERVER_URL=${sanitizeEnvValue(config.orgServerUrl)}`);

    const envContent = [...envLines,
      "",
    ].join("\n");

    const envFile = envPath(config.dataDir);
    fs.writeFileSync(envFile, envContent, "utf8");

    // For secondary nodes: write mesh-setup.json so the API server
    // auto-initializes mesh config as secondary on first boot
    if (isSecondaryNode && setupData.meshToken && setupData.primaryEndpoint) {
      const meshSetup = {
        role: "secondary",
        nodeName: setupData.secondaryNodeName ?? "Secondary Node",
        meshToken: setupData.meshToken,
        primaryEndpoint: setupData.primaryEndpoint,
      };
      fs.writeFileSync(
        path.join(config.dataDir, "mesh-setup.json"),
        JSON.stringify(meshSetup, null, 2) + "\n",
        "utf8",
      );
    }

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

  // ─── AI Engine (llama-server) ────────────────────────────────────────────────

  ipcMain.handle("engine-status", async () => {
    const config = loadConfig();
    const dataDir = config?.dataDir;
    return {
      installed: isLlamaInstalled(dataDir),
      running: await isLlamaRunning(),
      version: getInstalledVersion(dataDir),
    };
  });

  ipcMain.handle("install-engine", async (_event, version?: string) => {
    const config = loadConfig();
    try {
      await downloadLlama(version ?? undefined, config?.dataDir, (percent) => {
        for (const win of BrowserWindow.getAllWindows()) {
          try { win.webContents.send("engine-download-progress", percent); } catch { /* frame disposed */ }
        }
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("start-engine", async () => {
    const config = loadConfig();
    const dataDir = config?.dataDir;
    try {
      // Start embedding server with the embedding model
      const modelsDir = llamaModelsDir(dataDir);
      const embeddingModel = path.join(modelsDir, "nomic-embed-text-v1.5.Q8_0.gguf");
      if (fs.existsSync(embeddingModel)) {
        await startInstance("embedding", embeddingModel, dataDir);
      }

      // Start chat server if a chat model is configured
      const chatModel = config?.chatModel;
      if (chatModel) {
        const CATALOG = getCatalog();
        const catEntry = CATALOG.find(c => c.tag === chatModel);
        const filename = catEntry?.ggufFilename ?? `${chatModel}.gguf`;
        const chatModelPath = path.join(modelsDir, filename);
        if (fs.existsSync(chatModelPath)) {
          await startInstance("chat", chatModelPath, dataDir);
        }
      }

      return { success: true, external: false };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("stop-engine", async () => {
    const config = loadConfig();
    try {
      await stopLlama(config?.dataDir);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Model Management (filesystem-based GGUF management) ────────────────────

  ipcMain.handle("models-list", async () => {
    try {
      const config = loadConfig();
      const dataDir = config?.dataDir;
      const localModels = listLocalModels(dataDir);
      const chatUp = await isChatServerRunning();

      const CATALOG = getCatalog();
      const catalogByFile = new Map(CATALOG.map((c) => [c.ggufFilename, c]));

      const models = localModels.map((m) => {
        const cat = catalogByFile.get(m.filename);
        const tag = cat?.tag ?? m.filename.replace(/\.gguf$/, "");
        // Model is "loaded" if the chat server is running and this is the active model
        const isActive = tag === (config?.chatModel ?? "");
        return {
          tag,
          filename: m.filename,
          name: cat?.name ?? m.filename.replace(/\.gguf$/, ""),
          sizeBytes: m.sizeBytes,
          modifiedAt: m.modifiedAt,
          status: (chatUp && isActive) ? "loaded" : "installed",
          ramUsageBytes: (chatUp && isActive) ? Math.round(m.sizeBytes * 1.3) : undefined,
          catalogEntry: cat ?? undefined,
        };
      });

      const installedTags = new Set(models.map((m) => m.tag));
      const catalog = CATALOG.filter((c) => !c.hidden && !installedTags.has(c.tag));

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
      const config = loadConfig();
      const dataDir = config?.dataDir;

      // Find the GGUF file for this model
      const CATALOG = getCatalog();
      const catEntry = CATALOG.find(c => c.tag === tag);
      const filename = catEntry?.ggufFilename ?? `${tag}.gguf`;
      const modelPath = path.join(llamaModelsDir(dataDir), filename);

      if (!fs.existsSync(modelPath)) {
        return { success: false, error: `Model file not found: ${filename}` };
      }

      // Stop current chat server and start with the new model
      await stopInstance("chat", dataDir);
      await startInstance("chat", modelPath, dataDir);

      // Auto-set as active model when loaded
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
              env = env.replace(/^CHAT_BASE_URL=.*$/m, `CHAT_BASE_URL=${CHAT_BASE_URL}/v1`);
            } else {
              env += `CHAT_BASE_URL=${CHAT_BASE_URL}/v1\n`;
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

  ipcMain.handle("models-unload", async (_event, _tag: string) => {
    try {
      const config = loadConfig();
      // Stop the chat server to unload the model
      await stopInstance("chat", config?.dataDir);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("models-delete", async (_event, tag: string) => {
    if (tag === EMBEDDING_TAG) return { success: false, error: "Cannot delete the embedding model" };
    try {
      const config = loadConfig();
      const CATALOG = getCatalog();
      const catEntry = CATALOG.find(c => c.tag === tag);
      const filename = catEntry?.ggufFilename ?? `${tag}.gguf`;
      deleteLocalModel(filename, config?.dataDir);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Active download abort controllers
  const activePulls = new Map<string, AbortController>();

  ipcMain.handle("models-pull", async (_event, tag: string) => {
    try {
      const config = loadConfig();
      const CATALOG = getCatalog();
      const catEntry = CATALOG.find(c => c.tag === tag);

      if (!catEntry) {
        return { success: false, error: `Unknown model: ${tag}. Use GGUF import for custom models.` };
      }

      const controller = new AbortController();
      activePulls.set(tag, controller);

      await downloadModel(
        catEntry.downloadUrl,
        catEntry.ggufFilename,
        config?.dataDir,
        (percent) => {
          for (const win of BrowserWindow.getAllWindows()) {
            try { win.webContents.send("model-pull-progress", { tag, status: "downloading", percent }); } catch { /* frame disposed */ }
          }
        },
        controller.signal,
      );

      activePulls.delete(tag);

      // Send completion
      for (const win of BrowserWindow.getAllWindows()) {
        try { win.webContents.send("model-pull-progress", { tag, status: "done", percent: 100 }); } catch { /* frame disposed */ }
      }
      return { success: true };
    } catch (err) {
      activePulls.delete(tag);
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
            env = env.replace(/^CHAT_BASE_URL=.*$/m, `CHAT_BASE_URL=${CHAT_BASE_URL}/v1`);
          } else {
            env += `CHAT_BASE_URL=${CHAT_BASE_URL}/v1\n`;
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

  /** Import a GGUF file by copying it into the models directory. */
  ipcMain.handle("models-import-gguf", async (_event, ggufPath: string, modelName: string) => {
    if (!ggufPath || !modelName) return { success: false, error: "Path and model name are required" };
    if (!fs.existsSync(ggufPath)) return { success: false, error: "File not found" };
    if (!ggufPath.endsWith(".gguf")) return { success: false, error: "File must be a .gguf file" };

    // Sanitize model name: lowercase, alphanumeric + hyphens only
    const sanitized = modelName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!sanitized) return { success: false, error: "Invalid model name" };

    try {
      const config = loadConfig();
      const destDir = llamaModelsDir(config?.dataDir);
      fs.mkdirSync(destDir, { recursive: true });

      const destFilename = `${sanitized}.gguf`;
      const destPath = path.join(destDir, destFilename);

      // Copy with progress
      for (const win of BrowserWindow.getAllWindows()) {
        try { win.webContents.send("model-pull-progress", { tag: sanitized, status: "Copying model file...", percent: 50 }); } catch { /* frame disposed */ }
      }

      fs.copyFileSync(ggufPath, destPath);

      for (const win of BrowserWindow.getAllWindows()) {
        try { win.webContents.send("model-pull-progress", { tag: sanitized, status: "done", percent: 100 }); } catch { /* frame disposed */ }
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Model Search (HuggingFace GGUF models) ────────────────────────────────

  /** Search HuggingFace for GGUF models. Fetched from main process to avoid CORS. */
  ipcMain.handle("models-search", async (_event, query: string) => {
    if (!query || query.trim().length < 2) return { models: [] };
    try {
      const q = encodeURIComponent(query.trim());
      const resp = await fetch(
        `https://huggingface.co/api/models?search=${q}&filter=gguf&sort=downloads&direction=-1&limit=30`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!resp.ok) return { models: [], error: `HTTP ${resp.status}` };
      const data = await resp.json() as Array<{ modelId: string; tags?: string[]; description?: string; downloads?: number }>;
      const filtered = data
        .filter((m) => m.tags?.includes("gguf"))
        .slice(0, 30)
        .map((m) => {
          const tags = m.tags ?? [];
          const id = m.modelId.toLowerCase();
          const tagSet = new Set(tags.map((t) => t.toLowerCase()));
          return {
            name: m.modelId,
            description: m.description ?? "",
            tags,
            huggingFaceUrl: `https://huggingface.co/${m.modelId}`,
            capabilities: {
              vision: tagSet.has("image-text-to-text") || tagSet.has("vision"),
              toolUse: tagSet.has("tool-use") || tagSet.has("function-calling")
                || /qwen3\.5|llama-3\.[1-9]|mistral/.test(id),
              reasoning: tagSet.has("reasoning") || /\breasonin/.test(id),
            },
          };
        });
      return { models: filtered };
    } catch (err) {
      return { models: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Instance Management ──────────────────────────────────────────────────

  /** Full wipe: stop server, delete data dir contents, remove config. Triggers re-setup on next launch. */
  ipcMain.handle("instance-wipe", async () => {
    const config = loadConfig();
    if (!config) return { success: false, error: "No config found" };
    try {
      // Stop server + llama-server first
      const { stopServer } = await import("./server.js");
      await stopServer();
      try { await stopLlama(config.dataDir); } catch { /* may not be running */ }

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
        const rssKB = parseInt(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), 10);
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
  let modelsBytes = 0;
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

  // GGUF models directory
  try {
    const mDir = path.join(dir, ".llama", "models");
    if (fs.existsSync(mDir)) {
      modelsBytes = dirSize(mDir);
    }
  } catch { /* ignore */ }

  // Vault sources (encrypted files in uploads with vault markers — approximate)
  // For now vault is part of uploads total; we'd need DB queries to distinguish.
  // We'll report uploads as "Documents" and vault separately if we can detect it.

  return { dbBytes, uploadsBytes, modelsBytes, vaultBytes };
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

interface ModelCapabilities {
  vision: boolean;
  toolUse: boolean;
  reasoning: boolean;
}

interface CatalogEntry {
  tag: string; ggufFilename: string; downloadUrl: string; name: string; family: string; description: string;
  paramCount: string; downloadSizeGB: number; ramUsageGB: number;
  origin: string; tier: string; minRAMGB: number; hidden?: boolean;
  capabilities: ModelCapabilities; huggingFaceUrl: string;
}

function getCatalog(): CatalogEntry[] {
  return [
    // Recommended
    { tag: "qwen3.5-4b", ggufFilename: "Qwen3.5-4B-Q4_K_M.gguf", downloadUrl: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf", name: "Qwen 3.5 4B", family: "Qwen", description: "Best overall for most hardware. Vision + tool use, 256K context.", paramCount: "4B", downloadSizeGB: 2.7, ramUsageGB: 5.5, origin: "Alibaba", tier: "recommended", minRAMGB: 8, capabilities: { vision: true, toolUse: true, reasoning: false }, huggingFaceUrl: "https://huggingface.co/Qwen/Qwen3.5-4B" },
    { tag: "qwen3.5-9b", ggufFilename: "Qwen3.5-9B-Q4_K_M.gguf", downloadUrl: "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf", name: "Qwen 3.5 9B", family: "Qwen", description: "Stronger reasoning and analysis. Vision + tool use. Best for 16GB machines.", paramCount: "9B", downloadSizeGB: 5.9, ramUsageGB: 9.5, origin: "Alibaba", tier: "recommended", minRAMGB: 16, capabilities: { vision: true, toolUse: true, reasoning: false }, huggingFaceUrl: "https://huggingface.co/Qwen/Qwen3.5-9B" },
    { tag: "qwen3.5-35b-a3b", ggufFilename: "Qwen3.5-35B-A3B-Q4_K_M.gguf", downloadUrl: "https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-Q4_K_M.gguf", name: "Qwen 3.5 35B-A3B MoE", family: "Qwen", description: "35B params, only 3B active. Thinks like a big model, runs like a small one. Vision + tool use.", paramCount: "35B (3B active)", downloadSizeGB: 5.5, ramUsageGB: 9, origin: "Alibaba", tier: "recommended", minRAMGB: 16, capabilities: { vision: true, toolUse: true, reasoning: true }, huggingFaceUrl: "https://huggingface.co/Qwen/Qwen3.5-35B-A3B" },
    // Supported
    { tag: "qwen3.5-27b", ggufFilename: "Qwen3.5-27B-Q4_K_M.gguf", downloadUrl: "https://huggingface.co/unsloth/Qwen3.5-27B-GGUF/resolve/main/Qwen3.5-27B-Q4_K_M.gguf", name: "Qwen 3.5 27B", family: "Qwen", description: "Highest quality dense model. Vision + tool use. For 32GB machines.", paramCount: "27B", downloadSizeGB: 16.5, ramUsageGB: 22, origin: "Alibaba", tier: "supported", minRAMGB: 32, capabilities: { vision: true, toolUse: true, reasoning: true }, huggingFaceUrl: "https://huggingface.co/Qwen/Qwen3.5-27B" },
    { tag: "phi4-mini", ggufFilename: "Phi-4-mini-instruct-Q4_K_M.gguf", downloadUrl: "https://huggingface.co/bartowski/Phi-4-mini-instruct-GGUF/resolve/main/Phi-4-mini-instruct-Q4_K_M.gguf", name: "Phi-4 Mini", family: "Microsoft", description: "Compact, efficient, 128K context. Good for constrained setups.", paramCount: "3.8B", downloadSizeGB: 2.5, ramUsageGB: 5, origin: "Microsoft", tier: "supported", minRAMGB: 8, capabilities: { vision: false, toolUse: true, reasoning: false }, huggingFaceUrl: "https://huggingface.co/microsoft/Phi-4-mini-instruct" },
    { tag: "gemma3-4b", ggufFilename: "gemma-3-4b-it-Q4_K_M.gguf", downloadUrl: "https://huggingface.co/bartowski/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf", name: "Gemma 3 4B", family: "Google", description: "Google's efficient model. Multimodal capable, 128K context.", paramCount: "4B", downloadSizeGB: 3.3, ramUsageGB: 6, origin: "Google", tier: "supported", minRAMGB: 8, capabilities: { vision: true, toolUse: false, reasoning: false }, huggingFaceUrl: "https://huggingface.co/google/gemma-3-4b-it" },
    { tag: "gemma3-12b", ggufFilename: "gemma-3-12b-it-Q4_K_M.gguf", downloadUrl: "https://huggingface.co/bartowski/gemma-3-12b-it-GGUF/resolve/main/gemma-3-12b-it-Q4_K_M.gguf", name: "Gemma 3 12B", family: "Google", description: "Strong document analysis. Multimodal, 128K context.", paramCount: "12B", downloadSizeGB: 8.1, ramUsageGB: 13, origin: "Google", tier: "supported", minRAMGB: 16, capabilities: { vision: true, toolUse: false, reasoning: false }, huggingFaceUrl: "https://huggingface.co/google/gemma-3-12b-it" },
    // Hidden infrastructure
    { tag: "nomic-embed-text", ggufFilename: "nomic-embed-text-v1.5.Q8_0.gguf", downloadUrl: "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf", name: "Nomic Embed Text", family: "Nomic", description: "Text embedding model for semantic search.", paramCount: "137M", downloadSizeGB: 0.15, ramUsageGB: 0.3, origin: "Nomic", tier: "recommended", minRAMGB: 4, hidden: true, capabilities: { vision: false, toolUse: false, reasoning: false }, huggingFaceUrl: "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5" },
  ];
}
