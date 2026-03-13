# Development Plan

---

## Current State

The existing codebase has a working single-node Edgebric:
- **packages/api/** — Express backend with OIDC auth, SQLite + Drizzle, escalation/notification routes, SSE streaming, document upload + ingestion
- **packages/web/** — Vite + React + TanStack Router, admin dashboard, employee query interface, conversation viewer, escalation reply/resolve workflow
- **packages/core/** — Chunker, query filter, system prompt (2 test files)
- **packages/edge/** — mimik API wrappers (mILM, mKB)
- **shared/types/** — TypeScript interfaces
- **End-to-end working:** upload → Docling extract → chunk → embed via mILM → store in mKB → query → SSE stream → citations

**What needs to happen:** Transform this single-node chatbot into a distributed knowledge platform with multi-device mesh, meeting mode, and personal KBs — with demo readiness as the first milestone.

---

## Phase Sequencing

```
Phase 1: Foundation — Personal KBs + Multi-KB Architecture       (prerequisite for everything)
Phase 2: iOS Companion App — Knowledge node on iPhone              (prerequisite for demo)
Phase 3: Mesh Discovery + Cross-Device Queries                     (the core distributed feature)
Phase 4: Meeting Mode — Session management + room codes            (the daily-use hook)
Phase 5: Demo Polish — Three-device demo readiness                 (mimik demo)
Phase 6: Productization — Onboarding, org management, hardening    (shippable product)
```

---

## Phase 1 — Foundation: Multi-KB Architecture + Personal Knowledge Bases

**Goal:** Transform the current single-dataset model into a multi-KB system where users can create, manage, and query their own knowledge bases alongside organization KBs.

### 1.1 — Data Model Changes

**`shared/types/src/index.ts`** — New interfaces:

```typescript
interface KnowledgeBase {
  id: string;                      // UUID
  name: string;                    // e.g., "HR Policies", "My Research"
  description?: string;
  type: "organization" | "personal";
  ownerId: string;                 // admin email (org) or user email (personal)
  nodeId?: string;                 // which device hosts this KB (null = primary node)
  datasetName: string;             // mKB dataset name (unique per KB)
  documentCount: number;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

interface KBDocument {
  id: string;
  knowledgeBaseId: string;         // FK to KnowledgeBase
  name: string;
  type: "pdf" | "docx" | "txt" | "md";
  status: "processing" | "ready" | "failed";
  pageCount?: number;
  sectionHeadings: string[];
  storageKey: string;
  uploadedAt: string;
  updatedAt: string;
}
```

**`packages/api/src/db/schema.ts`** — New tables:
- `knowledge_bases` — id, name, description, type, owner_id, node_id, dataset_name, document_count, status, timestamps
- Refactor `documents` → `kb_documents` with `knowledge_base_id` FK

### 1.2 — KB Management API

**New routes in `packages/api/src/routes/`:**

```
POST   /api/knowledge-bases              # Create KB (personal or org)
GET    /api/knowledge-bases              # List user's KBs (personal) + org KBs they can access
GET    /api/knowledge-bases/:id          # KB details + document list
DELETE /api/knowledge-bases/:id          # Delete KB (personal only, or admin for org)
PUT    /api/knowledge-bases/:id          # Update name/description

POST   /api/knowledge-bases/:id/documents/upload    # Upload document to specific KB
DELETE /api/knowledge-bases/:id/documents/:docId     # Remove document from KB
```

### 1.3 — Multi-KB Query Routing

**`packages/core/src/rag/orchestrator.ts`** — Update to accept multiple KB dataset names:

```typescript
async function answer(
  query: string,
  kbDatasetNames: string[],     // query across multiple KBs
  session: Session,
  deps: { embed, search, generate }
): Promise<AnswerResponse>
```

- Query embeds once, searches across all specified mKB datasets
- Citations tagged with which KB each result came from
- UI shows KB source alongside document/section/page

### 1.4 — Frontend: KB Management UI

**`packages/web/`** — New components:
- `KnowledgeBaseList` — shows personal KBs + org KBs with create/manage actions
- `KnowledgeBaseDetail` — document list, upload, status for a single KB
- `KBSelector` — choose which KBs to query (in query interface)
- Sidebar: rename "Documents" to "Knowledge Base"
- Employee view: "My Knowledge Bases" section

### 1.5 — Migration

- Migrate existing `documents` table data into new `kb_documents` structure
- Create a default "Policy Documents" organization KB for existing uploads
- Maintain backward compatibility with existing API consumers during transition

---

## Phase 2 — iOS Companion App

**Goal:** Build an iOS app that runs mimik mim OE Runtime, hosts a local mKB, and functions as a knowledge node in the mesh.

### 2.1 — Project Setup

- Xcode project with Swift/SwiftUI
- CocoaPods: `EdgeCore` + `mim-OE-ai-SE-iOS-developer`
- iOS 16.0+ target, physical device only
- mimik developer account + edge license

### 2.2 — Core iOS Features

```swift
// App architecture:
// 1. Start mim OE runtime on app launch
// 2. Deploy mKB microservice via MCM
// 3. Create local dataset, accept document uploads
// 4. Advertise KB availability to mesh
// 5. Respond to incoming search queries from mesh peers
```

**MVP iOS features:**
- Start/stop mimik runtime
- Create personal KB (name, upload documents from iOS Files)
- Simple document viewer (list uploaded docs)
- mKB search endpoint accessible to mesh peers
- Join meeting session via room code input
- KB sharing toggle per session (granular)

**What the iOS app does NOT do (MVP):**
- No local mILM inference (phone is a KB node, not an inference node)
- No full chat UI (queries go through the web app or coordinator)
- No offline query (requires mesh connection)

### 2.3 — Document Handling on iOS

- Accept files from iOS Files app, Photos (for scanned docs), or clipboard
- On-device text extraction: PDFKit for text PDFs, Vision framework for OCR
- Chunking uses the same `packages/core` logic (ported to Swift or called via JS bridge)
- Chunks embedded via mILM call to coordinator node (phone doesn't run embedding model)
- Vectors stored in local mKB on the phone

### 2.4 — Mesh Integration

- App registers with mimik mesh on startup
- Advertises available KBs with metadata (name, document count, dataset name)
- Responds to `/search` requests from other mesh nodes
- Handles session join/leave for meeting mode

---

## Phase 3 — Mesh Discovery + Cross-Device Queries

**Goal:** Enable automatic device discovery and cross-device query routing so that a query on one device can search knowledge bases on other devices.

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

- Polls mimik mesh for discovered devices
- Tracks which KBs are on which nodes
- Updates status on heartbeat/timeout
- Exposes `GET /api/nodes` for admin dashboard

### 3.2 — Cross-Device Query Router

**`packages/api/src/services/queryRouter.ts`:**

```typescript
async function routeQuery(
  query: string,
  targetKBs: string[],     // KB IDs to search
  nodeRegistry: NodeRegistry
): Promise<CrossNodeResult[]>
```

- Looks up which nodes host the target KBs
- For local KBs: direct mKB search
- For remote KBs: HTTP request through mimik mesh to the remote node's search endpoint
- Parallel fan-out to all relevant nodes
- Collects results, tags with source node + KB
- Passes merged results to mILM on coordinator for synthesis

### 3.3 — Remote Search Endpoint

Each node exposes a standardized search endpoint that mesh peers can call:

```
POST /api/mesh/search
Body: { query: string, datasetName: string, topN: number }
Response: { chunks: ChunkResult[], nodeId: string, kbName: string }
```

This is the endpoint the coordinator calls when it needs to search a KB on a remote device.

### 3.4 — Admin Node Dashboard

**`packages/web/src/components/admin/NodeDashboard.tsx`:**
- List all discovered mesh nodes with status
- Show which KBs are on each node
- Assign organization KBs to specific nodes
- Health indicators (online/offline/last seen)

---

## Phase 4 — Meeting Mode

**Goal:** Implement ephemeral knowledge-sharing sessions with room codes, participant management, and cross-device query synthesis.

### 4.1 — Session Management

**`packages/api/src/services/sessionStore.ts`:**

```typescript
interface MeetingSession {
  id: string;
  code: string;                  // room code
  creatorId: string;             // email of creator
  participants: SessionParticipant[];
  status: "active" | "ended";
  createdAt: string;
  expiresAt: string;
}

interface SessionParticipant {
  userId: string;                // email
  nodeId: string;                // their device
  sharedKBs: string[];           // KB IDs they've opted in
  joinedAt: string;
}
```

**API routes:**
```
POST   /api/sessions              # Create session (returns room code)
POST   /api/sessions/join         # Join session by room code
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

**`packages/web/src/components/meeting/`:**
- `CreateSession` — form to create session, displays room code
- `JoinSession` — room code input
- `SessionView` — participant list, shared KBs, chat interface
- `KBSharePanel` — toggle which of your KBs to share in this session
- `SessionChat` — question/answer thread, per-KB citation indicators

### 4.4 — Real-Time Session Updates

- Use SSE for session state updates (participant joins/leaves, KB sharing changes)
- All participants see the same chat thread
- Coordinator node manages session state

---

## Phase 5 — Demo Polish

**Goal:** Make the three-device demo (MacBook + 2 iPhones) flawless for the mimik leadership demo.

### 5.1 — Demo Data Preparation

- Curate 3 distinct knowledge bases with realistic content:
  - KB 1 (iPhone A): "Marketing — Campaign Brief" (product claims, messaging, audience)
  - KB 2 (iPhone B): "Legal — Compliance Checklist" (regulatory requirements, restrictions)
  - KB 3 (MacBook): "Engineering — Release Notes" (features, known issues, timelines)
- Prepare 5 demo questions that require cross-KB synthesis:
  - "Are there any compliance issues with our marketing claims?"
  - "What features are shipping in Q3 and what's the marketing angle for each?"
  - "Which release items need legal review before announcement?"

### 5.2 — Demo Flow Script

See [09-demo-plan.md](09-demo-plan.md) for full script. Key moments:
1. Auto-discovery: show phones appearing in mesh
2. Meeting mode: create session, phones join via code
3. Cross-device query: question hits all 3 KBs, synthesized answer
4. Physical isolation: show that KB data is on each device, not central
5. Graceful degradation: pull one phone off network, query handles it
6. Recovery: phone reconnects, auto-rediscovers

### 5.3 — UI Polish

- Loading states for cross-device queries (which nodes are being queried)
- Per-KB citation indicators (color-coded or labeled by source KB)
- Session participant avatars/names
- Clean mobile-responsive design for demo on phones

---

## Phase 6 — Productization

**Goal:** Transform the demo into a shippable product. See [08-productization.md](08-productization.md) for full requirements.

### 6.1 — Organization & User Management

- Organization model: name, plan, settings, created_at
- User roles: owner, admin, member
- Onboarding wizard: create org → configure auth → create first KB → upload first document
- Invite flow: admin invites users by email

### 6.2 — Security Hardening

- CORS configuration (dynamic, per-org)
- Rate limiting (per-user, per-org)
- Input validation (zod schemas on all API routes)
- CSRF protection
- Content Security Policy headers

### 6.3 — Deployment

- Docker Compose for single-node
- Docker image with mimik runtime bundled
- Environment variable documentation
- Health check endpoint
- Graceful shutdown handling

### 6.4 — Testing

- Unit tests for core business logic (chunker, query filter, orchestrator)
- Integration tests for API routes
- E2E tests for critical flows (upload → query → answer)
- iOS app: XCTest for mimik runtime lifecycle

### 6.5 — Monitoring & Observability

- Structured logging (replace console.log with pino)
- Request tracing (correlation IDs across mesh queries)
- Error tracking
- Resource usage monitoring per node

---

## Monorepo Structure (Updated)

```
edgebric/
├── packages/
│   ├── core/          # Business logic — ingestion, RAG, PII detection. Zero deps.
│   ├── api/           # Express server — REST endpoints, SSE, session management
│   ├── web/           # React (Vite + TanStack Router + shadcn/ui) — all UIs
│   ├── edge/          # mimik API client — mILM, mKB, mAIChain, mesh discovery
│   └── ios/           # Swift iOS app — knowledge node (Xcode project)
├── shared/
│   └── types/         # TypeScript interfaces shared across packages
├── spikes/            # Completed throwaway experiments (all 4 spikes PASS)
├── scripts/           # Dev setup, deploy helpers, mimik binary management
├── docs/              # Product documentation (this file and 01-09)
└── package.json       # Workspace root (pnpm workspaces)
```

---

## What NOT to Build Yet

| Temptation | Why Skip |
|---|---|
| mAIChain integration | Implement our own fan-out first; mAIChain API undocumented |
| Full role-based access control | ADMIN_EMAILS env var is fine through Phase 5 |
| Incognito mode | V2 — complex, requires biometric APIs, not needed for demo |
| Android app | iOS first (demo devices are iPhones), Android in V2 |
| Multi-office federation | Same-network mesh first, cross-network in V2 |
| Billing / subscriptions | Not needed until product launch |
| CI/CD pipeline | Manual deploy is fine through demo phase |

---

## Order of Work

```
Weeks 1-2:  Phase 1 — Multi-KB architecture, personal KBs, migration
Weeks 3-4:  Phase 2 — iOS app scaffold, mim OE runtime, basic KB hosting
Weeks 5-6:  Phase 3 — Mesh discovery, cross-device query routing
Weeks 7-8:  Phase 4 — Meeting mode, session management, session UI
Week 9:     Phase 5 — Demo polish, data prep, rehearsal
Weeks 10+:  Phase 6 — Productization (ongoing)
```

These are sequencing guides, not deadlines. Phase 1 and Phase 2 can partially overlap (TypeScript backend work + Swift app scaffold are independent). Phase 3 requires both to be working.

**The demo-worthy milestone:** Create a meeting session on the MacBook → 2 iPhones join with room code → each shares a different KB → cross-domain question gets synthesized answer with citations from all 3 devices → pull one phone off network → graceful degradation → reconnect → auto-recovery.
