import { app, BrowserWindow, nativeImage, nativeTheme, shell, powerMonitor } from "electron";
import path from "path";
import { createTray, destroyTray } from "./tray.js";
import { startServer, cleanup, getStatus, readLogs, refreshMdns } from "./server.js";
import { isFirstRun, loadConfig } from "./config.js";
import { registerIpcHandlers } from "./ipc.js";
import { killOrphanedLlamaProcesses } from "./llama-server.js";

function getAppIcon(): Electron.NativeImage {
  const resourcesDir = app.isPackaged
    ? path.join(process.resourcesPath, "resources")
    : path.join(__dirname, "..", "..", "resources");
  return nativeImage.createFromPath(path.join(resourcesDir, "icon.icns"));
}

// Catch unhandled errors so mDNS/network glitches don't crash the app
process.on("uncaughtException", (err) => {
  // EADDRNOTAVAIL = network interface unavailable (sleep/wake, disconnected wifi)
  // These are transient and safe to swallow.
  if (err.message?.includes("EADDRNOTAVAIL") || err.message?.includes("ENETUNREACH")) {
    console.warn("Transient network error (ignored):", err.message);
    return;
  }
  console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.warn("Unhandled rejection:", reason);
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

export function openMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  // Show dock icon while window is open
  if (process.platform === "darwin") {
    app.dock?.show();
  }

  const appIcon = getAppIcon();

  if (process.platform === "darwin" && !appIcon.isEmpty()) {
    app.dock?.setIcon(appIcon);
  }

  mainWindow = new BrowserWindow({
    width: 900,
    height: 860,
    minWidth: 680,
    minHeight: 680,
    title: "Edgebric",
    titleBarStyle: "hiddenInset",
    icon: appIcon,
    webPreferences: {
      preload: `${__dirname}/../preload/index.js`,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    const devUrl = process.env.ELECTRON_RENDERER_URL;

    // Poll until the dev server is up before loading the URL
    const waitForDevServer = async () => {
      for (let i = 0; i < 30; i++) {
        try {
          const resp = await fetch(devUrl, { signal: AbortSignal.timeout(500) });
          if (resp.ok) return;
        } catch { /* not ready yet */ }
        await new Promise((r) => setTimeout(r, 300));
      }
    };

    waitForDevServer().then(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(devUrl);
      }
    });
  } else {
    mainWindow.loadFile(`${__dirname}/../renderer/index.html`);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (process.platform === "darwin") {
      app.dock?.hide();
    }
  });
}

let logWindow: BrowserWindow | null = null;

