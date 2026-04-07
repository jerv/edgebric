> **Status: MOSTLY CURRENT** — Architecture diagrams are accurate. References to `packages/edge/` are stale (removed, replaced by llama-server client in packages/api). The tech stack section may reference old dependencies.

# Technical Architecture

---

## System Architecture — Three Modes

### Mode 1: Org Mode (Single Node)

```
┌──────────────────────────────────────────────────────────────┐
│                     Company Network                           │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Edgebric Edge Node (Mac Mini / Server)     │  │
│  │                   (llama-server + sqlite-vec)           │  │
│  │                                                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────┐            │  │
│  │  │sqlite-vec│  │  llama  │  │    API    │            │  │
│  │  │(vectors  │  │ -server │  │ (Express  │            │  │
│  │  │+ FTS5)   │  │ (LLM)  │  │  server)  │            │  │
│  │  └──────────┘  └──────────┘  └───────────┘            │  │
│  │                                                        │  │
│  │  ┌────────────────────┐  ┌────────────────────────┐   │  │
│  │  │  Network Sources  │  │    Admin Dashboard     │   │  │
│  │  │  (HR, Benefits,    │  │    (React web app)     │   │  │
│  │  │   Handbook, etc.)  │  │                        │   │  │
│  │  └────────────────────┘  └────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                  │
│         ┌─────────────────┼─────────────────┐               │
│         │                 │                 │               │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐          │
│  │  Employee  │   │  Employee  │   │   Admin    │          │
│  │  Browser   │   │  Browser   │   │  Browser   │          │
│  └────────────┘   └────────────┘   └────────────┘          │
└──────────────────────────────────────────────────────────────┘

  No external cloud services
  No OpenAI / Azure / AWS
  Everything on one device
  Simplest deployment
```

### Mode 2: Department / Security Mode (Multi-Node Mesh)

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Company Network                              │
│                                                                      │
│  ┌────────────────┐   ┌────────────────┐   ┌────────────────┐       │
│  │  HR Node       │   │  Legal Node    │   │  Finance Node  │       │
│  │  (Mac Mini)    │   │  (Mac Mini)    │   │  (Mac Mini)    │       │
│  │                │   │                │   │                │       │
│  │  sqlite-vec:   │   │  sqlite-vec:   │   │  sqlite-vec:   │       │
│  │  HR Policies,  │   │  Contracts,    │   │  Expense       │       │
│  │  Benefits,     │   │  Compliance,   │   │  Policy,       │       │
│  │  Handbook      │   │  Regulatory    │   │  Procurement   │       │
│  │                │   │                │   │                │       │
│  │  llama-server  │   │  llama-server  │   │  llama-server  │       │
│  └───────┬────────┘   └───────┬────────┘   └───────┬────────┘       │
│          │                    │                    │                │
│          └────────────────────┼────────────────────┘                │
│                               │                                    │
│               Peer-to-Peer Mesh Network                            │
│           (mDNS auto-discovery, coordinator election,              │
│            cross-device HTTP routing)                              │
│                               │                                    │
│  ┌────────────────────────────┴──────────────────────────────┐     │
│  │              Coordinator Node (elected)                    │     │
│  │                                                           │     │
│  │  Query Router: receives query → fans out to relevant      │     │
│  │                sources → collects responses → synthesizes │     │
│  │                answer via llama-server                     │     │
│  │                                                           │     │
│  │  API Server + Admin Dashboard + Web App                   │     │
│  └───────────────────────────────────────────────────────────┘     │
│                               │                                    │
│         ┌─────────────────────┼─────────────────────┐             │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐                 │
│  │  Employee  │   │  Employee  │   │   Admin    │                 │
│  │  Browser   │   │  Browser   │   │  Browser   │                 │
│  └────────────┘   └────────────┘   └────────────┘                 │
└──────────────────────────────────────────────────────────────────────┘

  KEY PRINCIPLE: Your data. Your hardware. Your AI.
  HR data physically isolated on HR device
  Legal data physically isolated on Legal device
  Compromised node cannot access other departments' data
  No central database holding all company knowledge
