import { app, Tray, Menu, nativeImage, shell } from "electron";
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
import { openMainWindow, openLogWindow, openMainWindowToSettings, openMainWindowToModels } from "./index.js";
import { loadConfig } from "./config.js";
import { certsExist } from "./certs.js";
import { checkForUpdatesManual, isUpdateDownloaded, isDownloadingUpdate } from "./updater.js";

let tray: Tray | null = null;

const STATUS_LABELS: Record<ServerStatus, string> = {
  stopped: "Server Stopped",
  starting: "Server Starting...",
  running: "Server Running",
  error: "Server Error",
};

function getResourcesPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "resources")
    : path.join(__dirname, "..", "..", "resources");
}

function getTrayIcon(_status: ServerStatus): Electron.NativeImage {
  const iconPath = path.join(getResourcesPath(), "trayTemplate.png");
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
      label: "Launch Edgebric",
      enabled: isRunning,
      click: () => {
        shell.openExternal(accessUrl);
      },
    },
    {
      label: "Dashboard",
      click: () => {
        openMainWindow();
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
      label: "Models...",
      click: () => {
        openMainWindowToModels();
      },
    },
    {
      label: "View Logs...",
      click: () => {
        openLogWindow();
      },
    },
    {
      label: "Server Settings...",
      click: () => {
        openMainWindowToSettings();
      },
    },
    { type: "separator" as const },
    {
      label: isDownloadingUpdate()
        ? "Downloading Update..."
        : isUpdateDownloaded()
          ? "Restart to Update"
          : "Check for Updates...",
      enabled: !isDownloadingUpdate(),
      click: () => {
        if (isUpdateDownloaded()) {
          import("electron-updater").then(({ autoUpdater }) => {
            autoUpdater.quitAndInstall(false, true);
          });
        } else {
          checkForUpdatesManual();
        }
      },
    },
    {
      label: `Version ${app.getVersion()}`,
      enabled: false,
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
