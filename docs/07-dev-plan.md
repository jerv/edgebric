> **Status: CURRENT** — Audited against codebase on 2026-03-31.

# Development Plan

---

## Current State

Phases 1–3 and Phase 5 (mesh networking) are complete. The product is working end-to-end:

- **packages/api/** — Express backend with OIDC auth, SQLite + Drizzle, multi-data-source management, group chat routes, SSE streaming, document upload + Docling extraction + ingestion, mesh networking, audit logging
- **packages/web/** — Vite + React + TanStack Router, admin dashboard (Data Sources, user management, node management), employee query interface, group chats with threads, conversation management, onboarding wizard, privacy modes
- **packages/core/** — Chunker (parent-child), PII detector, query filter, system prompt, RAG orchestrator, context summarizer, answer analysis, citation validation
- **packages/desktop/** — Electron 33 menu bar app, setup wizard (Solo/Admin/Member modes), Ollama lifecycle management (auto-download, auto-update with rollback), model management, server dashboard, mDNS publishing, self-signed TLS
- **shared/types/** — TypeScript interfaces shared across packages
- **End-to-end working:** upload → Docling extract → chunk → PII scan → embed via Ollama → store in sqlite-vec → hybrid search (BM25 + vector) → SSE stream → citations with data source attribution
- **Security:** Rate limiting, structured logging (pino), org-scoping, input validation (Zod), CSRF (double-submit cookie), CSP (Helmet), HSTS, immutable hash-chained audit log
- **Privacy:** Private mode (anonymous queries) + Vault mode (fully on-device with AES-256-GCM, Ollama)
- **Org model:** Multi-org scoping, user/admin roles (owner/admin/member), OIDC/SSO (6 providers), invite flow, onboarding wizard
- **Collaboration:** Group chats with @bot querying, threaded replies, data source sharing with confirmation, context summarization
- **Mesh:** Node registry, cross-device query routing, mesh token auth, heartbeat scheduler, mDNS discovery (desktop), admin node dashboard

**What needs to happen:** Integrations (Slack bot, cloud storage sync), then Meeting Mode.

---

## Phase Sequencing

```
Phase 1: Foundation — Multi-data-source, auth, org model, security, privacy  COMPLETE
Phase 2: Productization — Hardening, testing, validation, deployment         COMPLETE
Phase 3: Group Chats — Collaborative data source sharing + threads           COMPLETE
Phase 4: Integrations — Slack bot, cloud storage sync                    NEXT
Phase 5: Distributed — Mesh networking + cross-node queries              COMPLETE
Phase 6: Meeting Mode — Ephemeral sessions + room codes                  NOT STARTED
```

V1/beta is macOS-only. Mobile apps, Android, and cross-platform are V2+.

---

## Phase 2 — Productization COMPLETE

See [08-productization.md](08-productization.md) for details. Summary of what shipped:
- Desktop app (Electron) with setup wizard, tray menu, server/Ollama lifecycle management
- Zod input validation on all routes
- CSRF, CSP, Helmet, graceful shutdown, secure headers, HSTS
- Toast notifications, session expiry detection
- Privacy policy, ToS (in-app pages), architecture one-pager
- Pino structured logging, health endpoint with disk monitoring
- Docker: Dockerfile + docker-compose.yml + docker-compose.prod.yml
- Self-signed TLS certificate generation
- Onboarding wizard (org → data source → upload → query)

---

## Phase 3 — Group Chats: Collaborative Data Source Sharing COMPLETE

**Goal:** Enable collaborative knowledge work where multiple people share data sources, discuss, and query the bot together.

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
- [x] Context summarization for long conversations

### 3.3 — Group Chat UI
- [x] Chat list in sidebar
- [x] Main chat view with message list
- [x] Thread side panel
- [x] Member list + invite dialog with autocomplete search
- [x] Data source sharing dialog with warnings
- [x] Create group chat dialog

### 3.4 — Cleanup
- [x] Remove escalation routes, components, types, DB tables
- [x] Remove analytics page (routes, components, sidebar link)
- [x] Remove help section
- [x] Rename "Knowledge Base" / "KB" → "Data Source" throughout docs
- [x] Data sources list/table view with sorting and filters

---

## Phase 4 — Integrations: Slack Bot + Cloud Storage Sync

**Goal:** Allow customers to interact with Edgebric from tools they already use, and sync documents from cloud storage.

### 4.1 — Slack Bot
- [ ] Slack app configuration (OAuth install flow, required scopes)
- [ ] Socket Mode connection (outbound WebSocket — works behind firewalls)
- [ ] @Edgebric mention handler → RAG query → threaded reply
- [ ] Admin settings page: "Add to Slack" button, privacy notice
- [ ] Bot intro message with privacy disclaimer on first channel interaction
- [ ] Per-channel data source configuration

### 4.2 — Cloud Storage Sync
Schema and connector framework already exists (cloudConnections, cloudFolderSyncs, cloudOauthTokens tables).
- [ ] Google Drive OAuth flow + folder sync implementation
- [ ] OneDrive/SharePoint folder sync
- [ ] Sync status UI in admin dashboard

### 4.3 — Email Notifications
In-app notifications work via SSE. Email delivery not yet implemented.
- [ ] Email sending infrastructure (nodemailer or similar)
- [ ] Group chat invite email notifications
- [ ] Data source share email notifications
- [ ] Chat expiration warning emails
- [ ] User notification preferences

---

## Phase 5 — Distributed: Mesh Discovery + Cross-Device Queries COMPLETE

**Goal:** Automatic device discovery and cross-device query routing.

### 5.1 — Node Registry Service (`services/nodeRegistry.ts`)
- [x] mDNS-based auto-discovery (bonjour-service, desktop-only)
- [x] Node registration with status tracking (online/offline/connecting)
- [x] Data source-to-node binding
- [x] Heartbeat scheduler (30s interval, 90s stale timeout, 60s stale detection)

### 5.2 — Cross-Device Query Router (`services/queryRouter.ts`)
- [x] Parallel fan-out to all relevant nodes via Promise.allSettled
- [x] Local data sources: direct sqlite-vec + FTS5 hybrid search
- [x] Remote data sources: HTTP request to remote node's search endpoint
- [x] Results tagged with source node + data source name
- [x] Graceful degradation: meshNodesUnavailable counter in response

### 5.3 — Remote Search Endpoint (`routes/meshInterNode.ts`)
- [x] `POST /api/mesh/peer/search` endpoint
- [x] Mesh token authentication (meshAuth middleware)

### 5.4 — Admin Node Dashboard
- [x] List all discovered mesh nodes with status indicators
- [x] Show which data sources are on each node
- [x] Health indicators (online/offline/last seen)
- [x] Mesh group access control (userMeshGroups)

### 5.5 — Test Coverage
- [x] mesh.test.ts, meshClient.test.ts, meshInterNode.test.ts, meshScheduler.test.ts, queryRouter.test.ts

---

## Phase 6 — Meeting Mode: Ephemeral Knowledge Sharing

> **Not started.** Design spec below — no schema, routes, or UI exist.

**Goal:** Ephemeral knowledge-sharing sessions with room codes, participant management, and cross-device query synthesis.

### 6.1 — Session Management

```typescript
interface MeetingSession {
  id: string;
  code: string;                  // 6-digit room code
  creatorId: string;
  participants: SessionParticipant[];
  status: "active" | "ended";
  createdAt: string;
  expiresAt: string;
}

interface SessionParticipant {
  userId: string;
  nodeId: string;
  sharedDataSources: string[];
  joinedAt: string;
}
```

**API routes:**
```
POST   /api/sessions              # Create session (returns room code)
POST   /api/sessions/join         # Join by room code
GET    /api/sessions/:id          # Session details + participants + shared data sources
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
5. Ollama generates synthesized answer on coordinator
6. Answer streamed to all session participants via SSE

### 6.3 — Session UI

- `CreateSession` — form to create session, displays room code
- `JoinSession` — room code input
- `SessionView` — participant list, shared data sources, chat interface
- `DataSourceSharePanel` — toggle which of your data sources to share
- `SessionChat` — question/answer thread, per-data-source citation indicators

---

## Phase 7 — Mobile: iOS & Android Companion Apps

> **V2+ roadmap.** No implementation planned for V1.

- Swift/SwiftUI iOS app as data source node in mesh
- Join meeting sessions via room code
- Android app (Kotlin/Jetpack Compose) after iOS validates concept

---

## Monorepo Structure

```
edgebric/
├── packages/
│   ├── core/          # Business logic — ingestion, RAG, PII detection. Zero deps.
│   ├── api/           # Express server — REST endpoints, SSE, group chats, mesh, integrations
│   ├── web/           # React (Vite + TanStack Router + shadcn/ui) — all UIs
│   └── desktop/       # macOS Electron menu bar app (setup wizard + server manager)
├── shared/
│   └── types/         # TypeScript interfaces shared across packages
├── spikes/            # Completed throwaway experiments
├── scripts/           # Dev setup helpers
├── docs/              # Product documentation (01-12)
├── e2e/               # Playwright E2E tests
├── e2e-live/          # E2E tests against live server
└── package.json       # Workspace root (pnpm workspaces)
```

---

## What NOT to Build Yet

| Temptation | Why Skip |
|---|---|
| Billing / subscriptions | License validation stubbed — not needed until paid distribution |
| Multi-office federation | Same-network mesh first, cross-network later |
| Mobile apps | Phase 7 — desktop product ships first |
| Custom AI model training | Out of scope — use off-the-shelf models |
| App auto-update | Ollama auto-update works; app auto-update is Phase D4 |

---

## Order of Work

```
Phase 1:  Multi-data-source, auth, org model, security, privacy, UI    COMPLETE
Phase 2:  Productization — validation, testing, hardening              COMPLETE
Phase 3:  Group chats — collaborative data source sharing + threads     COMPLETE
Phase 4:  Integrations — Slack bot, cloud storage sync                 NEXT
Phase 5:  Mesh networking, cross-node query routing                    COMPLETE
Phase 6:  Meeting mode, session management, session UI                 AFTER INTEGRATIONS
Phase 7:  iOS app, Android app                                         POST-LAUNCH
```

**The shipping milestone:** A non-technical office manager downloads a `.dmg`, drags to Applications, launches the app, walks through the setup wizard, and has a working private AI knowledge assistant with group collaboration for their team within 10 minutes.
