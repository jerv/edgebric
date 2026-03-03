# Development Plan

---

## Reality Check on mimik APIs

Before diving into phases, here is what we actually know from researching mimik's real developer documentation (GitHub: edgeMicroservice, mimik-ai, mimik-mimOE-ai orgs; SwaggerHub OpenAPI specs):

**What mimik actually gives us:**
- `mILM` — OpenAI-compatible REST API at `localhost:8083/api/milm/v1`. Handles both `/chat/completions` and `/embeddings`. Model-agnostic (download from Hugging Face). Streams supported.
- `mKB` — REST vector store at `localhost:8083/api/mkb/v1`. Create datasets, upload pre-computed embedding chunks, semantic similarity search. Simple, no bells.
- `mAI` — Multi-agent coordinator. Wires multiple mILM nodes with a summarizer. Useful for multi-node deployments; optional for MVP single-node.
- `MCM` — mimik Container Manager at `localhost:8083/mcm/v1`. Deploys microservices as `.tar` binaries.
- **No Node.js SDK** — all interaction is raw HTTP. We wrap it ourselves.
- **Auth** — static API key for mILM/mKB/mAI. edgeEngine handles device mesh auth separately.

**What this means for our code:**
- The "RAG pipeline" is entirely our code. mimik provides LLM inference and vector storage primitives — we build the orchestration (chunking, embedding, retrieval, prompt assembly) in `packages/core`.
- `packages/edge` is a thin HTTP client wrapping mimik's raw endpoints.
- For MVP: mILM + mKB. mAI is V2 (multi-node federation).

---

## Monorepo Structure

```
edgebric/
├── packages/
│   ├── core/          # Business logic — ingestion, RAG, PII detection. Zero framework deps.
│   ├── api/           # Express server — REST endpoints the web app calls
│   ├── web/           # React (Vite + TanStack Router + shadcn/ui) — employee + admin UI
│   └── edge/          # mimik API client — thin wrappers for mILM, mKB, mAI
├── spikes/            # Throwaway experiments. NOT production code.
│   ├── spike-mkb/     # Does mKB accept our chunk format?
│   ├── spike-milm/    # Can mILM run Qwen3-4B? How fast?
│   ├── spike-docling/  # Does Docling actually handle complex PDFs?
│   └── spike-rag/     # End-to-end: ingest doc → embed → store → query → answer
├── shared/
│   └── types/         # TypeScript interfaces shared across packages
├── scripts/           # Dev setup, deploy helpers
├── docs/              # PRD and architecture docs (already exists)
└── package.json       # Workspace root (pnpm workspaces)
```

**Why this structure:**
- `core` has zero knowledge of Express, React, or mimik. Pure functions. Independently testable.
- `edge` has zero knowledge of our business logic. Just HTTP.
- `api` composes `core` + `edge`. It is the only layer that knows both.
- `web` calls `api` only — never touches `core` or `edge` directly.
- Clear seam: if mimik changes their API, you touch `packages/edge` only.

---

## Data Schema — Design First

This is the most important pre-coding decision. Get this wrong and you pay for it everywhere.

### Core Entities

```typescript
// shared/types/index.ts

// A document uploaded by an HR admin
interface Document {
  id: string;                    // UUID
  name: string;                  // Original filename
  type: 'pdf' | 'docx' | 'txt' | 'md';
  classification: 'policy';      // Only 'policy' goes into shared index (V1)
  uploadedAt: Date;
  updatedAt: Date;
  status: 'processing' | 'ready' | 'failed';
  pageCount?: number;
  sectionHeadings: string[];
  storageKey: string;            // Reference to raw file storage
}

// A chunk of text extracted from a document
interface Chunk {
  id: string;                    // UUID
  documentId: string;
  content: string;               // The text content (100–800 tokens)
  metadata: {
    sourceDocument: string;      // Document name
    sectionPath: string[];       // e.g. ["Benefits", "Health Insurance", "Deductibles"]
    pageNumber: number;
    heading: string;
    chunkIndex: number;          // Position within document
  };
  embeddingId?: string;          // Reference to mKB chunk after embedding
}

// An anonymous device token for standard mode
interface DeviceToken {
  id: string;                    // The UUID token itself
  issuedAt: Date;
  lastSeenAt: Date;
  isRevoked: boolean;
  label?: string;                // Admin-assigned label e.g. "MacBook - John's desk"
}

// An escalation submitted by an employee
interface Escalation {
  id: string;
  createdAt: Date;
  question: string;
  aiAnswer: string;              // The AI's answer the employee wants verified
  sourceCitations: Citation[];
  status: 'open' | 'answered' | 'closed';
  hrResponse?: string;
  hrRespondedAt?: Date;
}

// A source citation attached to an answer
interface Citation {
  documentId: string;
  documentName: string;
  sectionPath: string[];
  pageNumber: number;
  excerpt: string;               // Relevant passage from the chunk
}

// The response returned to the employee
interface AnswerResponse {
  answer: string;
  citations: Citation[];
  hasConfidentAnswer: boolean;   // false → show "contact HR" fallback
  sessionId: string;
}

// A query session (for multi-turn context)
interface Session {
  id: string;
  createdAt: Date;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    citations?: Citation[];
  }>;
}

// Analytics topic cluster (aggregate only)
interface TopicCluster {
  id: string;
  label: string;                 // e.g. "PTO & Leave Policy"
  queryCount: number;            // Suppressed in UI if < 5
  period: { start: Date; end: Date };
}
```

