# Desktop GUI App — Development Plan

Last updated: 2026-03-20

---

## What This Is

A macOS menu bar app that replaces the CLI for non-technical users. It manages the Edgebric server lifecycle (setup, start, stop, status, logs) and opens the web UI in the user's default browser. No terminal required.

**This is NOT a full Electron app with the web UI embedded.** The web UI already runs in the browser. The desktop app is a lightweight server manager + setup wizard that lives in the menu bar.

---

## Why Electron (Not Tauri)

- Entire stack is TypeScript — no Rust to learn/maintain
- Can directly reuse CLI logic from `packages/cli/src/lib/`
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
│   │   ├── index.ts           # App entry — tray, lifecycle, IPC handlers
│   │   ├── tray.ts            # Menu bar icon + context menu
│   │   ├── server.ts          # Spawn/stop API server (reuse CLI logic)
│   │   ├── setup.ts           # First-run setup wizard IPC handlers
│   │   ├── updater.ts         # Auto-update check (electron-updater)
│   │   ├── licensing.ts       # License key validation (LemonSqueezy/Paddle API)
│   │   └── config.ts          # Read/write ~/Edgebric/.edgebric.json (reuse from CLI)
│   ├── preload/
│   │   └── index.ts           # Secure bridge between main + renderer
│   └── renderer/              # Setup wizard + settings UI (React)
│       ├── App.tsx
│       ├── pages/
│       │   ├── SetupWizard.tsx     # First-run: data dir, OIDC, admin email, port
│       │   ├── Trial.tsx           # Trial status, days remaining, buy/activate
│       │   ├── Activate.tsx        # Enter license key
│       │   └── Settings.tsx        # Change config, view logs, about
│       └── components/
│           └── ...                 # Shared UI components (minimal — this is a small app)
├── assets/
│   ├── icon.png               # Menu bar icon (template image for macOS)
│   ├── icon-running.png       # Green dot variant when server is running
│   └── icon.icns              # macOS app icon
├── electron-builder.yml       # DMG packaging, code signing, notarization config
├── package.json
├── tsconfig.json
└── vite.config.ts             # Vite for renderer process (same stack as web app)
```

### How It Fits the Monorepo

- `packages/desktop/` is a new workspace package
- Imports shared config/path logic from `packages/cli/src/lib/` (or extract to shared util)
- Does NOT import from `packages/api` or `packages/web` — those are separate processes
- The API server is spawned as a child process, same as the CLI does today
- The web UI is opened in the system browser via `shell.openExternal('http://localhost:PORT')`

---

## User Experience Flow

### First Launch (Fresh Install)

1. User downloads `.dmg` from website, drags to Applications
2. Double-click Edgebric.app
3. Menu bar icon appears (grey — server not running)
4. Setup wizard window opens automatically:
   - **Step 1 — Welcome**: Brief explanation, system requirements check (RAM, disk space)
   - **Step 2 — Data Directory**: Where to store data (default: `~/Edgebric`)
   - **Step 3 — Authentication**: OIDC/SSO config (issuer URL, client ID, secret). Link to guide for Google/Okta/Auth0 setup.
   - **Step 4 — Admin**: Admin email address(es)
   - **Step 5 — Activate**: Enter license key, start subscription, or begin 30-day trial
5. Setup writes `~/Edgebric/.edgebric.json` and `.env` (same as CLI setup)
6. Server starts automatically
7. Menu bar icon turns green
8. Browser opens to `http://localhost:3001`

### Normal Launch (Already Configured)

1. Double-click Edgebric.app (or auto-launch on login)
2. Menu bar icon appears
3. Server starts automatically
4. Icon turns green when server is healthy (health endpoint check)

### Menu Bar Context Menu

```
Edgebric
─────────────────────
● Server Running          (status indicator)
  Port 3001
─────────────────────
Open Edgebric             → opens browser to localhost:PORT
─────────────────────
Start Server
Stop Server
Restart Server
─────────────────────
View Logs...              → opens log viewer window
Settings...               → opens settings window
─────────────────────
License: Pro (v1.2)       (or "Trial: 18 days left")
─────────────────────
Check for Updates...
About Edgebric
Quit Edgebric             → stops server + quits app
```

### Trial Expiry

