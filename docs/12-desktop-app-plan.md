> **Status: CURRENT** — Audited against codebase on 2026-03-31. Phases D1-D2 complete. D3-D5 partially done or pending.

# Desktop GUI App

Last updated: 2026-03-31

---

## What This Is

A macOS Electron app with **three modes** that manages the Edgebric server lifecycle (setup, start, stop, status, logs), llama-server inference backend, and model management. The web UI opens in the user's default browser. No terminal required.

**Three app modes (one binary):**
- **Solo** — Free, no auth, single user. Full product for personal use on your own machine.
- **Admin** — Org server with OIDC/SSO. Multi-user. Free, no license required.
- **Member** — Connect to an existing Admin-mode instance on the network. Setup wizard supports it; full flow may be incomplete.

**This is NOT a full Electron app with the web UI embedded.** The web UI runs in the browser. The desktop app is a lightweight server manager + setup wizard that lives in the menu bar.

---

## Why Electron (Not Tauri)

- Entire stack is TypeScript — no Rust to learn/maintain
- Mature macOS menu bar + Tray API
- electron-builder handles DMG packaging, code signing, notarization, auto-update
- Size (~150MB) is acceptable for an app that runs in background
- Tauri saves ~140MB binary size but adds Rust toolchain + new language to a solo dev's plate

---

## Architecture

```
packages/desktop/
├── src/
│   ├── main/                  # Electron main process
│   │   ├── index.ts           # App entry — lifecycle, window management, tray creation
│   │   ├── tray.ts            # Menu bar icon + context menu
│   │   ├── server.ts          # Spawn/stop API server, health check, mDNS publishing
│   │   ├── llama-server.ts    # llama-server lifecycle (download, start, stop, auto-update, rollback)
│   │   ├── ipc.ts             # All IPC handlers (setup, models, llama-server, auth, settings, etc.)
│   │   ├── config.ts          # Read/write ~/.edgebric.json, path management
│   │   └── certs.ts           # Self-signed CA + server cert generation
│   ├── preload/
│   │   └── index.ts           # Secure bridge between main + renderer
│   └── renderer/              # Setup wizard + dashboard UI (React + Tailwind)
│       ├── App.tsx            # Router — first-run detection, wizard vs dashboard
│       └── pages/
│           ├── SetupWizard.tsx     # Multi-step: mode select, data dir, OIDC, model download
│           └── ServerDashboard.tsx # Tabs: Home (status), Models, Settings
├── resources/
│   └── icon.icns              # macOS app icon
├── electron-builder.yml       # DMG packaging config
├── package.json               # v0.5.0
├── tsconfig.json
└── vite.config.ts             # electron-vite for renderer
```

### How It Fits the Monorepo

- `packages/desktop/` is a workspace package
- Config/path logic is self-contained in `config.ts` (not imported from other packages)
- Does NOT import from `packages/api` or `packages/web` — those are separate processes
- The API server is spawned as a child process
- The web UI is opened in the system browser via `shell.openExternal`

---

## User Experience Flow

### First Launch (Fresh Install)

1. User downloads `.dmg` from website, drags to Applications
2. Double-click Edgebric.app
3. Menu bar icon appears (grey — server not running)
4. Setup wizard window opens automatically:
   - **Step 1 — Welcome**: Brief explanation
   - **Step 2 — Mode**: Choose Solo (free) / Admin (org) / Connect to existing (member/secondary)
   - **Step 3 — Data Directory**: Where to store data (default: `~/Edgebric`)
   - **Step 4 — Model**: Download default GGUF model from HuggingFace. Progress bar.
   - **Step 5 (Admin only) — Authentication**: OIDC/SSO config (6 providers: Google, Microsoft, Okta, OneLogin, Ping, generic)
   - **Step 6 (Admin only) — Admin Email**: Admin email address(es)
   - **Step 7 (Admin only) — Port/Hostname**: Network configuration
5. Setup writes `~/.edgebric.json` and `.env`
6. Self-signed TLS certificates generated (Admin mode)
7. llama-server starts automatically
8. Server starts automatically
9. Menu bar icon turns green
10. Browser opens to server URL

