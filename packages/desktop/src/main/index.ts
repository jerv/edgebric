import { app, BrowserWindow } from "electron";
import { createTray, destroyTray } from "./tray.js";
import { startServer, cleanup, getStatus } from "./server.js";
import { isFirstRun, loadConfig } from "./config.js";
import { registerIpcHandlers } from "./ipc.js";

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let setupWindow: BrowserWindow | null = null;

function openSetupWizard() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return;
  }

  // Show dock icon while setup wizard is open
  if (process.platform === "darwin") {
    app.dock?.show();
  }

  setupWindow = new BrowserWindow({
    width: 680,
    height: 640,
    resizable: false,
    title: "Edgebric Setup",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: `${__dirname}/../preload/index.js`,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In development, load from Vite dev server
  // In production, load from built files
  if (process.env.ELECTRON_RENDERER_URL) {
    setupWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    setupWindow.loadFile(`${__dirname}/../renderer/index.html`);
  }

  setupWindow.on("closed", () => {
    setupWindow = null;
    // Re-hide dock when setup window closes
    if (process.platform === "darwin") {
      app.dock?.hide();
    }
    // If config exists now, start the server
    if (loadConfig()) {
      startServer().catch(console.error);
    }
  });
}

app.whenReady().then(async () => {
  // Menu bar app — hide from Dock on macOS
  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  registerIpcHandlers();
  createTray();

  if (isFirstRun()) {
    openSetupWizard();
  } else {
    // Auto-start server on launch
    try {
      await startServer();
    } catch (err) {
      console.error("Failed to start server:", err);
    }
  }
});

app.on("window-all-closed", () => {
  // Don't quit — we're a menu bar app. Keep running in tray.
});

app.on("before-quit", async () => {
  destroyTray();
  await cleanup();
});
