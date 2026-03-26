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
│  │                   (mimik mim OE Runtime)               │  │
│  │                                                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────┐            │  │
│  │  │   mKB    │  │  mILM   │  │    API    │            │  │
│  │  │(vectors  │  │(local   │  │ (Express  │            │  │
│  │  │+ embeds) │  │  LLM)   │  │  server)  │            │  │
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

  ✗ No external cloud services
  ✗ No OpenAI / Azure / AWS
  ✓ Everything on one device
  ✓ Simplest deployment
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
│  │  mKB: HR       │   │  mKB: Legal    │   │  mKB: Finance  │       │
│  │  Policies,     │   │  Contracts,    │   │  Expense       │       │
│  │  Benefits,     │   │  Compliance,   │   │  Policy,       │       │
│  │  Handbook      │   │  Regulatory    │   │  Procurement   │       │
│  │                │   │                │   │                │       │
│  │  mILM (local)  │   │  mILM (local)  │   │  mILM (local)  │       │
│  └───────┬────────┘   └───────┬────────┘   └───────┬────────┘       │
│          │                    │                    │                │
│          └────────────────────┼────────────────────┘                │
│                               │                                    │
│               mimik Edge Service Mesh                              │
│           (mDNS auto-discovery, supernode election,                │
│            cross-device HTTP routing)                              │
│                               │                                    │
│  ┌────────────────────────────┴──────────────────────────────┐     │
│  │              Coordinator Node (elected supernode)          │     │
│  │                                                           │     │
│  │  mAIChain: receives query → fans out to relevant sources  │     │
│  │           → collects responses → synthesizes answer       │     │
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

  KEY PRINCIPLE: Data never moves. Queries move.
  ✓ HR data physically isolated on HR device
  ✓ Legal data physically isolated on Legal device
  ✓ Compromised node cannot access other departments' data
  ✓ No central database holding all company knowledge
```

### Mode 3: Meeting Mode (Ephemeral Mesh)

```
┌──────────────────────────────────────────────────────────────────────┐
│                   Meeting Session: "LAUNCH-2024"                     │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Alice (iPhone)  │  │  Bob (MacBook)   │  │  Carol (iPhone)  │  │
│  │                  │  │                  │  │                  │  │
│  │  Vault Source:    │  │  Vault Source:    │  │  Vault Source:    │  │
│  │  "Marketing      │  │  "Eng Release    │  │  "Legal          │  │
│  │   Campaign"      │  │   Notes"         │  │   Compliance"    │  │
│  │  [SHARED ✓]      │  │  [SHARED ✓]      │  │  [SHARED ✓]      │  │
│  │                  │  │                  │  │                  │  │
│  │  Vault Source:    │  │  Network Source:         │  │  Vault Source:    │  │
│  │  "My Research"   │  │  "Product Docs"  │  │  "Case Files"    │  │
│  │  [NOT SHARED ✗]  │  │  [SHARED ✓]      │  │  [NOT SHARED ✗]  │  │
│  │                  │  │                  │  │                  │  │
│  │  mKB (local)     │  │  mKB (local)     │  │  mKB (local)     │  │
│  │  mILM (local)    │  │  mILM (local)    │  │  mILM (local)    │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  │
│           │                     │                     │            │
│           └─────────────────────┼─────────────────────┘            │
│                                 │                                  │
│                    mimik Edge Mesh                                 │
│              (session-scoped, room code gated)                    │
│                                 │                                  │
│                    ┌────────────┴────────────┐                     │
│                    │   Session Coordinator   │                     │
│                    │   (elected supernode)   │                     │
│                    │                         │                     │
│                    │  Query: "Any compliance │                     │
│                    │   issues with slide 12?"│                     │
│                    │         │               │                     │
│                    │    Fan out to:          │                     │
│                    │    ├── Alice: Marketing │                     │
│                    │    ├── Bob: Eng + Prod  │                     │
│                    │    └── Carol: Legal     │                     │
│                    │         │               │                     │
│                    │    Synthesize answer    │                     │
│                    │    with per-source citations│                     │
│                    └─────────────────────────┘                     │
│                                                                    │
│  Session ends → ephemeral sharing dissolves                       │
│  No data was copied between devices                               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Cross-Device Query Flow