**Solo mode shortcut:** Steps 5-7 are skipped entirely.

### Normal Launch (Already Configured)

1. Double-click Edgebric.app (or auto-launch on login)
2. Menu bar icon appears
3. llama-server auto-update check (download newer version if available, rollback on failure)
4. Server starts automatically
5. Icon turns green when server is healthy (health endpoint check, 60s timeout)

### Menu Bar Context Menu

```
Edgebric — [Server Status]
  [Server URL(s) if running]
─────────────────────
Launch Edgebric         → opens browser if running
Dashboard               → opens main window
─────────────────────
Start Server
Stop Server
Restart Server
─────────────────────
Models...               → opens models tab
View Logs...            → opens log viewer window
Server Settings...      → opens settings tab
─────────────────────
Quit Edgebric           → stops server + llama-server + exits
```

---

## IPC Handlers (28 total)

All IPC handlers are registered in `ipc.ts`:

| Handler | Purpose |
|---|---|
| `is-first-run` | Check for .edgebric.json |
| `get-default-data-dir` | Return ~/Edgebric |
| `save-setup` | Write config + .env after wizard |
| `get-config` | Load config from disk |
| `save-settings` | Update hostname/port + .env |
| `get-status` | Server status + port + hostname |
| `get-health` | Health checks (DB, AI, vector, disk) |
| `start-server` | Spawn API server + llama-server |
| `stop-server` | Graceful shutdown |
| `read-logs` | Get last N lines of server log |
| `open-log-window` | Show log viewer window |
| `discover-instances` | mDNS discovery of other Edgebric instances |
| `get-launch-at-login` | Query system settings |
| `set-launch-at-login` | Update system + config |
| `llama-status` | Check if llama-server installed/running/version |
| `install-llama` | Download llama-server binary |
| `start-llama` | Start llama-server |
| `stop-llama` | Stop llama-server |
| `models-list` | Get installed + catalog models, system/storage info |
| `models-load` | Load model into VRAM |
| `models-unload` | Unload model from VRAM |
| `models-delete` | Delete model from disk |
| `models-pull` | Download new model from HuggingFace |
| `models-set-active` | Set default chat model |
| `models-pick-gguf` | File picker for custom GGUF |
| `models-import-gguf` | Import GGUF file as model |
| `models-search` | Search HuggingFace for GGUF models |
| ~~`validate-license`~~ | Removed — no feature gating |
| `instance-wipe` | Delete all data, reset to setup |
| `instance-reset-auth` | Clear sessions, revert to Solo mode |
| `instance-reconfigure-auth` | Change OIDC provider without wiping data |

### IPC Events (Broadcasts)

| Event | Purpose |
|---|---|
| `server-status-changed` | Server status changes → updates all windows |
| `llama-download-progress` | llama-server download → updates progress bar |
| `model-pull-progress` | Model download → updates per-model progress |
| `navigate-to` | Tray menu → switches renderer view |

---

## Server Dashboard Tabs

### Home
- Status indicator (running/stopped/error), uptime
- Health checks (database, inference, vector store, disk usage)
- Start/stop/restart buttons
- Server URL display

### Models
- Installed models list + HuggingFace model catalog
- Load/unload/delete models
- Download new models with progress
- Import custom GGUF files
- Storage breakdown (DB/uploads/GGUF models/vault)
- Active model selection

### Settings
- Hostname/port editing
- Launch at login toggle
- View logs button
- Danger zone: wipe instance, reset auth, reconfigure auth

---

## Config Structure

```typescript
interface EdgebricConfig {
  mode: "solo" | "admin" | "member";
  dataDir: string;
  port: number;
  hostname?: string;           // default: "edgebric.local"
  oidcProvider?: "google" | "microsoft" | "okta" | "onelogin" | "ping" | "generic";
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  adminEmails?: string[];
  chatBaseUrl?: string;
  chatModel?: string;
  orgServerUrl?: string;       // Member mode
  llamaAutoUpdate?: boolean;   // default: true
  launchAtLogin?: boolean;     // default: false
}
```