**Why design schema now:** Every pipeline step — ingestion, RAG, escalation, admin dashboard — moves these objects around. Naming them now means no refactoring when API layer meets the frontend.

---

## Phase 0 — Monorepo Bootstrap (Day 1)

Do this once. Get it right. Never think about it again.

**Tasks:**
1. `pnpm init` at root, configure workspaces for `packages/*` and `shared/*`
2. Root `tsconfig.json` with path aliases (`@edgebric/core`, `@edgebric/edge`, `@edgebric/types`)
3. Each package gets its own `tsconfig.json` extending root
4. ESLint + Prettier configured once at root, shared by all packages
5. `shared/types` package — export the schema above
6. Vitest configured for `packages/core` (pure functions → easy to test)
7. `scripts/dev.sh` — starts API server + Vite dev server in parallel

**What you do NOT set up yet:** Docker, CI/CD, database migrations, any mimik deployment. None of that until spikes confirm assumptions.

---

## Phase 1 — Spikes (Before Writing a Single Line of Product Code)

A **spike** is throwaway code that answers one specific question. It lives in `/spikes`. It never gets refactored into production. When the spike is done, you write down what you learned and move on.

**Why spikes first:** The biggest risks are technical unknowns. A spike costs 1–2 days. Discovering the same problem after building 3 weeks of product costs 3 weeks.

### Spike 1 — mILM: Can it run our target model?

**Question:** Does Qwen3-4B run on a typical laptop/server? What's the token throughput? Does the streaming response format match OpenAI's?

**What to build:** Single `spikes/spike-milm/test.http` file + `README.md` documenting results.

Steps:
1. Download edgeEngine for macOS from GitHub Releases
2. Deploy mILM via MCM (upload .tar, start container)
3. `POST /models` — download Qwen3-4B-Instruct GGUF from Hugging Face
4. `POST /chat/completions` — simple prompt, verify streaming response format
5. Measure: time to first token, tokens/second, memory usage

**Success criteria:** Model loads, responses stream, format is valid OpenAI JSON. Document the actual numbers.

**Fallback decision:** If Qwen3-4B is too slow on available hardware, use Qwen3-1.7B or Llama-3.2-3B instead.

### Spike 2 — mKB: Does it accept our chunk format?

**Question:** Exactly what JSON structure does mKB expect for chunk upload? Does the similarity search return useful results?

**What to build:** `spikes/spike-mkb/test.ts` — programmatic version so we get the real request/response types.

Steps:
1. Deploy mKB via MCM
2. Create a dataset
3. Call mILM `/embeddings` with 5 test sentences
4. Format the embedding response into chunks, upload to mKB
5. Run a similarity search query
6. Inspect the response — is similarity scoring usable? What's the score range?

**Success criteria:** Embed → store → search pipeline works. Document exact request/response shapes.

**What this confirms:** Our `packages/edge` interface will be correct.

### Spike 3 — Docling: Does it handle real HR PDFs?

**Question:** Does Docling actually extract structured text from a messy HR PDF (multi-column, tables, footnotes)?

**What to build:** `spikes/spike-docling/test.py` — Python script, not TypeScript. Docling is Python. We call it from Node.js via a child process in production. This spike confirms the output quality.

Steps:
1. `pip install docling`
2. Run against 3 test PDFs: a simple one-column policy, a multi-column benefits guide, a scanned PDF
3. Inspect the Markdown output — are tables preserved? Are headings detected? Is the scanned PDF handled?
4. If scanned PDF fails → confirm Tesseract fallback works