- Menu bar shows trial days remaining
- At 7 days: gentle reminder notification
- At 1 day: stronger reminder
- At 0 days: server still starts but web UI shows activation overlay (can't dismiss without key or subscription)
- Trial state stored locally in config file (not phoning home — offline-compatible)

---

## Development Phases

### Phase D1 — Skeleton + Tray + Server Management

**Goal:** Menu bar app that starts/stops the API server. No wizard, no licensing.

- [ ] Initialize `packages/desktop/` with Electron + Vite + React + TypeScript
- [ ] Tray icon with context menu (start/stop/restart/quit)
- [ ] Spawn API server as child process (port from config or default 3001)
- [ ] Health check polling (GET /api/health) — update icon green/grey/red
- [ ] "Open Edgebric" menu item → `shell.openExternal`
- [ ] Stdout/stderr capture for log viewing
- [ ] Graceful shutdown on quit (SIGTERM to child process)
- [ ] Basic log viewer window (tail last 100 lines)

**Reuse from CLI:**
- `packages/cli/src/lib/paths.ts` → config/PID/log file paths
- `packages/cli/src/commands/start.ts` → server spawn logic
- `packages/cli/src/commands/stop.ts` → graceful stop logic

### Phase D2 — Setup Wizard

**Goal:** First-run GUI setup replaces CLI `edgebric setup`.

- [ ] Detect first run (no `~/Edgebric/.edgebric.json`)
- [ ] Multi-step wizard window (React, styled with Tailwind + shadcn)
- [ ] System requirements check (RAM ≥ 16GB, disk space ≥ 20GB free)
- [ ] Data directory picker (native folder dialog)
- [ ] OIDC configuration form with inline help/links
- [ ] Admin email input
- [ ] Port selection (default 3001, check if port available)
- [ ] Write config + .env on completion
- [ ] Auto-start server after wizard completes

### Phase D3 — Trial + Licensing

**Goal:** 30-day trial enforcement + license key activation.

- [ ] Trial start timestamp in config (set on first setup completion)
- [ ] Days-remaining calculation (offline — no server check needed)
- [ ] Trial status in menu bar and settings
- [ ] License activation window (enter key → validate against LemonSqueezy/Paddle API)
- [ ] Subscription activation (redirect to payment page → callback with key)
- [ ] License status persistence in config
- [ ] Trial expiry enforcement (activation overlay on web UI after 30 days)
- [ ] Periodic license revalidation for subscriptions (check on app launch, graceful offline handling)

### Phase D4 — Auto-Update

**Goal:** Seamless updates within the major version.

- [ ] electron-updater integration
- [ ] Update check on launch + manual "Check for Updates" menu item
- [ ] Download + install in background, prompt to restart
- [ ] Update channel: stable only (no beta channel for now)
- [ ] Update server: GitHub Releases or static file hosting (S3/Cloudflare R2)
- [ ] Code signing + notarization in CI (GitHub Actions)

### Phase D5 — Polish + Packaging

**Goal:** Production-ready DMG for distribution.

- [ ] electron-builder config for macOS DMG
- [ ] App icon (all required sizes)
- [ ] DMG background image with drag-to-Applications arrow
- [ ] Apple notarization (requires Apple Developer account)
- [ ] Launch at login toggle (in settings)
- [ ] macOS Dock behavior: hide from Dock (menu bar app only)
- [ ] First-launch macOS permission prompts (if any)
- [ ] Crash reporting (simple — write crash log to data dir)
- [ ] Uninstall instructions in settings/help

---

## Key Implementation Details

### Server Process Management

The desktop app spawns the API server the same way the CLI does — as a child process:

```typescript
// Pseudocode — actual implementation in packages/desktop/src/main/server.ts
import { spawn } from 'child_process';

const serverProcess = spawn('node', [
  '--import=tsx/esm',
  'packages/api/src/server.ts'
], {
  env: { ...process.env, ...loadEnvFile() },
  cwd: projectRoot
});
```

PID tracking, log capture, and graceful shutdown all follow the existing CLI patterns.

### Config Sharing with CLI

Both CLI and desktop app read/write the same config files:
- `~/Edgebric/.edgebric.json` — app config
- `~/Edgebric/.env` — server environment
- `~/Edgebric/.edgebric.pid` — PID file
- `~/Edgebric/edgebric.log` — server logs

A user can switch between CLI and desktop app freely. They manage the same server instance.

### License Validation (Offline-First)

- License key is a cryptographically signed token (issued by LemonSqueezy/Paddle)
- On activation: validate online, store key + activation timestamp in config
- On subsequent launches: validate signature locally (no network needed)
- For subscriptions: periodic online check (on app launch if internet available, grace period if offline)
- Trial: purely local timestamp — no phoning home during trial

### Web UI is NOT Embedded

The desktop app does NOT embed the web UI in an Electron BrowserWindow. Reasons:
- The web app is already built for the browser and works great there
- Embedding adds complexity (CORS, cookie handling, auth flow differences)
- Users expect browser features (tabs, bookmarks, password managers)
- Reduces Electron's resource footprint (no renderer for the main UI)

The ONLY renderer windows are: setup wizard, settings, log viewer, license activation. These are small, purpose-built windows.

---

## Dependencies

```json
{
  "devDependencies": {
    "electron": "^34.x",
    "electron-builder": "^25.x",
    "vite": "^6.x",
    "@vitejs/plugin-react": "^4.x",
    "vite-plugin-electron": "^0.28.x"
  },
  "dependencies": {
    "electron-updater": "^6.x",
    "electron-store": "^10.x"
  }
}
```

Minimal dependencies. The renderer uses the same React + Tailwind + shadcn stack as the web app for visual consistency.

---

## Order of Work

```
D1: Tray + server management         ← start here (core functionality)
D2: Setup wizard                      ← makes it usable by non-technical people
D3: Trial + licensing                 ← required before any distribution
D4: Auto-update                       ← required before public launch
D5: Polish + DMG packaging            ← required before public launch
```

D1 and D2 are needed for v0.5 beta. D3-D5 are needed before any paid distribution.

---

## Open Questions

- **Extract shared lib?** CLI and desktop both need config/path logic. Extract `packages/cli/src/lib/` to a shared package, or just import across workspace packages?
- **Bundled Node.js?** Electron ships with Node.js, but the API server currently runs via `tsx/esm`. Need to either: (a) pre-compile the API server to plain JS, or (b) bundle tsx as a dependency in the desktop app. Pre-compilation is cleaner.
- **Model downloads?** The setup wizard should probably handle downloading the AI model (Qwen3.5-4B GGUF). This is a ~2.6GB download. Need progress UI. Or defer to first-launch of web UI.
- **mimik runtime bundling?** Currently mim OE is in `scripts/binaries/`. The desktop app needs to either bundle it or download it during setup. Licensing implications with mimik need clarification.