```
Employee asks: "What's our parental leave policy and does it comply with state law?"

  │
  ▼
1. QUERY RECEIVED by coordinator node
   └── User authenticated, session validated

  │
  ▼
2. QUERY CLASSIFICATION
   ├── Query-time filter: person name + sensitive term? → intercept
   ├── Source routing: which sources are relevant? → HR source + Legal source
   └── Node lookup: where do those sources live? → HR node + Legal node

  │
  ▼
3. PARALLEL FAN-OUT (via mAIChain / HTTP)
   ├── → HR Node:    embed query → mKB search → top-k chunks returned
   └── → Legal Node: embed query → mKB search → top-k chunks returned

   (Data never leaves its node — only chunk text + metadata travel back)

  │
  ▼
4. RESPONSE SYNTHESIS (on coordinator)
   ├── Merge retrieved chunks from all nodes
   ├── Assemble system prompt with combined context
   ├── Generate answer via mILM (on coordinator)
   └── Tag citations with source name and node

  │
  ▼
5. RESPONSE DELIVERY
   ├── Answer text (streamed via SSE)
   ├── Source citations: {source name, document name, section, page}
   ├── Which sources contributed (visual indicator)
   └── Disclaimer: Verify important decisions with the appropriate team.
```

---

## Meeting Mode Session Flow

```
1. CREATE SESSION
   ├── Organizer clicks "Create Session"
   ├── Server generates room code (e.g., "LAUNCH-2024")
   ├── Session record created with: code, creator, created_at, expires_at
   └── Organizer shares code (Slack, email, verbally)

2. JOIN SESSION
   ├── Participant enters room code in Edgebric
   ├── Device joins session-scoped mesh group
   ├── Participant sees their sources with opt-in toggles
   ├── Participant opts in specific sources (granular, per-source)
   └── All participants see updated source availability

3. QUERY IN SESSION
   ├── Any participant types a question
   ├── Coordinator identifies all opted-in sources across all devices
   ├── Fan-out query to each device hosting an opted-in source
   ├── Each device runs local mKB search, returns chunk results
   ├── Coordinator synthesizes answer with per-source citations
   └── Answer delivered to session chat (all participants see it)

4. END SESSION
   ├── Creator clicks "End Session" (or session expires)
   ├── All ephemeral source sharing permissions revoked
   ├── Devices stop advertising sources to this session
   ├── Session transcript optionally exported
   └── No data was ever copied between devices
```

---

## Document Ingestion Pipeline

```
INPUT (PDF, .docx, .txt, .md)
  │
  ▼
1. DETECTION
   ├── File type via magic bytes (not extension)
   ├── PDF: text layer present? → text-based or scanned
   └── Complexity flags: tables, multi-column, images

  │
  ▼
2. EXTRACTION (routed by detection result)
   ├── Text PDF (any layout)    → Docling  ← primary, layout-aware
   ├── Scanned PDF (no text)    → Tesseract OCR → clean text
   ├── Word (.docx)             → Mammoth → Markdown
   └── Plain text / Markdown    → direct pass-through

  │
  ▼
3. CLEANING
   ├── Strip repeated headers/footers
   ├── Normalize bullet points and formatting artifacts
   ├── Remove inline page numbers
   └── Collapse excessive whitespace

  │
  ▼
4. CHUNKING (semantic, heading-based)
   ├── Split at heading boundaries (H1 → H2 → H3)
   ├── Tables: atomic chunks, column headers embedded in text
   ├── Long sections: split with 50-token overlap
   ├── Short adjacent sections: merge if total < 100 tokens
   ├── Max chunk size: 800 tokens
   └── Each chunk tagged with: {source, section_path, page, heading}

  │
  ▼
5. PII DETECTION (before any embedding)
   ├── spaCy NER: flag PERSON entity + sensitive term co-occurrence
   ├── Pattern matching: SSN-like patterns, salary figures attached to names
   └── If flagged → admin warning modal, admin must confirm to proceed

  │
  ▼
6. EMBEDDING + STORAGE
   ├── Embedding via mILM /embeddings endpoint (nomic-embed-text)
   ├── Vectors stored in mKB dataset (local to the device)
   └── Original files stored for source link rendering
```

---

## Core Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Edge runtime | mimik mim OE | Runs on company hardware; handles mesh, discovery, routing |
| Embeddings + vector store | mimik mKB | Local per-device; no central database |
| LLM inference | mimik mILM | OpenAI-compatible endpoint; model-agnostic |
| Multi-node coordination | mimik mAIChain | Fans out queries, synthesizes responses |
| Device discovery | mimik mDNS | Zero-config, auto supernode election |
| PDF extraction | Docling (IBM) | Layout-aware, table-aware, open source, local |
| OCR fallback | Tesseract | For scanned PDFs |
| Word extraction | Mammoth | .docx → clean Markdown |
| PII detection | spaCy | NER, runs locally |
| Embedding model | nomic-embed-text | 768-dim, open source, runs locally via mILM |
| Frontend | React (Vite + TanStack Router + shadcn/ui) | Web app, responsive; mobile browser supported |
| iOS app | Swift + mimik iOS SDK (CocoaPods) | Knowledge node in mesh |
| Backend | Node.js + Express | REST API, SSE streaming |
| Database | SQLite + Drizzle ORM | Conversations, group chats, user sessions |
| Auth | OIDC/SSO | Google dev IdP (dev), generic OIDC (prod) |

