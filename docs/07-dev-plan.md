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

### 2.2 — CLI Install (Advanced Path — Ships First)

Homebrew is the first distribution channel. Even "advanced" users want a clean experience.

```bash
# Install
brew install edgebric

# First-time setup — interactive wizard walks through everything
edgebric setup
#   → Choose data directory (default: ~/Edgebric/)
#   → Configure OIDC provider (Google Workspace / Microsoft 365 / generic)
#   → Set admin email(s)
#   → Download AI model (Qwen 4B, ~2.5GB, progress bar)
#   → Start services
#   → Opens browser to http://localhost:3001

# Daily use
edgebric start        # Start server (backgrounded)
edgebric stop         # Stop server
edgebric status       # Show running state + port + uptime
edgebric logs         # Tail server logs
edgebric update       # Check for + apply updates
```

The `edgebric setup` wizard must be polished — clear prompts, sensible defaults, explanations for each step, and a working product at the end without the user needing to edit any config files.

**Distribution:**

| Channel | Priority | Cost | Notes |
|---|---|---|---|
| Homebrew Cask | First (V1 beta) | $0 | Formula points to GitHub Releases `.tar.gz` |
| Landing page + direct download | After branding | $5-20/month | Cloudflare R2 for `.dmg` hosting |
| Apple code signing | Before public beta | $99/year | Eliminates "unidentified developer" warning |

Homebrew formula lives in a tap: `brew tap edgebric/tap && brew install edgebric`. The formula downloads a pre-built `.tar.gz` from GitHub Releases (free hosting, no monthly cost).

**Other install options (lower priority):**

```bash
# Docker (for users who already have Docker)
docker compose up -d

# Manual (for contributors)
git clone ... && pnpm install && pnpm build && pnpm start
```

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

### 3.5 — Testable Security & Correctness Assertions

These claims MUST be verified before Phase 3 ships. Each is a pass/fail test.

**Data isolation:**
- [ ] A query on Node A that searches a KB on Node B never copies chunk data to Node A's disk or database
- [ ] After a cross-device query, Node A holds only the synthesized answer and citation metadata — not the raw chunks
- [ ] Disconnecting Node B from the network makes its KBs immediately unsearchable from Node A (no cached data served)
- [ ] Node B's mKB search endpoint is only reachable through the mimik mesh — not exposed on a public port

**Discovery & availability:**
- [ ] Two Macs on the same LAN running mim OE discover each other within 30 seconds without manual configuration
- [ ] A node going offline is detected (heartbeat timeout) and marked offline in the registry within 60 seconds
- [ ] A query targeting an offline node returns results from available nodes with a clear indication that some sources were unavailable

**Query correctness:**
- [ ] A cross-device query returns the same chunks as querying each node's mKB directly (no results lost in fan-out/merge)
- [ ] Citations from cross-device queries include the source node and KB name
- [ ] Parallel fan-out does not duplicate results when the same document exists on multiple nodes

**Auth & access control:**
- [ ] Mesh search requests are authenticated — a rogue device on the LAN cannot query KBs without a valid mesh token
- [ ] KB access controls (org-scoping, permissions) are enforced on the remote node, not just the coordinator
- [ ] A user without access to a KB on Node B gets no results from it, even when querying from Node A

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

### 4.5 — Testable Security & Correctness Assertions

**Ephemeral access:**
- [ ] After a session ends, no participant can query another participant's KBs through any endpoint
- [ ] Session data (transcript, participant list) is fully purged after expiry — no residual data on any node
- [ ] A participant who leaves a session loses access to shared KBs immediately — next query attempt fails
- [ ] Shared KB access is read-only — session participants cannot upload, modify, or delete documents on another node's KBs

**Session isolation:**
- [ ] Room codes are cryptographically random — not sequential or guessable
- [ ] A valid room code from Session A cannot be used to access Session B's shared KBs
- [ ] Only the session creator can end a session — participants can only leave

**Data movement:**
- [ ] During a session query, raw chunks from remote KBs are not persisted on the coordinator or any other participant's node
- [ ] Session transcripts (if saved) are stored only on the coordinator node, not replicated to participants
- [ ] A participant toggling a KB off mid-session removes it from subsequent queries immediately — no stale cache

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
