# Installation & First Run

Edgebric is a private knowledge platform that runs entirely on your Mac. Upload documents, ask questions with AI, and get cited answers — nothing leaves your machine.

## System Requirements

| | Minimum | Recommended |
|---|---|---|
| **OS** | macOS (Apple Silicon) | macOS (Apple Silicon) |
| **RAM** | 16 GB | 24 GB |
| **Disk** | 20 GB free | 50 GB free |
| **Hardware** | Any Apple Silicon Mac | Mac Mini M4 24 GB ($699) |
| **Use case** | Personal use | Org / team server |

## Install

### Option 1: Download the App (recommended)

1. Go to [edgebric.com](https://edgebric.com)
2. Download the `.dmg` file
3. Drag **Edgebric** to your Applications folder
4. Double-click to launch

That's it. No terminal, no configuration.

### Option 2: One-Line Install

Open Terminal and run:

```bash
curl -fsSL https://edgebric.com/install.sh | bash
```

This checks prerequisites, clones the repo, builds everything, and launches the desktop app. You can customize the install directory:

```bash
curl -fsSL https://edgebric.com/install.sh | bash -s -- --dir ~/my-edgebric
```

### Option 3: Build from Source

For developers who want to build Edgebric themselves.

**Prerequisites:**

- macOS (Apple Silicon recommended, Intel supported)
- Node.js 20+
- pnpm 10+
- Python 3.10+ with `docling` (optional, for PDF extraction)

```bash
git clone https://github.com/jerv/edgebric.git
cd edgebric
pnpm install
pnpm build

# Launch the desktop app
cd packages/desktop
pnpm dev
```

## First Launch

When you open Edgebric for the first time, a setup wizard walks you through configuration.

### Step 1: Choose Your Mode

Edgebric offers three modes:

| Mode | Who it's for | Login required? |
|------|-------------|-----------------|
| **Solo** | Just you, on your own Mac | No |
| **Admin** | You're setting up a server for your team or family | Yes (OIDC/SSO) |
| **Connect** | You're joining an existing Edgebric server on your network | Yes |

**Solo mode** is the quickest path — no login setup, no network configuration. You can switch to Admin mode later.

### Step 2: Choose a Data Directory

Edgebric stores documents and AI models locally. The default location is `~/Edgebric`. You can change this during setup.

### Step 3: Download a Model

Edgebric downloads a default AI model (Qwen 3.5 4B, about 2.6 GB) from HuggingFace. A progress bar shows the download status. You can change or add models later — see [Choosing Models](/guide/models).

### Step 4: Authentication (Admin Mode Only)

If you chose Admin mode, you'll configure an identity provider (Google or Microsoft) so your team members can sign in. See [Authentication Setup](/admin/auth) for detailed instructions.

### Step 5: AI Engine & Preferences

The final step lets you download the local AI engine and configure two preferences:

- **Launch at Login** — Start Edgebric automatically when you log in (recommended).
- **Automatic Updates** — Check for updates when Edgebric starts. You can always check manually from the tray menu or Settings.

Both default to on. You can change these later in **Dashboard > Settings**.

### Step 6: Ready

Once setup completes:

- The Edgebric icon appears in your menu bar (green = running)
- Your browser opens to the Edgebric web interface
- You're ready to [create your first data source](/guide/data-sources)

## Menu Bar App

Edgebric runs as a macOS menu bar application. The tray icon shows the current status:

- **Grey** — Edgebric is not running
- **Green** — Everything is healthy
- **Yellow** — Starting up or a service needs attention

Click the icon to:

- Open the web interface
- View server status
- Check for updates / restart to update
- Restart services
- Quit Edgebric

## Updates

Edgebric checks for updates automatically on startup (if enabled). You can also check manually via the tray menu or **Dashboard > Settings > Updates**.

When an update is available, Edgebric downloads it in the background and prompts you to restart. You can skip a version if you prefer.

To disable automatic checks, toggle **Automatic Updates** off in Settings. Manual checks via "Check for Updates" still work when auto-update is off.

::: tip CLI / Docker users
The desktop auto-updater only runs in packaged Electron builds. If you run from source or Docker, pull updates via `git pull` or `docker pull`. The updater gracefully no-ops in non-packaged environments.
:::

## Next Steps

- [Choose and install AI models](/guide/models)
- [Create data sources and upload documents](/guide/data-sources)
- [Ask your first question](/guide/querying)
