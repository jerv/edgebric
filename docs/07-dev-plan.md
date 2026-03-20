# Development Plan

---

## Current State

Phase 1 and Phase 2 (productization) are complete. The single-node product is fully working:
- **packages/api/** — Express backend with OIDC auth, SQLite + Drizzle, multi-data-source management, group chat routes, SSE streaming, document upload + Docling extraction + ingestion
- **packages/web/** — Vite + React + TanStack Router, admin dashboard (Data Sources, user management), employee query interface, group chats with threads, conversation management, onboarding wizard, privacy modes
- **packages/core/** — Chunker, PII detector, query filter, system prompt, RAG orchestrator
- **packages/edge/** — mimik API wrappers (mILM, mKB)
- **shared/types/** — TypeScript interfaces
- **End-to-end working:** upload → Docling extract → chunk → PII scan → embed via mILM → store in mKB → multi-data-source query → SSE stream → citations with data source attribution
- **Security:** 4 passes of hardening, rate limiting, structured logging (pino), org-scoping, input validation (Zod), CSRF, CSP, helmet
- **Privacy:** Private mode (anonymous queries) + Vault mode (fully on-device with AES-256-GCM, Ollama)
- **Org model:** Multi-org scoping, user/admin roles, OIDC/SSO, invite flow, onboarding wizard
- **Collaboration:** Group chats with @bot querying, threaded replies, data source sharing with confirmation

**What needs to happen:** Stabilize group chats, add integrations (Slack bot), then add distributed features.

---

## Phase Sequencing

```
Phase 1: Foundation — Multi-data-source, auth, org model, security, privacy  ✅ COMPLETE
Phase 2: Productization — Hardening, testing, validation, deployment         ✅ COMPLETE
Phase 3: Group Chats — Collaborative data source sharing + threads           IN PROGRESS
Phase 4: Integrations — Slack bot, email notifications                   NEXT
Phase 5: Distributed — Mesh discovery + cross-device queries             (multi-Mac mesh)
Phase 6: Meeting Mode — Ephemeral sessions + room codes                  (the daily-use hook)
```

V1/beta is macOS-only. Mobile apps, Android, and cross-platform are V2+.

---

## Phase 2 — Productization ✅ COMPLETE

See [08-productization.md](08-productization.md) for details. Summary of what shipped:
- CLI (`edgebric`) with setup wizard, start/stop/status/logs commands
- Zod input validation on all routes
- CSRF, CSP, helmet, graceful shutdown, secure headers
- Toast notifications, error pages (404/500/network), session expiry detection
- 88 tests (44 core + 44 API integration)
- Privacy policy, ToS, admin guide (in-app), architecture one-pager
- Pino structured logging, health endpoint with disk monitoring
- Docker: Dockerfile + docker-compose.yml ready
- Remaining: macOS desktop installer (Electron/Tauri, deferred), iPhone Safari responsive test, Docker build verification

---

## Phase 3 — Group Chats: Collaborative Data Source Sharing (IN PROGRESS)

**Goal:** Enable collaborative knowledge work where multiple people share data sources, discuss, and query the bot together. Replaces the old escalation system with a natural collaboration model.

### 3.1 — Core Group Chat Backend
- [x] Group chat CRUD (create, list, get, update, archive)
- [x] Member management (invite with confirmation, remove, leave)
- [x] Data source sharing with confirmation dialogs
- [x] Message persistence with thread support
- [x] SSE real-time updates (messages, member joins/leaves, data source shares)
- [x] Expiration system (24h, 1w, 1m, never)

### 3.2 — Group Chat Query Pipeline
- [x] @bot / @edgebric detection in messages
- [x] Context building from conversation history (main chat vs. thread)
- [x] RAG pipeline against all shared data sources
- [x] Bot response with citations

### 3.3 — Group Chat UI
- [x] Chat list in sidebar
- [x] Main chat view with message list
- [x] Thread side panel
- [x] Member list + invite dialog with autocomplete search
- [x] Data source sharing dialog with warnings
- [x] Create group chat dialog
- [ ] Context summarization for long conversations

### 3.4 — Cleanup
- [x] Remove escalation routes, components, types, DB tables
- [x] Remove analytics page (routes, components, sidebar link)
- [x] Remove help section
- [ ] Rename "Knowledge Base" / "KB" → "Data Source" throughout codebase
- [ ] Add solo chat icon in sidebar
- [ ] Data sources list/table view with sorting and filters

---

## Phase 4 — Integrations: Slack Bot + Notifications

**Goal:** Allow customers to interact with Edgebric from tools they already use. Slack bot is the first integration.

### 4.1 — Slack Bot
- [ ] Slack app configuration (OAuth install flow, required scopes)
- [ ] Socket Mode connection (outbound WebSocket — works behind firewalls)
- [ ] @Edgebric mention handler → RAG query → threaded reply
- [ ] Admin settings page: "Add to Slack" button, privacy notice
- [ ] Bot intro message with privacy disclaimer on first channel interaction
- [ ] Per-channel data source configuration

### 4.2 — General-Purpose Email Notifications
- [ ] Notification service (extracted from old escalation email code)
- [ ] Group chat invite notifications
- [ ] Data source share notifications
- [ ] Chat expiration warnings
- [ ] User notification preferences

### 4.3 — Integration Settings UI
- [ ] Integrations page in admin settings
- [ ] Privacy notice displayed during setup
- [ ] Enable/disable toggles per integration
- [ ] Connection status indicators

---

## Phase 5 — Distributed: Mesh Discovery + Cross-Device Queries

**Goal:** Enable automatic device discovery and cross-device query routing so a query on one node can search data sources on other nodes in the same network.

### 5.1 — Node Registry Service

**`packages/api/src/services/nodeRegistry.ts`:**

```typescript
interface MeshNode {
  id: string;                    // mimik device ID
  name: string;                  // human-readable label
  type: "coordinator" | "kb-node";
  status: "online" | "offline";
  dataSources: DataSource[];
  lastSeen: string;
  endpoint: string;              // mesh-routable URL
}
```

- Uses mimik mDNS for automatic device discovery on local network
- Tracks which data sources are on which nodes
- Updates status on heartbeat/timeout
- Exposes `GET /api/nodes` for admin dashboard

### 5.2 — Cross-Device Query Router

**`packages/api/src/services/queryRouter.ts`:**

- Looks up which nodes host the target data sources
- For local data sources: direct mKB search
- For remote data sources: HTTP request through mimik mesh to the remote node's search endpoint
- Parallel fan-out to all relevant nodes
- Collects results, tags with source node + data source name
- Passes merged results to mILM on coordinator for synthesis
- Graceful degradation: if a node is unreachable, query proceeds with available nodes

### 5.3 — Remote Search Endpoint

Each node exposes a standardized search endpoint that mesh peers can call:

```
POST /api/mesh/search
Body: { query: string, datasetName: string, topN: number }
Response: { chunks: ChunkResult[], nodeId: string, dataSourceName: string }
```

### 5.4 — Admin Node Dashboard

- List all discovered mesh nodes with status indicators
- Show which data sources are on each node
- Health indicators (online/offline/last seen)
- Assign network data sources to specific nodes

### 5.5 — Testable Security & Correctness Assertions

These claims MUST be verified before Phase 5 ships. Each is a pass/fail test.

**Data isolation:**
- [ ] A query on Node A that searches a data source on Node B never copies chunk data to Node A's disk or database
- [ ] After a cross-device query, Node A holds only the synthesized answer and citation metadata — not the raw chunks
- [ ] Disconnecting Node B from the network makes its data sources immediately unsearchable from Node A (no cached data served)
- [ ] Node B's mKB search endpoint is only reachable through the mimik mesh — not exposed on a public port

**Discovery & availability:**
- [ ] Two Macs on the same LAN running mim OE discover each other within 30 seconds without manual configuration
- [ ] A node going offline is detected (heartbeat timeout) and marked offline in the registry within 60 seconds
- [ ] A query targeting an offline node returns results from available nodes with a clear indication that some data sources were unavailable

**Query correctness:**
- [ ] A cross-device query returns the same chunks as querying each node's mKB directly (no results lost in fan-out/merge)
- [ ] Citations from cross-device queries include the source node and data source name
- [ ] Parallel fan-out does not duplicate results when the same document exists on multiple nodes

**Auth & access control:**
- [ ] Mesh search requests are authenticated — a rogue device on the LAN cannot query data sources without a valid mesh token
- [ ] Data source access controls (org-scoping, permissions) are enforced on the remote node, not just the coordinator
- [ ] A user without access to a data source on Node B gets no results from it, even when querying from Node A

---

## Phase 6 — Meeting Mode: Ephemeral Knowledge Sharing

**Goal:** Implement ephemeral knowledge-sharing sessions with room codes, participant management, and cross-device query synthesis.

### 6.1 — Session Management

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
  sharedDataSources: string[];   // Data Source IDs they've opted in
  joinedAt: string;
}
```

**API routes:**
```
POST   /api/sessions              # Create session (returns room code)
POST   /api/sessions/join         # Join by room code
GET    /api/sessions/:id          # Session details + participants + shared KBs
POST   /api/sessions/:id/share    # Opt in/out data sources for this session
POST   /api/sessions/:id/query    # Query all shared data sources in session
POST   /api/sessions/:id/leave    # Leave session
POST   /api/sessions/:id/end      # End session (creator only)
```

### 6.2 — Session Query Flow

1. User submits query to session endpoint
2. Server identifies all shared data sources across all participants
3. Router fans out query to each node hosting a shared data source
4. Results collected and merged with per-data-source citations
5. mILM generates synthesized answer on coordinator
6. Answer streamed to all session participants via SSE
7. Session transcript optionally saved

### 6.3 — Session UI

- `CreateSession` — form to create session, displays room code
- `JoinSession` — room code input
- `SessionView` — participant list, shared data sources, chat interface
- `DataSourceSharePanel` — toggle which of your data sources to share in this session
- `SessionChat` — question/answer thread, per-data-source citation indicators

### 6.4 — Real-Time Session Updates

- SSE for session state updates (participant joins/leaves, data source sharing changes)
- All participants see the same chat thread
- Coordinator node manages session state

### 6.5 — Testable Security & Correctness Assertions

**Ephemeral access:**
- [ ] After a session ends, no participant can query another participant's data sources through any endpoint
- [ ] Session data (transcript, participant list) is fully purged after expiry — no residual data on any node
- [ ] A participant who leaves a session loses access to shared data sources immediately — next query attempt fails
- [ ] Shared data source access is read-only — session participants cannot upload, modify, or delete documents on another node's data sources

**Session isolation:**
- [ ] Room codes are cryptographically random — not sequential or guessable
- [ ] A valid room code from Session A cannot be used to access Session B's shared data sources
- [ ] Only the session creator can end a session — participants can only leave

**Data movement:**
- [ ] During a session query, raw chunks from remote data sources are not persisted on the coordinator or any other participant's node
- [ ] Session transcripts (if saved) are stored only on the coordinator node, not replicated to participants
- [ ] A participant toggling a data source off mid-session removes it from subsequent queries immediately — no stale cache

---

## Phase 7 — Mobile: iOS & Android Companion Apps

**Goal:** Native mobile apps that run mimik mim OE Runtime, host local data sources, and function as data source nodes in the mesh.

### 7.1 — iOS App

- Swift/SwiftUI, iOS 16.0+
- CocoaPods: `EdgeCore` + `mim-OE-ai-SE-iOS-developer`
- Start/stop mimik runtime on app launch
- Create vault data source, upload documents from Files app
- mKB search endpoint accessible to mesh peers
- Join meeting session via room code
- Data source sharing toggle per session
- No local inference — phone is a data source node, not an inference node

### 7.2 — Android App (V2)

- Kotlin/Jetpack Compose
- Same feature set as iOS
- Priority after iOS validates the mobile KB node concept

---

## Monorepo Structure

```
edgebric/
├── packages/
│   ├── core/          # Business logic — ingestion, RAG, PII detection. Zero deps.
│   ├── api/           # Express server — REST endpoints, SSE, group chats, integrations
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
Phase 1:  Multi-data-source, auth, org model, security, privacy, UI    ✅ COMPLETE
Phase 2:  Productization — validation, testing, hardening              ✅ COMPLETE
Phase 3:  Group chats — collaborative data source sharing + threads     IN PROGRESS
Phase 4:  Integrations — Slack bot, email notifications                NEXT
Phase 5:  Mesh discovery, cross-device query routing                   AFTER INTEGRATIONS
Phase 6:  Meeting mode, session management, session UI                 AFTER MESH
Phase 7:  iOS app, Android app                                         POST-LAUNCH
```

Phase 3 (group chats) is the current focus. Group chats replace the old escalation system with natural collaboration — invite experts, share data sources, discuss with @bot assistance.

Phase 4 (integrations) follows immediately — Slack bot lets customers query Edgebric from tools they already use. Socket Mode makes it firewall-friendly for on-prem.

**The shipping milestone:** A non-technical office manager downloads a `.dmg`, drags to Applications, launches the app, walks through a 5-step wizard, and has a working private AI knowledge assistant with group collaboration for their team within 10 minutes.