```

### Mode 3: Meeting Mode (Ephemeral Mesh)

```
┌──────────────────────────────────────────────────────────────────────┐
│                   Meeting Session: "LAUNCH-2024"                     │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Alice (laptop)  │  │  Bob (MacBook)   │  │  Carol (laptop)  │  │
│  │                  │  │                  │  │                  │  │
│  │  Vault Source:    │  │  Vault Source:    │  │  Vault Source:    │  │
│  │  "Marketing      │  │  "Eng Release    │  │  "Legal          │  │
│  │   Campaign"      │  │   Notes"         │  │   Compliance"    │  │
│  │  [SHARED]        │  │  [SHARED]        │  │  [SHARED]        │  │
│  │                  │  │                  │  │                  │  │
│  │  Vault Source:    │  │  Network Source: │  │  Vault Source:    │  │
│  │  "My Research"   │  │  "Product Docs"  │  │  "Case Files"    │  │
│  │  [NOT SHARED]    │  │  [SHARED]        │  │  [NOT SHARED]    │  │
│  │                  │  │                  │  │                  │  │
│  │  sqlite-vec      │  │  sqlite-vec      │  │  sqlite-vec      │  │
│  │  llama-server    │  │  llama-server    │  │  llama-server    │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  │
│           │                     │                     │            │
│           └─────────────────────┼─────────────────────┘            │
│                                 │                                  │
│                    Peer-to-Peer Mesh                               │
│              (session-scoped, room code gated)                    │
│                                 │                                  │
│                    ┌────────────┴────────────┐                     │
│                    │   Session Coordinator   │                     │
│                    │   (elected node)        │                     │
│                    │                         │                     │
│                    │  Query: "Any compliance │                     │
│                    │   issues with slide 12?"│                     │
│                    │         │               │                     │
│                    │    Fan out to:          │                     │
│                    │    |-- Alice: Marketing │                     │
│                    │    |-- Bob: Eng + Prod  │                     │
│                    │    +-- Carol: Legal     │                     │
│                    │         │               │                     │
│                    │    Synthesize answer    │                     │
│                    │    with per-source citations│                 │
│                    └─────────────────────────┘                     │
│                                                                    │
│  Session ends -> ephemeral sharing dissolves                      │
│  No data was copied between devices                               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Cross-Device Query Flow

```
Employee asks: "What's our parental leave policy and does it comply with state law?"

  |
  v
1. QUERY RECEIVED by coordinator node
   +-- User authenticated, session validated

  |
  v
2. QUERY CLASSIFICATION
   |-- Query-time filter: person name + sensitive term? -> intercept
   |-- Source routing: which sources are relevant? -> HR source + Legal source
   +-- Node lookup: where do those sources live? -> HR node + Legal node

  |
  v
3. PARALLEL FAN-OUT (via HTTP)
   |-- -> HR Node:    embed query via llama-server -> sqlite-vec search -> top-k chunks returned
   +-- -> Legal Node: embed query via llama-server -> sqlite-vec search -> top-k chunks returned

   (Data never leaves its node -- only chunk text + metadata travel back)

  |
  v
4. RESPONSE SYNTHESIS (on coordinator)
   |-- Merge retrieved chunks from all nodes
   |-- Assemble system prompt with combined context
   |-- Generate answer via llama-server (on coordinator)
   +-- Tag citations with source name and node

  |
  v
5. RESPONSE DELIVERY
   |-- Answer text (streamed via SSE)
   |-- Source citations: {source name, document name, section, page}
   |-- Which sources contributed (visual indicator)
   +-- Disclaimer: Verify important decisions with the appropriate team.
```

---

## Meeting Mode Session Flow

```
1. CREATE SESSION
   |-- Organizer clicks "Create Session"
   |-- Server generates room code (e.g., "LAUNCH-2024")
   |-- Session record created with: code, creator, created_at, expires_at
   +-- Organizer shares code (Slack, email, verbally)

2. JOIN SESSION
   |-- Participant enters room code in Edgebric
   |-- Device joins session-scoped mesh group
   |-- Participant sees their sources with opt-in toggles
   |-- Participant opts in specific sources (granular, per-source)
   +-- All participants see updated source availability

3. QUERY IN SESSION
   |-- Any participant types a question
   |-- Coordinator identifies all opted-in sources across all devices
   |-- Fan-out query to each device hosting an opted-in source
   |-- Each device runs local hybrid search (BM25 + sqlite-vec), returns chunk results
   |-- Coordinator synthesizes answer with per-source citations
   +-- Answer delivered to session chat (all participants see it)

4. END SESSION
   |-- Creator clicks "End Session" (or session expires)
   |-- All ephemeral source sharing permissions revoked
   |-- Devices stop advertising sources to this session
   |-- Session transcript optionally exported
   +-- No data was ever copied between devices
```

