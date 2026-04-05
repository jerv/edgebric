# Development Setup

This guide walks you through setting up Edgebric for local development.

## Prerequisites

- **macOS** (Apple Silicon recommended, Intel supported)
- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **pnpm 10+** — Install with `npm install -g pnpm`
- **Python 3.10+** with `docling` — For PDF extraction (optional)
- **Git**

## Clone and Install

```bash
git clone https://github.com/jerv/edgebric.git
cd edgebric
pnpm install
```

## Project Structure

Edgebric is a pnpm monorepo with four packages and a shared types library:

```
app/
├── packages/
│   ├── api/            # Express backend (TypeScript, SQLite, Drizzle ORM)
│   ├── web/            # React frontend (Vite, TanStack Router, shadcn/ui)
│   ├── core/           # RAG orchestrator, ingestion, PII detection
│   └── desktop/        # Electron menu bar app (macOS)
├── shared/types/       # Shared TypeScript type definitions
├── docs-site/          # This documentation site (VitePress)
├── e2e/                # Playwright E2E tests
└── docs/               # Internal planning documents
```

### Package Overview

| Package | What it does |
|---------|-------------|
| `@edgebric/api` | Express 4 REST API. SQLite database via Drizzle ORM. Handles auth, data sources, queries, mesh networking, group chats, and the Agent API. |
| `@edgebric/web` | React 18 SPA. TanStack Router (file-based routing), TanStack Query for data fetching, TailwindCSS + shadcn/ui for components. |
| `@edgebric/core` | Zero-dependency business logic. RAG pipeline, system prompt construction, PII detection, context summarization. |
| `@edgebric/desktop` | Electron app that manages llama-server lifecycle, API server, and setup wizard. The only entry point for users. |
| `@edgebric/types` | Shared TypeScript interfaces, model catalog, Zod schemas. |

## Build

```bash
# Build all packages
pnpm build

# Build a specific package
pnpm --filter @edgebric/api build
pnpm --filter @edgebric/web build
```

## Running the App

::: warning Important
The desktop app is the **only** entry point. Don't start the API or web dev servers separately — the desktop app manages everything.
:::

```bash
cd packages/desktop
pnpm dev
```

This starts the Electron app, which:

1. Launches llama-server (chat + embedding models)
2. Starts the API server
3. Opens the web UI

### Restarting After Changes

After making code changes:

```bash
# Rebuild web first, then restart
cd packages/web && pnpm build && cd ../..
./scripts/restart-desktop.sh
```

## Environment Variables

For development, copy the example env file:

```bash
cp packages/api/.env.example packages/api/.env
```

Key variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `OIDC_ISSUER` | Identity provider URL | - |
| `OIDC_CLIENT_ID` | OAuth client ID | - |
| `OIDC_CLIENT_SECRET` | OAuth client secret | - |
| `OIDC_REDIRECT_URI` | Auth callback URL | `http://localhost:3001/api/auth/callback` |
| `FRONTEND_URL` | Frontend URL | `http://localhost:5173` |
| `ADMIN_EMAILS` | Admin email addresses | - |
| `SESSION_SECRET` | Cookie signing secret | - |
| `INFERENCE_CHAT_URL` | llama-server chat URL | `http://localhost:8080` |
| `INFERENCE_EMBEDDING_URL` | llama-server embedding URL | `http://localhost:8081` |

## Development Workflow

1. Create a feature branch from `dev`:
   ```bash
   git checkout dev
   git checkout -b feature/your-feature
   ```

2. Make your changes

3. Run checks:
   ```bash
   pnpm lint        # ESLint
   pnpm typecheck   # TypeScript
   pnpm test        # Vitest unit tests
   ```

4. Commit with a descriptive message

5. Open a PR against `dev`

## Useful Commands

```bash
pnpm build          # Build all packages
pnpm test           # Run unit tests
pnpm test:e2e       # Run Playwright E2E tests
pnpm lint           # Run ESLint
pnpm typecheck      # TypeScript type checking
```

## Internal Planning Documents

For detailed architecture decisions and project history, see the [internal planning docs](https://github.com/jerv/edgebric/tree/main/docs). These are internal documents not intended for end users, but they provide valuable context for contributors.
