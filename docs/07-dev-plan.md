# Development Plan

---

## Current State

Phase 1 is complete. The single-node product is fully working:
- **packages/api/** — Express backend with OIDC auth, SQLite + Drizzle, multi-KB management, escalation/notification routes, SSE streaming, document upload + Docling extraction + ingestion
- **packages/web/** — Vite + React + TanStack Router, admin dashboard (analytics, escalations, Library), employee query interface, conversation management, onboarding wizard, privacy modes
- **packages/core/** — Chunker, PII detector, query filter, system prompt, RAG orchestrator
- **packages/edge/** — mimik API wrappers (mILM, mKB)
- **shared/types/** — TypeScript interfaces
- **End-to-end working:** upload → Docling extract → chunk → PII scan → embed via mILM → store in mKB → multi-KB query → SSE stream → citations with KB source
- **Security:** 4 passes of hardening, rate limiting, structured logging (pino), org-scoping, input bound params
- **Privacy:** Private mode (anonymous queries) + Vault mode (fully on-device with AES-256-GCM, Ollama)
- **Org model:** Multi-org scoping, user/admin roles, OIDC/SSO, invite flow, onboarding wizard

**What needs to happen:** Ship this as a product that non-technical users can install and run, then add distributed features.

---

## Phase Sequencing

```
Phase 1: Foundation — Multi-KB, auth, org model, security, privacy     ✅ COMPLETE
Phase 2: Productization — Installer, hardening, testing, deployment     (shippable product)
Phase 3: Distributed — Mesh discovery + cross-device queries            (multi-Mac mesh)
Phase 4: Meeting Mode — Ephemeral sessions + room codes                 (the daily-use hook)
```

V1/beta is macOS-only. Mobile apps, Android, and cross-platform are V2+.

---

## Phase 2 — Productization: Ship a Real Product

**Goal:** Make Edgebric installable and usable by a non-technical office manager or small business owner, with zero terminal knowledge required. Also harden the codebase for production use.

### 2.1 — macOS Desktop Installer (GUI Path)

The primary install experience for non-technical users. A native macOS app that:

1. **Download & Install** — Standard `.dmg` drag-to-Applications installer
2. **First Launch Wizard** — GUI walks through:
   - Check/install dependencies (Node.js runtime bundled, mimik mim OE)
   - Choose data directory (default: `~/Edgebric/`)
   - Configure OIDC provider (Google Workspace, Microsoft 365, or generic OIDC)
   - Set admin email(s)
   - Start services
3. **Menu Bar App** — Persistent macOS menu bar icon showing:
   - Server status (running/stopped)
   - Start/Stop/Restart controls
   - Open web dashboard (launches browser to `http://localhost:3001`)
   - View logs
   - Quit
4. **Auto-Start** — Launch agent so Edgebric starts on boot
5. **Updates** — Check for updates on launch, one-click update

**Tech approach:** Electron or Tauri wrapper around the existing web UI + a native menu bar agent. The API server runs as a child process managed by the desktop app. All dependencies bundled — user never sees a terminal.

### 2.2 — CLI Install (Advanced Path)

For sysadmins, MSPs, and developers who prefer terminal:

```bash
# Option A: Homebrew
brew install edgebric
edgebric setup        # Interactive CLI wizard
edgebric start        # Start server

# Option B: Docker
docker compose up -d  # Uses existing docker-compose.yml

# Option C: Manual
git clone ...
pnpm install && pnpm build
cp .env.example .env  # Edit config
pnpm start
```

The CLI wizard (`edgebric setup`) covers the same steps as the GUI wizard but in terminal: OIDC config, admin emails, data directory, model selection.

### 2.3 — Input Validation

Add zod schemas on every API route. Reject malformed input at the boundary.

- Define schemas in `packages/api/src/schemas/` (one file per route group)
- Validation middleware: `validate(schema)` wraps route handlers
- Consistent error response: `{ error: string, details?: ZodError[] }`
- Cover: all POST/PUT/DELETE bodies, query params, path params

### 2.4 — Security Hardening

- **CSRF protection** — Double-submit cookie pattern or csurf middleware on state-changing routes
- **CSP headers** — Content Security Policy via helmet
- **Graceful shutdown** — Drain connections, flush logs, close DB on SIGTERM/SIGINT
- **Production mode** — No stack traces in error responses, no debug logging
- **Secure headers** — X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security

### 2.5 — Error Handling & UX

- Global error handler middleware (catch-all, consistent format)
- Frontend error pages: 404, 500, network error, session expired
- Toast notifications for async failures (upload errors, ingestion failures)
- Mobile-responsive testing on iPhone Safari

### 2.6 — Testing

- **Unit tests** — Core business logic: chunker, PII detector, query filter, orchestrator, system prompt builder
- **Integration tests** — API routes: auth flow, KB CRUD, document upload, query pipeline, escalation workflow
- **E2E tests** — Critical flows: first-time setup → create KB → upload doc → query → get answer with citations
- **CI** — GitHub Actions: lint, typecheck, test on push

### 2.7 — Documentation & Compliance

- **Privacy Policy** page — "We are software. Your data stays on your hardware."
- **Terms of Service** page
- **Architecture one-pager** — Non-technical diagram for compliance officers
- **DPA template** — For EU customers
- **Admin guide** — How to configure OIDC, manage users, set up KBs
- **Backup/restore** procedure for SQLite database

### 2.8 — Monitoring & Observability

- Structured logging already done (pino) — verify no console.log remaining
- Health check endpoint already done (`GET /api/health`) — verify it checks mILM + mKB connectivity
- Error tracking (Sentry or similar, opt-in)
- Resource usage: disk space warnings when data dir grows large

---

## Phase 3 — Distributed: Mesh Discovery + Cross-Device Queries

**Goal:** Enable automatic device discovery and cross-device query routing so a query on one node can search knowledge bases on other nodes in the same network.

### 3.1 — Node Registry Service

**`packages/api/src/services/nodeRegistry.ts`:**

```typescript
interface MeshNode {
  id: string;                    // mimik device ID
  name: string;                  // human-readable label
  type: "coordinator" | "kb-node";
  status: "online" | "offline";
  knowledgeBases: KnowledgeBase[];
  lastSeen: string;
  endpoint: string;              // mesh-routable URL
}
```

- Uses mimik mDNS for automatic device discovery on local network
- Tracks which KBs are on which nodes
- Updates status on heartbeat/timeout
- Exposes `GET /api/nodes` for admin dashboard

### 3.2 — Cross-Device Query Router

**`packages/api/src/services/queryRouter.ts`:**

- Looks up which nodes host the target KBs
- For local KBs: direct mKB search
- For remote KBs: HTTP request through mimik mesh to the remote node's search endpoint
- Parallel fan-out to all relevant nodes
- Collects results, tags with source node + KB
- Passes merged results to mILM on coordinator for synthesis
- Graceful degradation: if a node is unreachable, query proceeds with available nodes

### 3.3 — Remote Search Endpoint

Each node exposes a standardized search endpoint that mesh peers can call:

```
POST /api/mesh/search
Body: { query: string, datasetName: string, topN: number }
Response: { chunks: ChunkResult[], nodeId: string, kbName: string }
```

### 3.4 — Admin Node Dashboard

- List all discovered mesh nodes with status indicators
- Show which KBs are on each node
- Health indicators (online/offline/last seen)
- Assign organization KBs to specific nodes

---

## Phase 4 — Meeting Mode: Ephemeral Knowledge Sharing

**Goal:** Implement ephemeral knowledge-sharing sessions with room codes, participant management, and cross-device query synthesis.

### 4.1 — Session Management

```typescript
interface MeetingSession {
  id: string;
  code: string;                  // 6-digit room code
  creatorId: string;
  participants: SessionParticipant[];
  status: "active" | "ended";
  createdAt: string;
  expiresAt: string;             // auto-cleanup
}

interface SessionParticipant {
  userId: string;
  nodeId: string;
  sharedKBs: string[];           // KB IDs they've opted in
  joinedAt: string;
}
```

**API routes:**
```
POST   /api/sessions              # Create session (returns room code)
POST   /api/sessions/join         # Join by room code
GET    /api/sessions/:id          # Session details + participants + shared KBs
POST   /api/sessions/:id/share    # Opt in/out KBs for this session
POST   /api/sessions/:id/query    # Query all shared KBs in session
POST   /api/sessions/:id/leave    # Leave session
POST   /api/sessions/:id/end      # End session (creator only)
```

### 4.2 — Session Query Flow

1. User submits query to session endpoint
2. Server identifies all shared KBs across all participants
3. Router fans out query to each node hosting a shared KB
4. Results collected and merged with per-KB citations
5. mILM generates synthesized answer on coordinator
6. Answer streamed to all session participants via SSE
7. Session transcript optionally saved

### 4.3 — Session UI

- `CreateSession` — form to create session, displays room code
- `JoinSession` — room code input
- `SessionView` — participant list, shared KBs, chat interface
- `KBSharePanel` — toggle which of your KBs to share in this session
- `SessionChat` — question/answer thread, per-KB citation indicators

### 4.4 — Real-Time Session Updates

- SSE for session state updates (participant joins/leaves, KB sharing changes)
- All participants see the same chat thread
- Coordinator node manages session state

---

## Phase 5 — Mobile: iOS & Android Companion Apps

**Goal:** Native mobile apps that run mimik mim OE Runtime, host local KBs, and function as knowledge nodes in the mesh.

### 5.1 — iOS App

- Swift/SwiftUI, iOS 16.0+
- CocoaPods: `EdgeCore` + `mim-OE-ai-SE-iOS-developer`
- Start/stop mimik runtime on app launch
- Create personal KB, upload documents from Files app
- mKB search endpoint accessible to mesh peers
- Join meeting session via room code
- KB sharing toggle per session
- No local inference — phone is a KB node, not an inference node

### 5.2 — Android App (V2)

- Kotlin/Jetpack Compose
- Same feature set as iOS
- Priority after iOS validates the mobile KB node concept

---

## Monorepo Structure

```
edgebric/
├── packages/
│   ├── core/          # Business logic — ingestion, RAG, PII detection. Zero deps.
│   ├── api/           # Express server — REST endpoints, SSE, session management
│   ├── web/           # React (Vite + TanStack Router + shadcn/ui) — all UIs
│   ├── edge/          # mimik API client — mILM, mKB, mAIChain, mesh discovery
│   └── desktop/       # macOS installer app (Electron/Tauri menu bar + setup wizard)
├── shared/
│   └── types/         # TypeScript interfaces shared across packages
├── spikes/            # Completed throwaway experiments (all 4 spikes PASS)
├── scripts/           # Dev setup, deploy helpers, mimik binary management
├── docs/              # Product documentation (01-09)
├── test-data/         # Example KBs and test files
└── package.json       # Workspace root (pnpm workspaces)
```

---

## What NOT to Build Yet

| Temptation | Why Skip |
|---|---|
| mAIChain integration | Implement our own fan-out first; mAIChain API undocumented |
| Billing / subscriptions | Not needed until post-launch |
| CI/CD pipeline | GitHub Actions in Phase 2 covers this simply |
| Multi-office federation | Same-network mesh first, cross-network later |
| Mobile apps | Phase 5 — desktop product ships first |
| Custom AI model training | Out of scope — use off-the-shelf models |

---

## Order of Work

```
Phase 1:  Multi-KB, auth, org model, security, privacy, UI            ✅ COMPLETE
Phase 2:  Productization — installer, validation, testing, hardening   NEXT
Phase 3:  Mesh discovery, cross-device query routing                   AFTER SHIP
Phase 4:  Meeting mode, session management, session UI                 AFTER MESH
Phase 5:  iOS app, Android app                                         POST-LAUNCH
```

Phase 2 is the critical path to shipping. Everything in Phase 2 is about making the existing working product installable, secure, and trustworthy enough for paying customers.

**The shipping milestone:** A non-technical office manager downloads a `.dmg`, drags to Applications, launches the app, walks through a 5-step wizard, and has a working private AI knowledge assistant for their team within 10 minutes.