**Success criteria:** Complex PDF produces clean, structured Markdown with headings and tables intact. Document what breaks and what workarounds exist.

### Spike 4 — End-to-End RAG: Does it produce a good answer?

**Question:** Does the full pipeline (PDF → chunks → embeddings → mKB → retrieval → mILM generation) produce a correct, cited answer from a real policy document?

**What to build:** `spikes/spike-rag/pipeline.ts` — single script, hardcoded config.

Steps:
1. Take a real PDF (any employee handbook or benefits doc found online)
2. Extract with Docling → chunk → embed with mILM → store in mKB
3. Ask 5 questions: 2 that should be answerable, 1 table-based (e.g. deductible amount), 1 that tests the "no answer found" path, 1 that tests the PII filter
4. Measure: answer quality, citation accuracy, latency

**Success criteria:** Answerable questions get correct answers with accurate citations. Non-answerable question gets clean "I don't know" response. PII question gets redirected. Document failure cases.

**This spike is the most important one.** If RAG quality is bad at this stage, we know before building a UI around it.

---

## Phase 2 — Core Package (`packages/core`)

After spikes, you know the exact shapes of everything. Now build the real thing.

`packages/core` is the heart of Edgebric. It has no HTTP layer. No database. No mimik. Just functions.

### 2.1 — Document Processor

```typescript
// packages/core/src/ingestion/processor.ts

interface ProcessResult {
  chunks: Chunk[];
  metadata: Pick<Document, 'pageCount' | 'sectionHeadings'>;
}

async function processDocument(
  file: Buffer,
  filename: string,
  mimeType: string
): Promise<ProcessResult>
```

Internally: routes to Docling (PDF) | Mammoth (.docx) | direct pass (.txt/.md) → clean → chunk.

### 2.2 — Chunker

```typescript
// packages/core/src/ingestion/chunker.ts

function chunkMarkdown(
  markdown: string,
  documentId: string,
  options?: { maxTokens?: number; overlapTokens?: number }
): Chunk[]
```

Implements heading-based semantic chunking. Tables are atomic. Long sections split with overlap. Short adjacent sections merged.

### 2.3 — PII Detector

```typescript
// packages/core/src/ingestion/piiDetector.ts

interface PIIWarning {
  chunkIndex: number;
  excerpt: string;        // The flagged text
  pattern: string;        // What was detected: "PERSON + salary", "SSN pattern", etc.
}

async function detectPII(chunks: Chunk[]): Promise<PIIWarning[]>
```

Uses `compromise` (JS NLP) or calls Python spaCy via child process for NER. Returns warnings — admin decides whether to proceed.

### 2.4 — Query Filter

```typescript
// packages/core/src/rag/queryFilter.ts

interface FilterResult {
  allowed: boolean;
  reason?: 'person_name_sensitive_term';
  redirectMessage?: string;
}

function filterQuery(query: string): FilterResult
```

Pattern matching + simple NER. If `PERSON + [salary, PIP, fired, complaint, accommodation, performance]` → intercept.

### 2.5 — RAG Orchestrator

```typescript
// packages/core/src/rag/orchestrator.ts

interface RAGOptions {
  topK?: number;          // default: 5
  datasetName: string;
}

async function answer(
  query: string,
  session: Session,
  options: RAGOptions,
  deps: {
    embed: (text: string) => Promise<number[]>;
    search: (embedding: number[], topK: number) => Promise<SearchResult[]>;
    generate: (messages: Message[], context: string) => AsyncIterable<string>;
  }
): Promise<AnswerResponse>
```

Notice: `deps` are injected. The orchestrator doesn't know it's calling mILM and mKB. In tests, you pass mock functions. In production, you pass the real mimik clients. This is the key architectural pattern.

The orchestrator:
1. Calls `filterQuery` → intercept if needed
2. Calls `embed(query)` → gets embedding vector
3. Calls `search(embedding, topK)` → gets relevant chunks
4. If no relevant chunks found → returns `hasConfidentAnswer: false`
5. Assembles system prompt with retrieved chunks + instructions
6. Calls `generate(messages, context)` → streams the answer
7. Extracts citations from used chunks
8. Returns `AnswerResponse`

### 2.6 — System Prompt

```typescript
// packages/core/src/rag/systemPrompt.ts

function buildSystemPrompt(chunks: Chunk[]): string
```

