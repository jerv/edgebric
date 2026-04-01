> **Status: CURRENT** — Branch strategy (main/dev) matches actual git setup. CI/CD details may be aspirational if not yet configured.

# Development & Deployment Pipeline

This document explains how code moves from your editor to production. Follow this process for every change.

---

## Branch Strategy

```
main ─────────────────────── production (stable, tested, deployed)
  │
  └── dev ────────────────── daily development (your working branch)
        │
        └── feature/xyz ──── big changes (optional, for multi-day work)
```

**Rules:**

1. **Do daily work on `dev`**. Commit freely, push often.
2. **When `dev` is stable**, merge it into `main` via a pull request.
3. **`main` is always deployable**. Never push broken code directly to `main`.
4. **For big features** (multi-day work, risky changes), branch off `dev` → PR back into `dev`.

**Quick reference:**

```bash
# Start a new feature
git checkout dev
git checkout -b feature/data-source-permissions

# When done, push and create a PR to dev
git push -u origin feature/data-source-permissions
gh pr create --base dev

# When dev is stable, create a PR to main
gh pr create --base main --head dev
```

---

## What Happens Automatically (CI/CD)

### On Every Push / Pull Request

**Workflow:** `.github/workflows/ci.yml`

```
Push or PR to dev/main
  → Install dependencies (pnpm install --frozen-lockfile)
  → Lint (ESLint — catches code style issues)
  → Typecheck (tsc — catches type errors)
  → Test (vitest — runs unit tests)
  → Build (compiles TypeScript + bundles frontend)
```

If any step fails, the PR gets a red X and you can't merge. Fix the issue first.

### On Push to `dev` or `main`

**Workflow:** `.github/workflows/docker.yml`

```
Push to dev   → Build Docker image → Push as ghcr.io/jerv/edgebric:dev
Push to main  → Build Docker image → Push as ghcr.io/jerv/edgebric:latest
```

This means there's always a fresh Docker image matching the latest code on each branch.

### On Version Tag (Releases)

**Workflow:** `.github/workflows/release.yml`

```
git tag v1.0.0 && git push --tags
  → Build Docker image → Push as ghcr.io/jerv/edgebric:1.0.0
  → Create GitHub Release with changelog
  → Attach .tar.gz artifact (for Homebrew formula)
```

---

## How to Release a New Version

1. Make sure `main` is stable (all CI checks pass).
2. Update the version in `package.json`:
   ```bash
   # In root package.json, change "version": "0.0.1" to "0.1.0"
   ```
3. Commit and tag:
   ```bash
   git commit -am "release: v0.1.0"
   git tag v0.1.0
   git push origin main --tags
   ```
4. GitHub Actions will automatically:
   - Build and push a Docker image tagged `0.1.0`
   - Create a GitHub Release with auto-generated changelog
   - Attach the distributable `.tar.gz`

**Version numbers follow [Semantic Versioning](https://semver.org/):**
- `0.x.y` — pre-1.0, anything can change
- `1.0.0` — first stable release
- Patch (`1.0.1`) — bug fixes
- Minor (`1.1.0`) — new features, backwards compatible
- Major (`2.0.0`) — breaking changes

---

## Environments

### Development (your laptop)

```bash
# Start everything locally
pnpm dev
```

- API runs on `http://localhost:3001`
- Web runs on `http://localhost:5173` (Vite dev server with hot reload)
- Config: `packages/api/.env` (copy from `.env.example`)
- Database: local SQLite in `packages/api/data/`
- Chat model: Ollama on `localhost:11434` (auto-managed by desktop app)

### Development (Docker)

```bash
# Build and run in Docker (same machine)
docker compose up --build
```

- Uses `docker-compose.yml`
- Builds from local source code
- `NODE_ENV=development`
- Reads config from `packages/api/.env`
- Reaches host services via `host.docker.internal`

### Production (Docker)

```bash
# Pull the latest image and run
docker compose -f docker-compose.prod.yml up -d
```

- Uses `docker-compose.prod.yml`
- Pulls pre-built image from `ghcr.io/jerv/edgebric:latest`
- `NODE_ENV=production` (strict mode)
- Reads config from `.env.production` (copy from `.env.production.example`)
- Health check enabled (Docker auto-restarts on failure)
- Secure cookies, no debug info in errors

**Key differences between dev and prod:**

| Setting | Development | Production |
|---|---|---|
| `NODE_ENV` | development | production |
| Session secret | dev default OK | **required**, server refuses to start without it |
| Cookies | `secure: false` | `secure: true` (HTTPS only) |
| CORS | localhost variants allowed | only `FRONTEND_URL` |
| Error responses | includes `message` field | generic "Internal server error" |
| HSTS header | disabled | enabled (1 year) |
| Docker image | built locally | pulled from registry |
| Restart policy | unless-stopped | always |
| Health check | none | every 30s |

---

## Docker Images

Images are stored in GitHub Container Registry (free for public repos):

```
ghcr.io/jerv/edgebric:dev       ← latest dev branch build
ghcr.io/jerv/edgebric:latest    ← latest main branch build
ghcr.io/jerv/edgebric:1.0.0     ← specific version (immutable)
ghcr.io/jerv/edgebric:abc1234   ← specific commit SHA
```

To pull and run a specific version:

```bash
# Pin to a version (recommended for production)
docker pull ghcr.io/jerv/edgebric:1.0.0

# Or use latest (tracks main branch)
docker pull ghcr.io/jerv/edgebric:latest
```

---

## File Reference

```
.github/workflows/
├── ci.yml              # Lint, typecheck, test, build (every push/PR)
├── docker.yml          # Build & push Docker image (push to dev/main/tag)
└── release.yml         # Create GitHub Release (on version tag)

docker-compose.yml          # Dev: build from source, relaxed settings
docker-compose.prod.yml     # Prod: pre-built image, strict settings, health check

packages/api/.env.example       # Template for local dev environment
.env.production.example         # Template for production environment

Dockerfile                  # Multi-stage build (deps → build → runtime)
.dockerignore               # Files excluded from Docker build context
```

---

## Common Tasks

### "I want to deploy a fix to production"

```bash
# 1. Fix the issue on dev
git checkout dev
# ... make changes, test locally ...
git commit -am "fix: description of fix"
git push

# 2. Wait for CI to pass (green check on GitHub)

# 3. Merge dev → main
gh pr create --base main --head dev --title "Deploy: fix description"
# Review, then merge

# 4. Docker image auto-builds and pushes as :latest

# 5. On the production server:
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### "I want to roll back production"

```bash
# On the production server, use a specific version tag:
# Edit docker-compose.prod.yml: image: ghcr.io/jerv/edgebric:0.1.0
docker compose -f docker-compose.prod.yml up -d
```

### "I want to see what's running"

```bash
docker compose -f docker-compose.prod.yml ps      # container status
docker compose -f docker-compose.prod.yml logs -f  # live logs
curl http://localhost:3001/api/health              # health check
```

### "I want to back up the database"

```bash
# SQLite database is in the Docker volume
docker compose -f docker-compose.prod.yml exec edgebric \
  cp /app/data/edgebric.db /app/data/edgebric.db.backup

# Or copy it out of the container
docker cp $(docker compose -f docker-compose.prod.yml ps -q edgebric):/app/data/edgebric.db ./backup.db
```