Saved to: `~/.edgebric.json`

---

## Development Phases

### Phase D1 — Skeleton + Tray + Server Management COMPLETE

- [x] Electron + electron-vite + React + TypeScript skeleton
- [x] Tray icon with context menu (start/stop/restart/quit/open/settings/logs)
- [x] llama-server process management (auto-download, start, stop, auto-update with rollback)
- [x] Spawn API server as child process
- [x] Health check polling (60s startup timeout)
- [x] Log viewer window (inline HTML, tail last 500 lines)
- [x] Graceful shutdown (SIGTERM then SIGKILL fallback)
- [x] mDNS publishing for .local hostnames (via bonjour-service)
- [x] Single-instance lock
- [x] Concurrent operation guard

### Phase D2 — Setup Wizard + llama-server Management MOSTLY COMPLETE

- [x] First-run detection (no ~/.edgebric.json)
- [x] Multi-step wizard (Solo/Admin/Member modes)
- [x] Data directory picker (default: ~/Edgebric)
- [x] llama-server auto-download with progress reporting
- [x] Default model download during setup
- [x] OIDC configuration (6 providers)
- [x] Admin email input
- [x] Port + hostname configuration
- [x] Config + .env generation
- [x] Auto-start after wizard
- [x] llama-server auto-update on launch (check GitHub, download, rollback on failure)
- [x] Self-signed TLS certificate generation
- [x] Settings page with hostname/port editing, danger zone
- [x] Connect mode: mDNS discovery of existing instances
- [x] Secondary node setup (mesh token + primary endpoint)
- [ ] System requirements check (RAM >= 8GB, disk >= 10GB)

### Phase D3 — Licensing REMOVED

Licensing/feature gating has been removed. All features are free. Revenue from pay-what-you-want downloads and GitHub Sponsors.

### Phase D4 — Auto-Update NOT STARTED

- [ ] electron-updater integration
- [ ] Update check on launch + "Check for Updates" menu item
- [ ] Background download + prompt to restart
- [ ] GitHub Releases or S3 hosting
- [ ] Code signing + notarization in CI

### Phase D5 — Polish + Packaging PARTIAL

- [x] electron-builder config for macOS DMG (arm64 + x64)
- [x] App icon (icns)
- [x] Launch at login toggle
- [x] Menu bar app behavior (hidden from Dock)
- [ ] DMG background image with drag-to-Applications arrow
- [ ] Apple notarization (requires Apple Developer account)
- [ ] Crash reporting
- [ ] Acknowledgments window (referenced in tray.ts but not implemented)
- [ ] Uninstall instructions

---

## Dependencies

```json
{
  "devDependencies": {
    "electron": "33.4.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^3.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0"
  },
  "dependencies": {
    "bonjour-service": "^1.3.0"
  }
}
```

**Not yet included (needed for future phases):**
- electron-updater (Phase D4)

---

## Key Implementation Notes

### Web UI is NOT Embedded

The desktop app does NOT embed the web UI in an Electron BrowserWindow. The web app runs in the user's default browser. The ONLY renderer windows are the setup wizard and server dashboard.

### llama-server Auto-Update

On app launch, checks GitHub for newer llama.cpp release. If available, downloads in background, swaps binary, restarts. If new version fails to start, automatically rolls back.

### Process Management

Two background processes managed:
1. **llama-server** — inference backend (two instances: chat on port 8080, embedding on port 8081). Downloaded and managed automatically. Started before API server.
2. **API server** — spawned as child process with environment from .env file.

PID tracking, log capture, and graceful shutdown. On quit: API server first, then llama-server instances.

---

## Open Questions

- **Bundled Node.js?** Electron ships with Node.js, but the API server currently runs via `tsx/esm`. Pre-compilation to plain JS is cleaner than bundling tsx.
- **Member mode completeness?** Setup wizard supports member/secondary, but the full end-to-end connection flow may need more testing.
- **Acknowledgments window?** Referenced in tray menu code but no implementation exists. Low priority.
