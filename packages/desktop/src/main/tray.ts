import { Tray, Menu, nativeImage, shell, BrowserWindow } from "electron";
import path from "path";
import {
  startServer,
  stopServer,
  restartServer,
  getStatus,
  getPort,
  getHostname,
  onStatusChange,
  type ServerStatus,
} from "./server.js";
import { loadConfig, saveConfig, envPath } from "./config.js";
import { certsExist } from "./certs.js";
import fs from "fs";

let tray: Tray | null = null;
let logWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

const STATUS_LABELS: Record<ServerStatus, string> = {
  stopped: "Server Stopped",
  starting: "Server Starting...",
  running: "Server Running",
  error: "Server Error",
};

function getTrayIcon(_status: ServerStatus): Electron.NativeImage {
  const iconPath = path.join(__dirname, "..", "..", "resources", "trayTemplate.png");
  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) {
    icon.setTemplateImage(true);
    return icon;
  }
  // Fallback if asset not found
  return createFallbackIcon(_status);
}

function createFallbackIcon(status: ServerStatus): Electron.NativeImage {
  // 16x16 template image placeholder
  // In production, this will be replaced with actual .png assets
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);

  const colors: Record<ServerStatus, [number, number, number]> = {
    stopped: [128, 128, 128],
    starting: [255, 165, 0],
    running: [0, 200, 0],
    error: [255, 50, 50],
  };

  const [r, g, b] = colors[status];

  // Draw a filled circle in the center
  const cx = size / 2;
  const cy = size / 2;
  const radius = 5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist <= radius) {
        canvas[idx] = r;
        canvas[idx + 1] = g;
        canvas[idx + 2] = b;
        canvas[idx + 3] = 255;
      } else {
        canvas[idx + 3] = 0; // transparent
      }
    }
  }

  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function getProtocol(): string {
  const config = loadConfig();
  return config && certsExist(config.dataDir) ? "https" : "http";
}

function getAccessUrl(): string {
  const hostname = getHostname();
  const port = getPort();
  const proto = getProtocol();
  const defaultPort = proto === "https" ? 443 : 80;
  return port === defaultPort ? `${proto}://${hostname}` : `${proto}://${hostname}:${port}`;
}

function getLanUrl(): string {
  const hostname = getHostname();
  const port = getPort();
  const proto = getProtocol();
  const defaultPort = proto === "https" ? 443 : 80;
  return port === defaultPort ? `${proto}://${hostname}` : `${proto}://${hostname}:${port}`;
}

function buildContextMenu(): Menu {
  const status = getStatus();
  const isRunning = status === "running";
  const isStopped = status === "stopped" || status === "error";
  const accessUrl = getAccessUrl();
  const lanUrl = getLanUrl();

  return Menu.buildFromTemplate([
    {
      label: `Edgebric — ${STATUS_LABELS[status]}`,
      enabled: false,
    },
    ...(isRunning
      ? [
          { label: `  ${accessUrl}`, enabled: false } as Electron.MenuItemConstructorOptions,
          ...(lanUrl !== accessUrl
            ? [{ label: `  ${lanUrl} (LAN)`, enabled: false } as Electron.MenuItemConstructorOptions]
            : []),
        ]
      : []),
    { type: "separator" as const },
    {
      label: "Open Web UI",
      enabled: isRunning,
      click: () => {
        shell.openExternal(accessUrl);
      },
    },
    { type: "separator" as const },
    {
      label: "Start Server",
      enabled: isStopped,
      click: () => {
        startServer().catch(console.error);
      },
    },
    {
      label: "Stop Server",
      enabled: isRunning || status === "starting",
      click: () => {
        stopServer().catch(console.error);
      },
    },
    {
      label: "Restart Server",
      enabled: isRunning,
      click: () => {
        restartServer().catch(console.error);
      },
    },
    { type: "separator" as const },
    {
      label: "View Logs...",
      click: () => {
        openLogWindow();
      },
    },
    {
      label: "Server Settings...",
      click: () => {
        openSettingsWindow();
      },
    },
    { type: "separator" as const },
    {
      label: "Quit Edgebric",
      click: async () => {
        await stopServer();
        const { app } = await import("electron");
        app.quit();
      },
    },
  ]);
}

