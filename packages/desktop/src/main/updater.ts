import { autoUpdater, type UpdateInfo } from "electron-updater";
import { app, dialog, Notification } from "electron";
import log from "electron-log";
import fs from "fs";
import path from "path";

// Route electron-updater logs through electron-log
autoUpdater.logger = log;

// Don't auto-download — we download in the background after prompting
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// ── Auto-update preference persistence ─────────────────────────────────────

function getAutoUpdateFile(): string {
  return path.join(app.getPath("userData"), ".auto-update-enabled");
}

export function getAutoUpdateEnabled(): boolean {
  try {
    return fs.readFileSync(getAutoUpdateFile(), "utf8").trim() !== "false";
  } catch {
    return true; // default: enabled
  }
}

export function setAutoUpdateEnabled(enabled: boolean): void {
  fs.writeFileSync(getAutoUpdateFile(), String(enabled), "utf8");
}

// ── Skip-version persistence ────────────────────────────────────────────────

function getSkipFile(): string {
  return path.join(app.getPath("userData"), ".skip-update-version");
}

function getSkippedVersion(): string | null {
  try {
    return fs.readFileSync(getSkipFile(), "utf8").trim();
  } catch {
    return null;
  }
}

function setSkippedVersion(version: string): void {
  fs.writeFileSync(getSkipFile(), version, "utf8");
}

function clearSkippedVersion(): void {
  try {
    fs.unlinkSync(getSkipFile());
  } catch {
    // file may not exist
  }
}

// ── State ───────────────────────────────────────────────────────────────────

let updateDownloaded = false;
let downloadingUpdate = false;
let availableUpdate: UpdateInfo | null = null;

export function isUpdateDownloaded(): boolean {
  return updateDownloaded;
}

export function isDownloadingUpdate(): boolean {
  return downloadingUpdate;
}

export function getAvailableVersion(): string | null {
  return availableUpdate?.version ?? null;
}

let checkingForUpdate = false;

export function getUpdateStatus(): { checking: boolean; downloading: boolean; downloaded: boolean; availableVersion: string | null } {
  return {
    checking: checkingForUpdate,
    downloading: downloadingUpdate,
    downloaded: updateDownloaded,
    availableVersion: availableUpdate?.version ?? null,
  };
}

// ── Event handlers ──────────────────────────────────────────────────────────

autoUpdater.on("update-available", (info: UpdateInfo) => {
  checkingForUpdate = false;
  availableUpdate = info;

  // Respect "skip this version"
  const skipped = getSkippedVersion();
  if (skipped === info.version) {
    log.info(`Update v${info.version} available but skipped by user`);
    return;
  }

  log.info(`Update available: v${info.version}`);

  // Download in the background
  downloadingUpdate = true;
  autoUpdater.downloadUpdate().catch((err) => {
    log.error("Failed to download update:", err);
    downloadingUpdate = false;
  });
});

autoUpdater.on("update-not-available", () => {
  checkingForUpdate = false;
  log.info("No updates available");
});

autoUpdater.on("download-progress", (progress) => {
  log.info(`Download progress: ${Math.round(progress.percent)}%`);
});

autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
  downloadingUpdate = false;
  updateDownloaded = true;
  log.info(`Update downloaded: v${info.version}`);

  promptToInstall(info);
});

autoUpdater.on("error", (err) => {
  checkingForUpdate = false;
  downloadingUpdate = false;
  log.error("Auto-updater error:", err);
});

// ── Prompt user to install ──────────────────────────────────────────────────

function promptToInstall(info: UpdateInfo): void {
  // Use native notification if supported, with a dialog fallback
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: "Edgebric Update Ready",
      body: `Version ${info.version} has been downloaded. Restart to update.`,
    });
    notification.on("click", () => {
      autoUpdater.quitAndInstall(false, true);
    });
    notification.show();
  }

  // Also show a dialog for discoverability
  dialog
    .showMessageBox({
      type: "info",
      title: "Update Available",
      message: `Edgebric v${info.version} is ready to install.`,
      detail: "The update has been downloaded. Restart now to apply it?",
      buttons: ["Restart Now", "Later", "Skip This Version"],
      defaultId: 0,
      cancelId: 1,
    })
    .then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall(false, true);
      } else if (response === 2) {
        setSkippedVersion(info.version);
      }
    });
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Check for updates silently on app launch.
 * Call this after the server has started.
 */
export function initAutoUpdater(): void {
  // Only check for updates in packaged builds
  if (!app.isPackaged) {
    log.info("Skipping auto-update check (development mode)");
    return;
  }

  // Respect user preference
  if (!getAutoUpdateEnabled()) {
    log.info("Auto-update disabled by user preference");
    return;
  }

  // Delay initial check to let the app settle
  setTimeout(() => {
    checkingForUpdate = true;
    autoUpdater.checkForUpdates().catch((err) => {
      checkingForUpdate = false;
      log.error("Update check failed:", err);
    });
  }, 10_000);
}

/**
 * Manually check for updates (from tray menu).
 * Shows UI feedback even when no update is available.
 */
export async function checkForUpdatesManual(): Promise<void> {
  if (downloadingUpdate) {
    dialog.showMessageBox({
      type: "info",
      title: "Update in Progress",
      message: "An update is already being downloaded.",
    });
    return;
  }

  if (updateDownloaded && availableUpdate) {
    promptToInstall(availableUpdate);
    return;
  }

  // Clear any skip preference when user explicitly checks
  clearSkippedVersion();

  try {
    checkingForUpdate = true;
    const result = await autoUpdater.checkForUpdates();
    checkingForUpdate = false;
    if (!result || !result.updateInfo || result.updateInfo.version === app.getVersion()) {
      dialog.showMessageBox({
        type: "info",
        title: "No Updates",
        message: `Edgebric v${app.getVersion()} is the latest version.`,
      });
    }
    // If an update IS available, the "update-available" event handler takes over
  } catch (err) {
    checkingForUpdate = false;
    log.error("Manual update check failed:", err);
    dialog.showMessageBox({
      type: "error",
      title: "Update Check Failed",
      message: "Could not check for updates. Please try again later.",
    });
  }
}
