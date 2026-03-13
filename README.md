# Edgebric

Private knowledge platform for organizations. Upload sensitive documents, ask questions with AI, and get cited answers — all with privacy controls built in.

**Private knowledge. Quick access.**

## What It Does

- **Document ingestion**: Upload PDF, DOCX, TXT, MD files. Automatic extraction, chunking, and embedding.
- **RAG-powered Q&A**: Ask questions in natural language. Get answers with source citations.
- **Privacy modes**: Standard (anonymous analytics), Private (no identity tracking), Vault (on-device only).
- **Multi-org**: Each organization's data is fully isolated. Users can belong to multiple orgs.
- **Knowledge base management**: Organize documents into KBs with per-KB access control (whole org or restricted by user).
- **Escalation flow**: Employees can request human verification on AI answers. Admins get notified via Slack or email and can reply directly.
- **Admin dashboard**: Analytics, document management, user/member management, escalation log, integration settings.

## Architecture

Monorepo with four packages:

| Package | Description |
|---------|-------------|
| `packages/api` | Express API server (TypeScript, SQLite via Drizzle ORM) |
| `packages/web` | Vite + React + TanStack Router frontend |
| `packages/core` | RAG orchestrator, system prompt, PII detection |
| `packages/edge` | mimik edge platform clients (mILM, mKB) |
| `shared/types` | Shared TypeScript types |

### Key tech choices

- **Auth**: OIDC/SSO (Google for dev, any OIDC provider for prod)
- **Sessions**: httpOnly cookies with session-file-store
- **AI**: OpenAI-compatible API (Qwen 3.5-4B via llama-server, or mimik mILM)
- **Embeddings**: nomic-embed-text (768-dim) via mimik mKB
- **Storage**: SQLite (Drizzle ORM) for metadata, mKB for vector search
- **Frontend**: Vite, React 18, TailwindCSS, shadcn/ui components

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- Python 3.10+ with `docling` (for PDF extraction)
- An OIDC provider (Google OAuth for dev)
- llama-server with a GGUF model (e.g., Qwen 3.5-4B)
- mimik edgeEngine with mKB + mILM (optional — can use llama-server alone)

### Setup

```bash
# Install dependencies
pnpm install

# Configure environment
cp packages/api/.env.example packages/api/.env
# Edit .env with your OIDC credentials, model paths, etc.

# Start the API server
cd packages/api
node --import=tsx/esm src/server.ts

# Start the web frontend (separate terminal)
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
| `CHAT_BASE_URL` | LLM endpoint (e.g., `http://127.0.0.1:8080/v1`) |
| `CHAT_MODEL` | Model name for chat completions |
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
      services/     # Data access layer (stores)
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
shared/
  types/
    src/            # Shared TypeScript interfaces
docs/               # Product documentation (overview, users, features, technical, etc.)
```

## License

Proprietary. All rights reserved.