The actual text of the system prompt. Documented as a first-class concern, not buried in a string. Easy to update without digging through code.

Contents:
- You are an HR policy assistant for [company name].
- Answer only using the provided context. If the answer is not in the context, say so clearly.
- Never reveal information about named individuals.
- Always cite the source document, section, and page number for each claim.
- Your answers are informational, not legal advice.

---

## Phase 3 — Edge Package (`packages/edge`)

Thin HTTP client for mimik services. Every function is a direct translation of the raw HTTP calls we confirmed in spikes.

```typescript
// packages/edge/src/milm.ts

interface MILMClient {
  embed(text: string): Promise<number[]>;
  chat(messages: Message[], options?: { stream?: boolean }): AsyncIterable<string>;
  downloadModel(modelId: string, url: string): Promise<void>;
}

function createMILMClient(config: {
  baseUrl: string;      // http://localhost:8083/api/milm/v1
  apiKey: string;
  model: string;
}): MILMClient
```

```typescript
// packages/edge/src/mkb.ts

interface MKBClient {
  createDataset(name: string, modelId: string): Promise<void>;
  uploadChunks(datasetName: string, chunks: EmbeddedChunk[]): Promise<void>;
  search(datasetName: string, embedding: number[], topN: number): Promise<SearchResult[]>;
}

function createMKBClient(config: {
  baseUrl: string;      // http://localhost:8083/api/mkb/v1
  apiKey: string;
}): MKBClient
```

No business logic in here. Just fetch calls and error handling.

---

## Phase 4 — API Package (`packages/api`)

Express server. This layer wires `core` + `edge` together and exposes REST endpoints to the web app.

### Routes

```
POST   /api/documents/upload       # HR admin: upload + ingest document
GET    /api/documents              # HR admin: list all documents
DELETE /api/documents/:id          # HR admin: archive document
GET    /api/documents/:id/status   # Ingestion status polling

POST   /api/query                  # Employee: ask a question (streams response)
POST   /api/escalate               # Employee: forward question to HR

GET    /api/admin/analytics        # HR admin: topic clusters
GET    /api/admin/escalations      # HR admin: escalation inbox
POST   /api/admin/escalations/:id/respond  # HR admin: reply to escalation

GET    /api/admin/devices          # Device token management
DELETE /api/admin/devices/:id      # Revoke a device token

POST   /api/auth/token             # Issue anonymous device token (first launch)
```

### Middleware Stack

```
1. Request logging
2. Device token validation (all employee routes)
3. Admin session validation (all admin routes)
4. Rate limiting (per device token)
5. Error handler
```

### Document Upload Flow (the complex one)

```
POST /api/documents/upload
  → validate device token (admin)
  → save raw file to disk (multer)
  → create Document record (status: 'processing')
  → respond 202 Accepted with documentId
  → [background job starts]:
      → core.processDocument(file)
      → core.detectPII(chunks) → if warnings → store, mark for admin review
      → edge.mkb.createDataset(documentId)
      → for each chunk: edge.milm.embed(chunk.content) → edge.mkb.uploadChunks(...)
      → update Document record (status: 'ready' or 'failed')
```

Background job runs in-process (simple `setImmediate` / async queue for MVP). Not a separate worker. Upgrade to a real queue (BullMQ) in V2 if needed.

### Query Flow (streaming)

```
POST /api/query
  → validate device token
  → filterQuery → if blocked → return redirect message
  → core.answer(query, session, options, { embed, search, generate })
  → stream SSE response to client
```

Streaming is SSE (Server-Sent Events). Not WebSockets. Simpler, no connection management.

---

## Phase 5 — Web Package (`packages/web`)

React app. Vite. TanStack Router. shadcn/ui. Light theme.

### Routes

```
/                    → Employee home (query interface)
/incognito           → (V2) Incognito mode entry
/admin               → Admin login
/admin/dashboard     → Analytics overview
/admin/documents     → Document library + upload
/admin/escalations   → Escalation inbox
/admin/devices       → Device token management
```

### Component Philosophy

- Components are dumb. They display data and call handlers.
- Data fetching lives in TanStack Query hooks, not in components.
- All server state is via `react-query`. No `useEffect` for data fetching.
- Streaming query response uses `EventSource` (SSE) — wrap in a custom hook.

### Employee Query Interface

The main screen. Intentionally simple.