function openLogWindow() {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.focus();
    return;
  }

  logWindow = new BrowserWindow({
    width: 800,
    height: 500,
    title: "Edgebric Logs",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
    },
  });

  // Load a simple log viewer page
  logWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(LOG_VIEWER_HTML)}`
  );

  logWindow.on("closed", () => {
    logWindow = null;
  });
}

const LOG_VIEWER_HTML = `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
      font-size: 12px;
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 12px;
      height: 100vh;
      overflow: hidden;
    }
    #logs {
      height: calc(100vh - 48px);
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.5;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      padding: 8px 0;
      border-bottom: 1px solid #333;
      margin-bottom: 8px;
    }
    button {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 12px;
      padding: 4px 12px;
      border-radius: 4px;
      border: 1px solid #555;
      background: #333;
      color: #d4d4d4;
      cursor: pointer;
    }
    button:hover { background: #444; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button onclick="refreshLogs()">Refresh</button>
    <button onclick="clearDisplay()">Clear</button>
  </div>
  <div id="logs">Loading logs...</div>
  <script>
    async function refreshLogs() {
      const logs = await window.electronAPI.readLogs();
      document.getElementById('logs').textContent = logs;
      const el = document.getElementById('logs');
      el.scrollTop = el.scrollHeight;
    }
    function clearDisplay() {
      document.getElementById('logs').textContent = '';
    }
    refreshLogs();
    // Auto-refresh every 3 seconds
    setInterval(refreshLogs, 3000);
  </script>
</body>
</html>`;

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  const config = loadConfig();
  const currentHostname = config?.hostname ?? "edgebric.local";
  const currentPort = config?.port ?? 3001;

  settingsWindow = new BrowserWindow({
    width: 700,
    height: 580,
    title: "Server Settings",
    minWidth: 560,
    minHeight: 480,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const html = SETTINGS_HTML
    .replace("{{hostname}}", currentHostname)
    .replace("{{port}}", String(currentPort));

  settingsWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  );

  // Handle save messages from the settings page
  settingsWindow.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    if (url.startsWith("edgebric://save?")) {
      const params = new URL(url).searchParams;
      const newHostname = params.get("hostname")?.trim();
      const newPort = parseInt(params.get("port") ?? "", 10);

      if (!newHostname || isNaN(newPort) || newPort < 1 || newPort > 65535) return;

      if (config) {
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

        // Show confirmation, then close
        settingsWindow?.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(SETTINGS_SAVED_HTML)}`
        );
        setTimeout(() => {
          settingsWindow?.close();
        }, 1500);
      }
    }
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

const SETTINGS_SAVED_HTML = `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      display: flex; align-items: center; justify-content: center; height: 100vh;
      background: #fafafa; color: #111;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #1c1c1e; color: #e5e5e7; }
    }
    .msg { text-align: center; }
    .msg h2 { font-size: 18px; margin-bottom: 4px; }
    .msg p { color: #666; font-size: 13px; }
    @media (prefers-color-scheme: dark) { .msg p { color: #98989d; } }
  </style>
</head>
<body>
  <div class="msg">
    <h2>Settings saved</h2>
    <p>Restart the server for changes to take effect.</p>
  </div>
</body>
</html>`;

