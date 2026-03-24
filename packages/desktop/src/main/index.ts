import { app, BrowserWindow, nativeImage, shell } from "electron";
import path from "path";
import { createTray, destroyTray } from "./tray.js";
import { startServer, cleanup, getStatus } from "./server.js";
import { isFirstRun, loadConfig } from "./config.js";
import { registerIpcHandlers } from "./ipc.js";

function getAppIcon(): Electron.NativeImage {
  const iconPath = path.join(__dirname, "..", "..", "resources", "icon.icns");
  return nativeImage.createFromPath(iconPath);
}

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

  const appIcon = getAppIcon();

  // Set Dock icon while setup is open
  if (process.platform === "darwin" && !appIcon.isEmpty()) {
    app.dock?.setIcon(appIcon);
  }

  setupWindow = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 680,
    minHeight: 580,
    title: "Edgebric Setup",
    titleBarStyle: "hiddenInset",
    icon: appIcon,
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

  // Open external links in the system browser, not a blank Electron window
  setupWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  setupWindow.on("closed", () => {
    setupWindow = null;
    // Re-hide dock when setup window closes
    if (process.platform === "darwin") {
      app.dock?.hide();
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