---

## Document Ingestion Pipeline

```
INPUT (PDF, .docx, .txt, .md)
  |
  v
1. DETECTION
   |-- File type via magic bytes (not extension)
   |-- PDF: text layer present? -> text-based or scanned
   +-- Complexity flags: tables, multi-column, images

  |
  v
2. EXTRACTION (routed by detection result)
   |-- Text PDF (any layout)    -> Docling  <- primary, layout-aware
   |-- Scanned PDF (no text)    -> Tesseract OCR -> clean text
   |-- Word (.docx)             -> Mammoth -> Markdown
   +-- Plain text / Markdown    -> direct pass-through

  |
  v
3. CLEANING
   |-- Strip repeated headers/footers
   |-- Normalize bullet points and formatting artifacts
   |-- Remove inline page numbers
   +-- Collapse excessive whitespace

  |
  v
4. CHUNKING (semantic, heading-based)
   |-- Split at heading boundaries (H1 -> H2 -> H3)
   |-- Tables: atomic chunks, column headers embedded in text
   |-- Long sections: split with 50-token overlap
   |-- Short adjacent sections: merge if total < 100 tokens
   |-- Max chunk size: 800 tokens
   +-- Each chunk tagged with: {source, section_path, page, heading}

  |
  v
5. PII DETECTION (before any embedding)
   |-- spaCy NER: flag PERSON entity + sensitive term co-occurrence
   |-- Pattern matching: SSN-like patterns, salary figures attached to names
   +-- If flagged -> admin warning modal, admin must confirm to proceed

  |
  v
6. EMBEDDING + STORAGE
   |-- Embedding via llama-server /v1/embeddings endpoint (nomic-embed-text)
   |-- Vectors noise-protected: stored_embedding = real + HMAC-SHA256(key, chunkId)
   |-- Noise-protected vectors stored in sqlite-vec; denoised on search
   |-- Full text indexed in FTS5 for BM25 keyword search
   +-- Original files stored for source link rendering
```

---

## Core Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| LLM inference | llama-server (llama.cpp) | OpenAI-compatible endpoint; model-agnostic; auto-managed by desktop app |
| Embeddings | llama-server + nomic-embed-text | 768-dim, open source, runs locally |
| Vector store | sqlite-vec | Embedded in SQLite; local per-device; no separate database |
| Keyword search | FTS5 (SQLite) | BM25 ranking; combined with vector via Reciprocal Rank Fusion |
| Device discovery | mDNS (Bonjour) | Zero-config, automatic on local network |
| Cross-device routing | HTTP | Direct peer-to-peer HTTP calls between nodes |
| PDF extraction | Docling (IBM) | Layout-aware, table-aware, open source, local |
| OCR fallback | Tesseract | For scanned PDFs |
| Word extraction | Mammoth | .docx → clean Markdown |
| PII detection | spaCy | NER, runs locally |
| Frontend | React (Vite + TanStack Router + shadcn/ui) | Web app, responsive; mobile browser supported |
| Backend | Node.js + Express | REST API, SSE streaming |
| Database | SQLite + Drizzle ORM | Conversations, group chats, user sessions, vectors (sqlite-vec) |
| Auth | OIDC/SSO | Google dev IdP (dev), generic OIDC (prod) |

### Recommended LLM Defaults (Model-Agnostic)

Edgebric's inference layer targets the **OpenAI-compatible API spec** via llama-server. Any GGUF model from HuggingFace can be used.

| Mode | Recommended | Fallback | Notes |
|---|---|---|---|
| Server-side (coordinator) | Qwen3.5-9B Q4_K_M | Qwen3.5-4B | Strong instruction following, single-file GGUF |
| Server-side (constrained) | Qwen3.5-4B Q4_K_M | Qwen3.5-2B | For Mac Mini M2 8GB deployments |
| On-device (incognito) | Qwen3.5-2B Q4_K_M | — | Fits in phone memory, acceptable quality |

### Hardware Recommendations