```
┌─────────────────────────────────────────────┐
│  [Edgebric logo]                    [Lock]  │
├─────────────────────────────────────────────┤
│                                             │
│  Ask a question about company policy        │
│  ┌─────────────────────────────────────┐   │
│  │                                     │   │
│  │                                     │   │
│  │                              [Send] │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ Answer (streams in)                 │   │
│  │                                     │   │
│  │ Source: [Employee Handbook, §3, p4] │   │
│  │                                     │   │
│  │ ⚠️ Not legal advice. Verify with HR  │   │
│  │                    [Ask HR to verify]│   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### Admin Dashboard

Three main panels:
1. **Documents** — table view, drag-and-drop upload zone, status badges, staleness alerts
2. **Analytics** — topic cluster cards (suppressed if < 5 queries), unanswered questions list
3. **Escalations** — inbox view, HR can reply inline

---

## Phase 6 — Integration & First Demo

After Phases 2–5 are working independently:

1. Wire `api` ↔ `edge` (real mimik calls replacing mock deps in `core`)
2. Wire `web` ↔ `api` (real HTTP calls replacing hardcoded fixtures)
3. End-to-end demo scenario:
   - Upload an HR policy PDF → see it process → status turns "ready"
   - Ask a question → see streaming answer → click source citation
   - Admin sees the question show up in analytics (after 5 queries)
   - Click "Ask HR to verify" → see it in escalation inbox → HR replies

**Demo goal:** A 5-minute walkthrough that makes someone say "I get it." Not impressive code. An impressive product moment.

---

## What NOT to Build in MVP

These are real temptations. Resist them.

| Temptation | Why to Skip It |
|---|---|
| Docker Compose setup | Run services directly in dev. Containerize before demo if needed. |
| Database migrations system | SQLite with a simple schema file. Prisma or Drizzle is V2. |
| Full CI/CD pipeline | Not needed for a portfolio project. |
| WebSocket streaming | SSE is simpler and works for our use case. |
| User accounts system | Anonymous device tokens only. No auth library. |
| Redis job queue | In-process background jobs are fine until they aren't. |
| Multi-node federation (mAI) | Single edge node for MVP. mAI adds complexity with no MVP benefit. |
| mAIChain integration | mILM + mKB directly. mAIChain is for multi-agent scenarios. |
| Incognito mode | V2. Marked as V2 in PRD for a reason. |
| Test suite > core package | Test `core` thoroughly. Snapshot test `web`. Skip API integration tests for now. |

---

## Spike-to-Production Decision Points

After each spike, you make a real decision. Document it in `05-decisions.md`.

| Spike | Decision triggered |
|---|---|
| Spike 1 (mILM) | Which model? What's the actual latency we can promise? |
| Spike 2 (mKB) | Exact chunk format spec. mKB embedding search threshold. |
| Spike 3 (Docling) | Do we need a Python subprocess or can we use a JS alternative? |
| Spike 4 (RAG) | Is retrieval quality good enough to ship? What's the min doc corpus size? |

---

## Local Development Setup

What a new dev (or you, coming back after a week) needs to run the project:

**Prerequisites:**
- Node.js 20+ and pnpm
- Python 3.10+ (for Docling / spaCy)
- mimik edgeEngine binary downloaded and running (macOS or Linux)
- mILM and mKB `.tar` files downloaded from edgeMicroservice GitHub Releases

**One-time setup:**
```bash
pnpm install
python -m pip install docling spacy
python -m spacy download en_core_web_sm
# Deploy mILM + mKB via MCM (script in /scripts/deploy-mimik.sh)
# Download and register LLM model (script in /scripts/download-model.sh)
```

**Dev run:**
```bash
pnpm dev   # starts api + web in parallel
```

---

## Order of Work (Summary)

```
Week 1:  Phase 0 (monorepo) + Phase 1 (all 4 spikes)
Week 2:  Phase 2 (packages/core — ingestion + RAG, fully tested)
Week 3:  Phase 3 (packages/edge — mimik clients) + Phase 4 (packages/api — routes)
Week 4:  Phase 5 (packages/web — employee UI + admin dashboard)
Week 5:  Phase 6 (integration + demo prep)
```

These are not deadlines. They are a sequencing guide. The spikes can't run in parallel with each other if you're on one machine. Core can be built without a running mimik instance (inject mocks). Web can be scaffolded before the API is complete (use fixture data).

The demo-worthy milestone is: upload a real PDF → ask a question → get a real answer with a real citation.
