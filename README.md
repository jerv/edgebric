# Edgebric

**Private knowledge platform that runs on your hardware.** Upload documents, ask questions with AI, and get cited answers — nothing leaves your machine. Ever.

Whether you're organizing family documents, managing client files, building a personal research library, or running a 200-person company with department-level data isolation — Edgebric runs locally on a Mac and scales from one user to hundreds.

> *"Your data. Your hardware. Your AI."*

---

**Just want to use it?** Head to [edgebric.com](https://edgebric.com) to download the macOS app. No terminal, no setup — just download and run.

---

## Free and open source.

Edgebric is open source under the [GNU Affero General Public License v3.0](LICENSE). Use it, modify it, distribute it — for any purpose. If you find it useful, consider [sponsoring development](https://github.com/sponsors/jerv).

If you modify Edgebric and distribute it or run it as a service, you must share your changes under the same license.

## What It Does

- **Multi-node mesh networking**: Install a Mac in each office or department. Each node holds its own documents. Queries fan out across all nodes in parallel — answers come back with citations, but no document ever leaves the machine it's stored on. Your data stays on your hardware — private by design.
- **Document ingestion**: Upload PDF, DOCX, TXT, MD files. Automatic extraction, chunking, and embedding.
- **RAG-powered Q&A**: Ask questions in natural language. Get answers with source citations.
- **Cloud integrations**: Sync documents from Google Drive, OneDrive, Confluence, and Notion. Documents are pulled to your local machine — never stored in the cloud.
- **Privacy modes**: Standard (anonymous analytics), Private (no identity tracking), Vault (on-device only).
- **SSO / OIDC authentication**: Sign in with Google or Microsoft. Not needed for Solo mode.
- **Multi-org**: Each organization's data is fully isolated. Users can belong to multiple orgs.
- **Data source management**: Organize documents into data sources with per-source access control.
- **Admin dashboard**: Document management, user/member management, model management, service status, organization settings.
- **Group chats**: Collaborative conversations with @bot querying, threads, and source sharing.
- **Desktop app**: macOS menu bar app that manages llama-server, the API server, and setup — all from the tray.

## Who It's For

- **Individuals**: Personal document libraries, research archives, family records, tax documents, medical files — anything you want to search privately
- **Solo professionals**: Consultants, freelancers, and practitioners with sensitive client documents
- **Teams and small businesses**: Law firms, medical practices, accounting firms, HR departments — anyone handling confidential information
- **Organizations**: Department-level data isolation enforced by architecture, not just access controls. Mesh networking for multi-site deployments
- **AI agents**: Edgebric works as a private knowledge backend for AI agents (OpenClaw skill available)

## Mesh Networking — Data Never Moves

Most knowledge platforms centralize your documents in one place. Edgebric does the opposite.

Put a Mac Mini in your New York office with HR documents. Another in London with legal contracts. A third in Tokyo with engineering specs. When an employee asks a question, Edgebric queries all three nodes simultaneously and merges the results — but no document ever crosses the network. Only the query and the relevant answer snippets travel.

- **One primary node** handles authentication; secondary nodes join the mesh with a shared token
- **Node groups** let you organize by department, office, or sensitivity level
- **Parallel fan-out** queries all nodes at once via `Promise.allSettled` — fast even across continents
- **No replication** — each document lives on exactly one node
- **Opt-in** — mesh can be enabled or disabled at any time without losing configuration

A single Mac Mini M4 ($699) can serve 100-200 daily users. Three of them give you a globally distributed, fully private knowledge platform for under $2,100 in hardware.

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

- **AI**: llama.cpp for local inference (Qwen 3 4B default, supports any GGUF model from HuggingFace)
- **Embeddings**: nomic-embed-text (768-dim) via llama-server
- **Vector search**: sqlite-vec (embedded in SQLite) with BM25 hybrid retrieval (FTS5 + Reciprocal Rank Fusion)
- **Storage**: SQLite (Drizzle ORM) — metadata, vectors, and full-text search in one file
- **Auth**: OIDC/SSO (Google, Microsoft). Not needed for Solo mode.
- **Frontend**: Vite, React 18, TailwindCSS, shadcn/ui

## Hardware Requirements

| | Minimum | Recommended |
|---|---|---|
| **OS** | macOS (Apple Silicon) | macOS (Apple Silicon) |
| **RAM** | 16GB | 24GB |
| **Disk** | 20GB free | 50GB free |
| **Hardware** | Any Apple Silicon Mac | Mac Mini M4 24GB ($699) |
| **Use case** | Personal / vault use | Org server (100-200 daily users) |

## Install

### Option 1: Download the app

Head to [edgebric.com](https://edgebric.com) — download, drag to Applications, launch. No terminal required.

### Option 2: Install via command line

```bash
curl -fsSL https://edgebric.com/install.sh | bash
```

Downloads the latest DMG from GitHub Releases, installs Edgebric.app to /Applications. Run it again to update. To install a specific version:

```bash
curl -fsSL https://edgebric.com/install.sh | bash -s -- --version v0.9.0
```

### Option 3: Build from source

```bash
git clone https://github.com/jerv/edgebric.git
cd edgebric
pnpm install
pnpm build

# Launch the desktop app
cd packages/desktop
pnpm dev
```

The desktop app handles llama-server lifecycle, server management, and setup. Open the web UI from the tray menu.

### Prerequisites (for building from source)

- macOS (Apple Silicon recommended, Intel supported)
- Node.js 20+
- pnpm 10+
- Python 3.10+ with `docling` (for PDF extraction, optional)
- llama-server is auto-managed by the desktop app — no manual install needed
- An OIDC provider (Google or Microsoft) — not needed for Solo mode

### Manual setup (without desktop app)

```bash
pnpm install
pnpm build

# Configure environment
cp packages/api/.env.example packages/api/.env
# Edit .env with your settings

# Start llama-server (chat model on port 8080)
llama-server --model path/to/qwen3-4b.gguf --port 8080

# In another terminal: embedding model on port 8081
llama-server --model path/to/nomic-embed-text.gguf --port 8081 --embedding

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
| `INFERENCE_CHAT_URL` | llama-server chat endpoint (default: `http://localhost:8080`) |
| `INFERENCE_EMBEDDING_URL` | llama-server embedding endpoint (default: `http://localhost:8081`) |
| `CHAT_MODEL` | Model name for chat completions (default: `qwen3-4b`) |
| `EMBEDDING_MODEL` | Embedding model (default: `nomic-embed-text`) |

## Contributing

Contributions welcome! Please read the [Contributor License Agreement](CLA.md) — you'll be asked to sign it on your first pull request.

- **Bug reports & feature requests**: [GitHub Issues](https://github.com/jerv/edgebric/issues)
- **Questions & discussion**: [GitHub Discussions](https://github.com/jerv/edgebric/discussions)
- **Contact**: support@edgebric.com

Good first issues: additional auth providers (Okta, OneLogin, generic OIDC), cloud storage connectors (Dropbox, Box), and translations.

## License

[GNU Affero General Public License v3.0](LICENSE)

Free to use, modify, and distribute. If you distribute modified versions or run them as a network service, you must make your source code available under the same license.
