# Edgebric

**Private knowledge platform for individuals and organizations.** Upload sensitive documents, ask questions with AI, and get cited answers — all running on your own hardware. Zero data leaves the building.

Whether you're a solo consultant managing client files, a small law firm with confidential case documents, or a 200-person company with department-level data isolation needs — Edgebric runs locally on a single Mac and scales from one user to hundreds.

> *"Data never moves. Queries move."*

---

**Just want to install it?** You don't need any of what's below. Head to [edgebric.com](https://edgebric.com) to download a ready-to-use installer for macOS. No terminal, no setup — just download and run.

---

## Free to use. Pay if you want to support development.

Edgebric is source-available under the [Business Source License 1.1](LICENSE). You are free to use it for personal or internal business purposes at no cost. Clone it, build it, run it — no restrictions on usage.

If you find it useful, consider downloading from [edgebric.com](https://edgebric.com) — it's pay-what-you-want and directly supports continued development. But it's not required.

**What you can't do:** repackage, rebrand, or sell Edgebric or derivative works. See the [full license](LICENSE) for details.

## What It Does

- **Document ingestion**: Upload PDF, DOCX, TXT, MD files. Automatic extraction, chunking, and embedding.
- **RAG-powered Q&A**: Ask questions in natural language. Get answers with source citations.
- **Cloud integrations**: Sync documents from Google Drive (OneDrive, Dropbox, Notion, Confluence coming soon). Documents are pulled to your local machine — never stored in the cloud.
- **Privacy modes**: Standard (anonymous analytics), Private (no identity tracking), Vault (on-device only).
- **SSO / OIDC authentication**: Sign in with Google, Okta, Auth0, or any OIDC provider. Not needed for Solo mode.
- **Multi-org**: Each organization's data is fully isolated. Users can belong to multiple orgs.
- **Data source management**: Organize documents into data sources with per-source access control.
- **Admin dashboard**: Document management, user/member management, model management, service status, organization settings.
- **Group chats**: Collaborative conversations with @bot querying, threads, and source sharing.
- **Desktop app**: macOS menu bar app that manages Ollama, the API server, and setup — all from the tray.

## Who It's For

- **Solo professionals**: Consultants, freelancers, and independent practitioners with sensitive client documents
- **Small businesses**: Law firms, medical practices, accounting firms, HR departments — anyone handling confidential information
- **Teams and departments**: Organizations that need department-level data isolation enforced by architecture, not just access controls
- **Privacy-conscious orgs**: Companies in regulated industries (healthcare, legal, finance) where data residency is non-negotiable

## Architecture

Monorepo with four packages:

| Package | Description |
|---------|-------------|
| `packages/api` | Express API server (TypeScript, SQLite via Drizzle ORM) |
| `packages/web` | Vite + React + TanStack Router frontend |
| `packages/core` | RAG orchestrator, system prompt, PII detection |
| `packages/desktop` | Electron menu bar app — server manager, setup wizard, tray icon |
| `shared/types` | Shared TypeScript types (including model catalog) |

### Key tech

- **AI**: Ollama for local inference (Qwen 3 4B default, supports any Ollama model)
- **Embeddings**: nomic-embed-text (768-dim) via Ollama
- **Vector search**: sqlite-vec (embedded in SQLite) with BM25 hybrid retrieval (FTS5 + Reciprocal Rank Fusion)
- **Storage**: SQLite (Drizzle ORM) — metadata, vectors, and full-text search in one file
- **Auth**: OIDC/SSO (any provider — Google, Okta, Auth0, etc.). Not needed for Solo mode.
- **Frontend**: Vite, React 18, TailwindCSS, shadcn/ui

## Hardware Requirements

| | Minimum | Recommended |
|---|---|---|
| **OS** | macOS (Apple Silicon) | macOS (Apple Silicon) |
| **RAM** | 16GB | 24GB |
| **Disk** | 20GB free | 50GB free |
| **Hardware** | Any Apple Silicon Mac | Mac Mini M4 24GB ($699) |
| **Use case** | Personal / vault use | Org server (100-200 daily users) |

## Building from Source

### Prerequisites

- Node.js 20+
- pnpm 9+
- Python 3.10+ with `docling` (for PDF extraction)
- Ollama (auto-managed by desktop app, or install manually)
- An OIDC provider (e.g., Google OAuth) — not needed for Solo mode

### Desktop App (recommended)

```bash
git clone https://github.com/edgebric/edgebric.git
cd edgebric
pnpm install

cd packages/desktop
pnpm dev
```

The desktop app handles Ollama lifecycle, server management, and setup. Open the web UI from the tray menu.

### Manual Setup

```bash
pnpm install

# Configure environment
cp packages/api/.env.example packages/api/.env
# Edit .env with your OIDC credentials

# Start Ollama
ollama serve

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
| `OLLAMA_BASE_URL` | Ollama API endpoint (default: `http://localhost:11434`) |
| `CHAT_MODEL` | Model name for chat completions (default: `qwen3:4b`) |
| `EMBEDDING_MODEL` | Embedding model (default: `nomic-embed-text`) |

## Contributing

Bug reports and feature requests are welcome via [GitHub Issues](https://github.com/edgebric/edgebric/issues).

Community-supported software. No SLA or guaranteed response times.

For enterprise support contracts, contact support@edgebric.com.

## License

Business Source License 1.1

- **Use:** Free for personal and internal business use. No user limits, no feature restrictions.
- **Restriction:** No commercial redistribution. You may not repackage, rebrand, or sell Edgebric or derivative works. You may not offer Edgebric as a hosted or managed service.
- **Change Date:** 4 years from each release. On the change date, that release converts to Apache License 2.0.

The name "Edgebric" and associated logos are trademarks. Forks must use a different name and branding.