| Hardware | Cost | Model Capacity | Daily Users | Best For |
|---|---|---|---|---|
| Apple Silicon Mac (16GB) | varies | Qwen3.5-4B @ ~35-50 tok/s | Personal | Local/vault mode on worker laptops |
| Mac Mini M4 (16GB) | $499 | Qwen3.5-4B @ ~35-50 tok/s | 50-100 | Small team server, budget org node |
| Mac Mini M4 (24GB) | $699 | Qwen3.5-9B or 27B Q3 | 100-200 | **Recommended org server** |
| Mac Mini M4 Pro (48GB) | $1,599 | 27B Q8 or multiple models | 200-500 | Large org, multi-department coordinator |

sqlite-vec search on 50K chunks: <5ms latency, ~250MB RAM. Mac Mini idles at 3-4 watts (~$5-10/year electricity).

---

## llama-server API Summary

Edgebric runs two llama-server instances: one for chat (port 8080) and one for embeddings (port 8081). Both expose the OpenAI-compatible API.

### Chat Completions (port 8080)
- Endpoint: `http://localhost:8080/v1/chat/completions`
- Supports streaming responses
- Model loaded at server startup (e.g., `qwen3-4b.gguf`)

### Embeddings (port 8081)
- Endpoint: `http://localhost:8081/v1/embeddings`
- Text → vector (768-dim with nomic-embed-text)
- Dedicated instance avoids contention with chat inference

### Health Check
- `GET /health` — returns server health status (available on both instances)

### Model Management
- Models are GGUF files downloaded from HuggingFace
- No registry API — models are managed as local files by the desktop app
- Model switching requires restarting llama-server with a different `--model` argument

### sqlite-vec (Embedded)

sqlite-vec is loaded as a SQLite extension. No separate API — vectors are stored and queried via SQL:

```sql
-- Store vectors alongside chunk data
CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[768]);

-- Query by similarity
SELECT rowid, distance
FROM vec_chunks
WHERE embedding MATCH ?
ORDER BY distance
LIMIT 10;
```

### FTS5 (Embedded)

BM25 keyword search via SQLite's built-in FTS5:

```sql
-- Full-text index
CREATE VIRTUAL TABLE chunks_fts USING fts5(content, source_id);

-- BM25-ranked search
SELECT rowid, rank FROM chunks_fts WHERE chunks_fts MATCH ?;
```

Results from both sqlite-vec and FTS5 are merged via **Reciprocal Rank Fusion** for hybrid search.

---

## Non-Functional Requirements

### Performance
- Single-node query: < 5 seconds end-to-end
- Cross-node query (2-3 nodes): < 8 seconds end-to-end
- Meeting mode query (3-5 nodes): < 12 seconds end-to-end
- Document ingestion: < 2 minutes per 100-page PDF
- Dashboard load: < 2 seconds
- Device discovery: < 5 seconds on local network

### Security
- All data at rest: AES-256 encrypted
- **Embedding noise protection**: stored embedding vectors are masked with per-chunk HMAC-SHA-256 noise derived from the encryption key. Without the key, embeddings are cryptographically indistinguishable from random — no topic or similarity information leaks. On search, noise is subtracted to recover the original vectors for accurate retrieval.
- All data in transit: TLS 1.3 (self-signed certificates for local mesh)
- Physical data isolation: each node holds only its assigned sources
- Admin panel: authenticated access only (OIDC/SSO)
- No telemetry or analytics transmitted to any external server
- No training data leaves company infrastructure

### Privacy
- Standard mode: individual queries not stored beyond session; only aggregate analytics
- Analytics: topics suppressed until minimum 5 distinct queries
- Meeting mode: session transcript stored only if opted in; source documents never copied
- Vault sources: never searchable by others unless explicitly shared in a group chat or session
- Group chat records: retained for compliance with configurable retention/expiration

### Compliance Posture
- **On-prem software model = selling software, not a service.** SOC 2, HIPAA certifications barely apply to the vendor when data never touches vendor infrastructure.
- **GDPR**: data residency by design — data never crosses device boundaries unless the user explicitly shares in a session
- **CCPA**: data stays on company/personal devices, fully auditable
- **HIPAA**: health data processed locally, no ePHI transmitted
- **EU AI Act**: human-in-the-loop (group chats with experts) built in; disclaimer on every response