export function openLogWindow() {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.show();
    logWindow.focus();
    return;
  }

  const logText = readLogs(500);
  const isDark = nativeTheme.shouldUseDarkColors;
  const bg = isDark ? "#0a0a0a" : "#1c1c1e";
  const fg = isDark ? "#e2e8f0" : "#d4d4d4";
  const btnBg = isDark ? "#1e293b" : "#2a2a2c";
  const btnHover = isDark ? "#334155" : "#3a3a3c";
  const btnBorder = isDark ? "#334155" : "#3a3a3c";

  const escapedLog = logText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Edgebric Logs</title><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: ${bg}; color: ${fg}; font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, sans-serif; height: 100vh; display: flex; flex-direction: column; }
    .toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid ${isDark ? "#1e293b" : "#333"}; flex-shrink: 0; -webkit-app-region: drag; }
    .toolbar-title { font-size: 12px; font-weight: 600; color: ${isDark ? "#94a3b8" : "#999"}; flex: 1; }
    .toolbar button { -webkit-app-region: no-drag; padding: 4px 10px; border-radius: 4px; border: 1px solid ${btnBorder}; background: ${btnBg}; color: ${fg}; font-size: 11px; font-family: inherit; cursor: pointer; transition: background 0.1s; }
    .toolbar button:hover { background: ${btnHover}; }
    .toolbar .status { font-size: 10px; color: ${isDark ? "#475569" : "#666"}; }
    pre { flex: 1; padding: 12px 14px; font: 11px/1.5 'SF Mono',Menlo,Monaco,monospace; white-space: pre-wrap; word-break: break-all; overflow-y: auto; -webkit-user-select: text; }
  </style></head><body>
    <div class="toolbar">
      <span class="toolbar-title">Edgebric Logs</span>
      <span class="status" id="status"></span>
      <button onclick="refreshLogs()" title="Refresh">Refresh</button>
      <button onclick="copyLogs()" title="Copy all to clipboard">Copy</button>
      <button onclick="clearDisplay()" title="Clear display">Clear</button>
      <button onclick="toggleAutoScroll()" id="autoScrollBtn" title="Toggle auto-scroll">Auto-scroll: On</button>
    </div>
    <pre id="logs">${escapedLog || "No logs yet."}</pre>
    <script>
      let autoScroll = true;
      const pre = document.getElementById('logs');
      const statusEl = document.getElementById('status');
      const autoBtn = document.getElementById('autoScrollBtn');

      function scrollToBottom() {
        if (autoScroll) pre.scrollTop = pre.scrollHeight;
      }
      scrollToBottom();

      function copyLogs() {
        navigator.clipboard.writeText(pre.textContent || '').then(() => {
          statusEl.textContent = 'Copied!';
          setTimeout(() => statusEl.textContent = '', 2000);
        });
      }

      function clearDisplay() {
        pre.textContent = '';
        statusEl.textContent = 'Cleared display';
        setTimeout(() => statusEl.textContent = '', 2000);
      }

      function toggleAutoScroll() {
        autoScroll = !autoScroll;
        autoBtn.textContent = 'Auto-scroll: ' + (autoScroll ? 'On' : 'Off');
        if (autoScroll) scrollToBottom();
      }

      async function refreshLogs() {
        statusEl.textContent = 'Refreshing...';
        try {
          // Use the preload API if available, otherwise just note it
          if (window.electronAPI && window.electronAPI.readLogs) {
            const text = await window.electronAPI.readLogs(500);
            pre.textContent = text || 'No logs yet.';
          }
          statusEl.textContent = 'Updated';
        } catch(e) {
          statusEl.textContent = 'Error';
        }
        setTimeout(() => statusEl.textContent = '', 2000);
        scrollToBottom();
      }

      // Auto-refresh every 3s
      setInterval(refreshLogs, 3000);
    </script>
  </body></html>`;

  logWindow = new BrowserWindow({
    width: 750,
    height: 520,
    title: "Edgebric Logs",
    titleBarStyle: "default",
    webPreferences: {
      preload: `${__dirname}/../preload/index.js`,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  logWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  logWindow.setMenu(null);

  logWindow.on("closed", () => {
    logWindow = null;
  });
}

export function openMainWindowToSettings() {
  openMainWindow();
  // Give the window time to load, then send a message to navigate to settings
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("navigate-to", "settings");
    }
  }, 500);
}

export function openMainWindowToModels() {
  openMainWindow();
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("navigate-to", "models");
    }
  }, 500);
}

app.on("second-instance", () => {
  openMainWindow();
});

app.whenReady().then(async () => {
  // Menu bar app — hide from Dock on macOS
  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  // Kill any orphaned llama-server processes from a previous crash/force-quit
  const cfg = loadConfig();
  killOrphanedLlamaProcesses(cfg?.dataDir);

  registerIpcHandlers();
  createTray();

  // Always open the main window on launch
  openMainWindow();

  if (!isFirstRun()) {
    // Sync login item with config (in case it got out of sync)
    const config = loadConfig();
    if (config?.launchAtLogin !== undefined) {
      app.setLoginItemSettings({ openAtLogin: config.launchAtLogin });
    }

    // Auto-start server on launch
    try {
      await startServer();
    } catch (err) {
      console.error("Failed to start server:", err);
    }
  }

  // Re-publish mDNS after sleep/wake so the service record is fresh
  powerMonitor.on("resume", () => {
    console.log("System resumed from sleep — refreshing mDNS");
    refreshMdns();
  });
});

app.on("window-all-closed", () => {
  // Don't quit — we're a menu bar app. Keep running in tray.
});

app.on("before-quit", async () => {
  destroyTray();
  await cleanup();
});
