import { Tray, Menu, nativeImage, shell, BrowserWindow } from "electron";
import path from "path";
import {
  startServer,
  stopServer,
  restartServer,
  getStatus,
  getPort,
  onStatusChange,
  type ServerStatus,
} from "./server.js";

let tray: Tray | null = null;
let logWindow: BrowserWindow | null = null;

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

function buildContextMenu(): Menu {
  const status = getStatus();
  const port = getPort();
  const isRunning = status === "running";
  const isStopped = status === "stopped" || status === "error";

  return Menu.buildFromTemplate([
    {
      label: `Edgebric — ${STATUS_LABELS[status]}`,
      enabled: false,
    },
    ...(isRunning
      ? [{ label: `  Port ${port}`, enabled: false } as Electron.MenuItemConstructorOptions]
      : []),
    { type: "separator" as const },
    {
      label: "Open Edgebric",
      enabled: isRunning,
      click: () => {
        shell.openExternal(`http://localhost:${port}`);
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
