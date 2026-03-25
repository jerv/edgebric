# Edgebric

Private knowledge platform for organizations. Upload sensitive documents, ask questions with AI, and get cited answers — all with privacy controls built in.

**Private knowledge. Quick access.**

## What It Does

- **Document ingestion**: Upload PDF, DOCX, TXT, MD files. Automatic extraction, chunking, and embedding.
- **RAG-powered Q&A**: Ask questions in natural language. Get answers with source citations.
- **Privacy modes**: Standard (anonymous analytics), Private (no identity tracking), Vault (on-device only).
- **Multi-org**: Each organization's data is fully isolated. Users can belong to multiple orgs.
- **Knowledge base management**: Organize documents into KBs with per-KB access control (whole org or restricted by user).
- **Admin dashboard**: Document management, user/member management, model management, service status, organization settings.

## Architecture

Monorepo with five packages:

| Package | Description |
|---------|-------------|
| `packages/api` | Express API server (TypeScript, SQLite via Drizzle ORM) |
| `packages/web` | Vite + React + TanStack Router frontend |
| `packages/core` | RAG orchestrator, system prompt, PII detection |
| `packages/edge` | mimik edge platform clients (mILM, mKB) |
| `packages/desktop` | Electron menu bar app — server manager, setup wizard, tray icon |
| `shared/types` | Shared TypeScript types (including model catalog) |

### Key tech choices

- **Auth**: OIDC/SSO (Google for dev, any OIDC provider for prod)
- **Sessions**: httpOnly cookies with session-file-store
- **AI**: Ollama-managed models (Qwen 3 4B default, supports any Ollama model). OpenAI-compatible API.
- **Embeddings**: nomic-embed-text (768-dim) via Ollama or mimik mKB
- **Storage**: SQLite (Drizzle ORM) for metadata, mKB for vector search
- **Frontend**: Vite, React 18, TailwindCSS, shadcn/ui components

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- Python 3.10+ with `docling` (for PDF extraction)
- An OIDC provider (Google OAuth for dev) — not needed for Solo mode
- Ollama (auto-managed by desktop app, or install manually)
- mimik edgeEngine with mKB + mILM (optional — can use Ollama alone)

### Setup (Desktop App — recommended)

```bash
# Install dependencies
pnpm install

# Start the desktop app (manages Ollama + API server automatically)
cd packages/desktop
pnpm dev
```

The desktop app handles setup, Ollama lifecycle, and server management. Open the web UI from the tray menu or navigate to `https://localhost:3001`.

### Setup (Manual)

```bash
# Install dependencies
pnpm install

# Configure environment
cp packages/api/.env.example packages/api/.env
# Edit .env with your OIDC credentials, model paths, etc.

# Start Ollama (if not using desktop app)
ollama serve

# Start the API server
cd packages/api
node --import=tsx/esm src/server.ts

# Start the web frontend (separate terminal, for development)
cd packages/web
pnpm dev
```

### Environment Variables (packages/api/.env)

| Variable | Description |
|----------|-------------|
| `OIDC_ISSUER` | OIDC provider URL (e.g., `https://accounts.google.com`) |
| `OIDC_CLIENT_ID` | OAuth client ID |
| `OIDC_CLIENT_SECRET` | OAuth client secret |
| `OIDC_REDIRECT_URI` | Callback URL (e.g., `http://localhost:3001/api/auth/callback`) |
| `FRONTEND_URL` | Frontend URL for redirects (e.g., `http://localhost:5173`) |
| `ADMIN_EMAILS` | Comma-separated admin email addresses |
| `SESSION_SECRET` | Secret for signing session cookies |
| `CHAT_BASE_URL` | LLM endpoint (default: `http://localhost:11434/v1` for Ollama) |
| `CHAT_MODEL` | Model name for chat completions (default: `qwen3:4b`) |
| `OLLAMA_BASE_URL` | Ollama API endpoint (default: `http://localhost:11434`) |
| `MIMIK_BASE_URL` | mimik edgeEngine URL (default: `http://localhost:8083`) |
| `MIMIK_API_KEY` | mimik API key for mILM/mKB |

## Project Structure

```
packages/
  api/
    src/
      db/           # SQLite schema and connection (Drizzle ORM)
      middleware/    # Auth guards (requireAuth, requireOrg, requireAdmin)
      routes/       # Express route handlers
      services/     # Data access layer (stores), including ollamaClient
      jobs/         # Background jobs (document ingestion)
      lib/          # Logger, utilities
  web/
    src/
      components/   # React components (admin/, employee/, layout/, shared/)
      contexts/     # React contexts (UserContext, PrivacyContext)
      routes/       # TanStack Router file-based routes
      lib/          # Utilities, content helpers
  core/
    src/
      rag/          # RAG orchestrator, system prompt, query filter
  edge/
    src/            # mimik mILM and mKB HTTP clients
  desktop/
    src/
      main/         # Electron main process (tray, server, ollama, config, IPC)
      preload/      # Context bridge (secure IPC)
      renderer/     # Setup wizard + server dashboard (React)
    resources/      # App icon (icns), tray icons (Template PNGs)
shared/
  types/
    src/            # Shared TypeScript interfaces + model catalog
docs/               # Product documentation
scripts/            # Dev utilities (restart-desktop.sh)
```

## License

Proprietary. All rights reserved.
