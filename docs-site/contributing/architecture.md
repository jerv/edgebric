# Architecture

This page covers Edgebric's technical architecture for contributors. For user-facing explanations, see the [Guide](/guide/getting-started).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 20+, TypeScript 5.7 |
| **Backend** | Express 4.21 |
| **Database** | SQLite (better-sqlite3) + Drizzle ORM |
| **Vector search** | sqlite-vec (embedded in SQLite) |
| **Keyword search** | FTS5 (BM25 ranking) |
| **Frontend** | React 18, Vite 6, TanStack Router (file-based), TanStack Query |
| **UI** | TailwindCSS, shadcn/ui, Radix UI |
| **Desktop** | Electron 33 (electron-vite) |
| **AI inference** | llama.cpp (llama-server), OpenAI-compatible API |
| **Embeddings** | nomic-embed-text (768-dim) via llama-server |
| **Auth** | OIDC/SSO (passport-openidconnect) |
| **Package manager** | pnpm 10.6 (workspace monorepo) |

## Package Dependencies

```
@edgebric/desktop
  └── manages → @edgebric/api (server process)
                  ├── @edgebric/core (business logic)
                  └── @edgebric/types (shared interfaces)

@edgebric/web (built as static files, served by api)
  └── @edgebric/types

@edgebric/core (zero external dependencies)
  └── @edgebric/types
```

The desktop app is the top-level orchestrator. It starts llama-server, then the API server, and serves the pre-built web frontend.

## RAG Pipeline

The core retrieval-augmented generation flow (in `@edgebric/core`):

### Ingestion

```
Document → File type detection (magic bytes)
         → Text extraction (Docling for PDF, Mammoth for DOCX, OCR fallback)
         → Cleaning (strip headers/footers, normalize whitespace)
         → Semantic chunking (heading boundaries, tables atomic, 100-800 tokens, 50-token overlap)
         → PII detection (spaCy NER)
         → Embedding (nomic-embed-text, 768-dim vectors)
         → Storage (sqlite-vec for vectors, FTS5 for full text)
```

### Query

```
User query → Embed query
           → Vector search (sqlite-vec, cosine similarity)
           → Keyword search (FTS5, BM25)
           → Reciprocal Rank Fusion (merge results)
           → Context assembly (parent-child chunks: 256-token children for precision, 1024-token parents for LLM context)
           → System prompt construction
           → LLM inference (llama-server)
           → Citation extraction and validation
           → Answer type classification (grounded/blended/general/blocked)
           → SSE streaming to client
```

### Hybrid Search

Edgebric combines two search strategies:

- **Vector search** (sqlite-vec): Finds semantically similar content even when different words are used
- **Keyword search** (FTS5 with BM25): Finds exact term matches, handles names and codes well

Results are merged using **Reciprocal Rank Fusion (RRF)**, which combines rankings from both methods into a single score.

## Mesh Architecture

For multi-node deployments:

```
Primary Node
  ├── Handles OIDC auth for all users
  ├── Maintains node registry
  ├── Coordinates cross-node queries
  └── Fans out queries via HTTP (Promise.allSettled)

Secondary Node(s)
  ├── Hold their own documents/vectors
  ├── Respond to /api/mesh/peer/search
  ├── Send heartbeats (30s interval, 90s stale timeout)
  └── Authenticate via mesh token
```

No document replication. Each document lives on exactly one node. The primary node merges search results from all nodes and generates the final answer.

## Database

Single SQLite database per node with embedded extensions:

- **sqlite-vec**: Vector storage and similarity search
- **FTS5**: Full-text search with BM25 ranking

Schema is defined in Drizzle ORM (`packages/api/src/db/schema.ts`). Database initialization runs `CREATE TABLE` statements on first launch. Schema changes use `ALTER TABLE` migrations for existing databases.

## Security Architecture

- Session-based auth (httpOnly cookies, CSRF double-submit)
- Per-data-source access control (email-based ACLs)
- Immutable hash-chained audit log
- Helmet CSP + HSTS in production
- Rate limiting at multiple levels
- Zod validation on all API inputs
- Mesh token authentication for inter-node communication
- AES-256-GCM encryption for vault mode

## Key Architecture Decisions

### Why SQLite?

Single-file database that embeds vector search and full-text search. No external database server to manage. Each node is self-contained.

### Why llama.cpp?

Runs open-source models locally with excellent Apple Silicon support (Metal acceleration). OpenAI-compatible API means we're not locked to any specific model.

### Why Electron?

macOS menu bar app that manages server lifecycle. Non-technical users need a native app experience — they shouldn't need to know about servers, ports, or terminals.

### Why no document replication?

Physical isolation is a feature. If legal documents are on Node A and HR documents are on Node B, a compromised Node B literally cannot access legal data. Security by architecture, not access control.

For detailed rationale on these and other decisions, see the [internal planning docs](https://github.com/jerv/edgebric/tree/main/docs).