const SETTINGS_HTML = `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #fafafa;
      color: #111;
      padding: 32px 40px;
      line-height: 1.5;
    }
    h2 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 13px; margin-bottom: 28px; }
    .field { margin-bottom: 20px; }
    .field label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; color: #333; }
    .field input {
      width: 100%; padding: 10px 12px; border: 1px solid #d0d0d0; border-radius: 6px;
      font-size: 14px; font-family: inherit; background: #fff; color: #111; outline: none;
    }
    .field input:focus { border-color: #0066cc; box-shadow: 0 0 0 2px rgba(0,102,204,0.15); }
    .field .hint { font-size: 12px; color: #888; margin-top: 4px; }
    .preview { background: #f0f6ff; border: 1px solid #cce0ff; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; }
    .preview .label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .preview .url { font-size: 16px; font-weight: 500; color: #0066cc; font-family: 'SF Mono', Menlo, monospace; }
    .advanced-toggle {
      font-size: 13px; color: #0066cc; cursor: pointer; border: none; background: none;
      padding: 0; font-family: inherit; margin-bottom: 16px; display: block;
    }
    .advanced-toggle:hover { text-decoration: underline; }
    .advanced-section { display: none; }
    .advanced-section.open { display: block; }
    .clean-url-tip {
      background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;
      padding: 12px 16px; margin-top: 12px; font-size: 12px; color: #92400e;
    }
    .clean-url-tip strong { color: #78350f; }
    .code-block {
      background: #1e1e1e; color: #d4d4d4; padding: 10px 14px; border-radius: 6px;
      font-family: 'SF Mono', Menlo, monospace; font-size: 12px; margin: 8px 0;
      overflow-x: auto; white-space: pre-wrap; word-break: break-all;
    }
    .buttons { display: flex; gap: 8px; justify-content: flex-end; margin-top: 28px; }
    .btn {
      padding: 10px 24px; border-radius: 6px; font-size: 14px; font-weight: 500;
      font-family: inherit; cursor: pointer; border: 1px solid transparent;
    }
    .btn-secondary { background: #f0f0f0; color: #333; border-color: #d0d0d0; }
    .btn-secondary:hover { background: #e5e5e5; }
    .btn-primary { background: #0066cc; color: #fff; }
    .btn-primary:hover { background: #0055b3; }
    .error { color: #b91c1c; font-size: 12px; margin-top: 4px; display: none; }

    @media (prefers-color-scheme: dark) {
      body { background: #1c1c1e; color: #e5e5e7; }
      .subtitle { color: #98989d; }
      .field label { color: #c7c7cc; }
      .field input { background: #2c2c2e; border-color: #48484a; color: #e5e5e7; }
      .field input:focus { border-color: #0a84ff; box-shadow: 0 0 0 2px rgba(10,132,255,0.2); }
      .field .hint { color: #636366; }
      .preview { background: #1a2a3a; border-color: #2a4a6a; }
      .preview .label { color: #98989d; }
      .preview .url { color: #4da6ff; }
      .advanced-toggle { color: #0a84ff; }
      .clean-url-tip { background: #2a2000; border-color: #5c4800; color: #fbbf24; }
      .clean-url-tip strong { color: #fcd34d; }
      .code-block { background: #000; color: #d4d4d4; }
      .btn-secondary { background: #2c2c2e; color: #e5e5e7; border-color: #48484a; }
      .btn-secondary:hover { background: #3a3a3c; }
      .btn-primary { background: #0a84ff; }
      .btn-primary:hover { background: #0077e6; }
    }
  </style>
</head>
<body>
  <h2>Server Settings</h2>
  <p class="subtitle">Change how Edgebric is accessed on your network.</p>

  <div class="preview">
    <div class="label">Access URL</div>
    <div class="url" id="urlPreview">https://{{hostname}}:{{port}}</div>
  </div>

  <div class="field">
    <label for="hostname">Hostname</label>
    <input id="hostname" type="text" value="{{hostname}}" oninput="updatePreview()" />
    <p class="hint">
      Use <strong>edgebric.local</strong> for zero-config local access (mDNS),
      or a custom domain like <strong>hr.acme.com</strong> if you have DNS configured.
    </p>
    <p class="error" id="hostnameError">Hostname cannot be empty.</p>
  </div>

  <button class="advanced-toggle" onclick="toggleAdvanced()">
    <span id="advToggleText">Show advanced options</span>
  </button>

  <div class="advanced-section" id="advancedSection">
    <div class="field">
      <label for="port">Port</label>
      <input id="port" type="number" min="1" max="65535" value="{{port}}" oninput="updatePreview()" />
      <p class="hint">Default: 3001. Most users don't need to change this.</p>
      <p class="error" id="portError">Port must be between 1 and 65535.</p>
    </div>

    <div class="clean-url-tip">
      <strong>Want a clean URL without a port number?</strong><br>
      Run this once in Terminal to forward port 443 to your Edgebric port:
      <div class="code-block">echo "rdr pass on lo0 inet proto tcp from any to any port 443 -> 127.0.0.1 port {{port}}" | sudo pfctl -ef -</div>
      Then users can access Edgebric at just <strong>https://{{hostname}}</strong>.
      To undo, run: <code>sudo pfctl -F all -f /etc/pf.conf</code>
    </div>
  </div>

  <div class="buttons">
    <button class="btn btn-secondary" onclick="window.close()">Cancel</button>
    <button class="btn btn-primary" onclick="save()">Save</button>
  </div>

  <script>
    function updatePreview() {
      const h = document.getElementById('hostname').value.trim();
      const p = parseInt(document.getElementById('port').value, 10);
      const url = (p === 443) ? 'https://' + h : 'https://' + h + ':' + p;
      document.getElementById('urlPreview').textContent = url;
    }

    function toggleAdvanced() {
      const section = document.getElementById('advancedSection');
      const text = document.getElementById('advToggleText');
      const isOpen = section.classList.toggle('open');
      text.textContent = isOpen ? 'Hide advanced options' : 'Show advanced options';
    }

    function save() {
      const h = document.getElementById('hostname').value.trim();
      const p = parseInt(document.getElementById('port').value, 10);

      let valid = true;
      document.getElementById('hostnameError').style.display = 'none';
      document.getElementById('portError').style.display = 'none';

      if (!h) {
        document.getElementById('hostnameError').style.display = 'block';
        valid = false;
      }
      if (isNaN(p) || p < 1 || p > 65535) {
        document.getElementById('portError').style.display = 'block';
        valid = false;
      }
      if (!valid) return;

      window.location.href = 'edgebric://save?hostname=' + encodeURIComponent(h) + '&port=' + p;
    }
  </script>
</body>
</html>`;

export function createTray() {
  const icon = getTrayIcon(getStatus());
  tray = new Tray(icon);
  tray.setToolTip("Edgebric");
  tray.setContextMenu(buildContextMenu());

  // Rebuild menu and update icon on status changes
  onStatusChange((status) => {
    if (!tray) return;
    tray.setImage(getTrayIcon(status));
    tray.setContextMenu(buildContextMenu());
  });
}

export function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