### Recommended LLM Defaults (Model-Agnostic)

Edgebric's inference layer targets the **OpenAI-compatible API spec**. Any model/runtime exposing this interface can be substituted.

| Mode | Recommended | Fallback | Notes |
|---|---|---|---|
| Server-side (coordinator) | Qwen3.5-9B Q4_K_M | Qwen3.5-4B | Strong instruction following, single-file GGUF |
| Server-side (constrained) | Qwen3.5-4B Q4_K_M | Qwen3.5-2B | For Mac Mini M2 8GB deployments |
| On-device (iOS/incognito) | Qwen3.5-2B Q4_K_M | — | Fits in phone memory, acceptable quality |

### Hardware Recommendations

| Hardware | Cost | Model Capacity | Daily Users | Best For |
|---|---|---|---|---|
| Apple Silicon Mac (16GB) | varies | Qwen3.5-4B @ ~35-50 tok/s | Personal | Local/vault mode on worker laptops |
| Mac Mini M4 (16GB) | $499 | Qwen3.5-4B @ ~35-50 tok/s | 50-100 | Small team server, budget org node |
| Mac Mini M4 (24GB) | $699 | Qwen3.5-9B or 27B Q3 | 100-200 | **Recommended org server** |
| Mac Mini M4 Pro (48GB) | $1,599 | 27B Q8 or multiple models | 200-500 | Large org, multi-department coordinator |
| iPhone (iOS 16+) | existing | Qwen3.5-2B | Personal use | Meeting mode knowledge node |

mKB vector search on 50K chunks: <5ms latency, ~250MB RAM. Mac Mini idles at 3-4 watts (~$5-10/year electricity).

---

## mimik Platform API Summary

All communication with mimik services is raw HTTP to `localhost:8083`. No Node.js SDK exists.

### mILM (Local LLM Inference)
- Endpoint: `http://localhost:8083/api/mim/v1`
- Auth: `Authorization: Bearer <key>` (uppercase Bearer)
- `POST /chat/completions` — OpenAI-compatible, supports streaming
- `POST /embeddings` — text → vector (768-dim with nomic-embed-text)
- `POST /models` — download and load models from URL (SSE progress)
- Cold-start tokens (`<|loading_model|>`, `<|processing_prompt|>`) must be stripped client-side

### mKB (Vector Storage)
- Endpoint: `http://localhost:8083/api/mkb/v1`
- Auth: `authorization: bearer <key>` (lowercase bearer — different from mILM)
- `POST /datasets` — create dataset, requires `model` field
- `POST /datasets/{name}/chunks` — multipart upload, NDJSON format, field="chunks"
- `POST /search` — `{ datasetName, prompt, topN }` — mKB handles query embedding internally
- Dataset "already exists" returns HTTP 400 (not 409)
- Chunk upload returns empty body on success (HTTP 200)

### mAIChain (Multi-Node Coordination)
- Fans out queries to multiple Agent Machines
- Synthesizes responses from multiple sources
- Exact API: needs further documentation from mimik

### MCM (Container Manager)
- Endpoint: `http://localhost:8083/mcm/v1`
- Deploys microservices as `.tar` containers
- Used to deploy mILM, mKB, mAIChain on each node

### Device Discovery (mDNS)
- Automatic via mimik runtime
- Three cluster types: Network (same LAN), Account (same user, any network), Proximity (nearby)
- Supernode election handled by runtime
- Cross-device HTTP calls routed through mesh

---

## iOS Architecture

```
┌─────────────────────────────────────────────────────┐
│                   iOS App                            │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │         mimik mim OE Runtime                  │   │
│  │    (CocoaPods: EdgeCore +                    │   │
│  │     mim-OE-ai-SE-iOS-developer)             │   │
│  │                                              │   │
│  │  ┌──────────┐  ┌──────────┐                  │   │
│  │  │   mKB    │  │  mILM   │                  │   │
│  │  │ (local   │  │ (local   │                  │   │
│  │  │  vectors)│  │  LLM)    │                  │   │
│  │  └──────────┘  └──────────┘                  │   │
│  │                                              │   │
│  │  Auto-discovery via mDNS                     │   │
│  │  Advertises sources to mesh                   │   │
│  │  Responds to cross-device queries            │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │         App UI (SwiftUI)                      │   │
│  │  ├── Vault source management                  │   │
│  │  ├── Document upload from Files              │   │
│  │  ├── Private query interface                 │   │
│  │  ├── Meeting session (join via code)          │   │
│  │  └── Source sharing controls                  │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  Requirements:                                     │
│  - iOS 16.0+                                       │
│  - Physical device only (no simulator)             │
│  - ~2GB storage for model + embeddings             │
└─────────────────────────────────────────────────────┘
```

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
- All data in transit: TLS 1.3 (mesh uses mimik's built-in TLS)
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
