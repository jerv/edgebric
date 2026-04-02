> **Status: CURRENT** — Audited against codebase on 2026-03-31. Checkbox states reflect actual implementation.

# Feature Requirements

Features are organized into three release tiers: **Demo**, **MVP**, and **V2**.

**Demo** is the minimum required to demonstrate the distributed architecture. **MVP** is a shippable product. **V2** is the growth roadmap.

---

## 3.1 Data Source Management

### Vault Data Sources (Personal, Device-Local)

**Demo**
- [x] Create vault data source (name, optional description)
- [x] Upload PDF, Word (.docx), plain text (.txt, .md) to vault data source
- [x] View list of vault data sources with document count and last updated
- [x] Query vault data source in private chat

**MVP**
- [x] Multiple vault data sources per user (e.g., "Project Alpha Notes," "My Research")
- [x] Delete documents from vault data source
- [x] Re-upload / update documents (triggers re-ingestion)
- [ ] Storage usage indicator (helps users manage device storage)
- [x] Share vault data sources selectively into group chats

**V2**
- [ ] Import from Google Drive (OAuth, per-user) — connector structure exists, UI integration incomplete
- [ ] Import from Notion (per-user workspace) — schema prepared, no implementation
- [ ] Data source templates (pre-configured structure for common use cases)

### Network Data Sources (Admin-Managed, Org Network)

**Demo**
- [x] Admin creates network data sources (e.g., "HR Policies," "Employee Handbook")
- [x] Upload PDF, Word (.docx), plain text (.txt, .md) via drag-and-drop
- [x] Document type detection (magic bytes, not extension)
- [x] Ingestion status display (processing / ready / failed)

**MVP**
- [x] Docling for layout-aware PDF extraction (tables, multi-column, headings preserved)
- [ ] Tesseract OCR fallback for scanned/image-based PDFs
- [x] Mammoth for Word (.docx) → clean Markdown extraction
- [x] Semantic chunking by heading hierarchy (not fixed character count)
- [x] Table chunking: tables kept as atomic chunks with column headers embedded
- [x] Chunk metadata: source document, section path, page number, heading
- [x] PII detection pass before embedding — admin warning if personal data patterns detected
- [x] Document classification: admin must tag as `Policy / Public` before ingest
- [x] Document metadata stored: name, upload date, section headings, page numbers
- [x] Admin can archive or delete documents
- [x] Re-ingestion triggered on document update
- [x] Document staleness alerts (configurable threshold, default 6 months) — schema ready, UI pending
- [x] Data sources list/table view with sorting and filters (alongside card view)
- [x] Parent-child chunk retrieval — child chunks (256 tokens) for embedding precision, parent chunks (1024 tokens) for LLM context

**V2**
- [ ] Google Drive folder sync (OAuth, polling for changes) — schema + connector structure exists
- [ ] SharePoint folder sync (Microsoft Graph API) — schema prepared
- [ ] Excel (.xlsx) ingestion — structured table extraction
- [ ] HTML / Confluence export ingestion — schema prepared
- [ ] Personal records upload — admin assigns documents to specific employee IDs
- [ ] Personal records encrypted at rest per employee; write-once, admin cannot retrieve

---

## 3.2 AI Q&A — Core Experience

**Demo**
- [x] Natural language question input
- [x] RAG pipeline: embed query → hybrid search (BM25 + vector via sqlite-vec) → generate grounded answer
- [x] Answer displayed with inline source citation: document name, section, page number
- [x] Streaming response via SSE
- [x] Conversation context maintained across sessions (persistent multi-turn via SQLite)

**MVP**
- [ ] Clickable source link opens original document at the relevant section
- [x] Prominent, non-dismissible disclaimer on every response
- [x] Graceful no-answer: if no relevant chunks retrieved, respond with redirect to administrator — no hallucinated answer
- [x] Query-time semantic filter: queries containing person's name + sensitive terms intercepted before retrieval
- [x] Conversations linked to users via session email; accessible in conversation viewer
- [x] Feedback (thumbs up/down) on AI responses
- [x] Answer type detection — classifies responses as grounded/blended/general/blocked
- [x] Citation validation — strips hallucinated source references
- [x] Inference queue management — rate limits concurrent LLM inferences
- [x] Cross-encoder reranking — optional reranker for improved search relevance

**V2**
- [ ] Highlighted source passage in original document view
- [ ] Suggested follow-up questions
- [ ] Answer confidence indicator (low confidence → stronger prompt to verify) — schema field exists, UI pending
- [ ] Voice input support
- [ ] Multi-language Q&A

---

## 3.3 Distributed Data Source Mesh

### Device Discovery & Mesh

**Demo**
- [x] mDNS-based auto-discovery of Edgebric nodes on local network (via bonjour-service, desktop-only)
- [x] Node registry: each node advertises its available data sources
- [x] Health status per node (online / offline / connecting)
- [x] Graceful degradation: queries to offline nodes return "unavailable" with explanation

**MVP**
- [x] Primary/secondary role assignment (meshConfig.role)
- [x] Cross-device query routing: query travels to relevant data source node(s), results return to requester
- [x] Multi-node response synthesis: answers drawn from multiple data sources are merged with per-data-source citations
- [x] Heartbeat scheduler (30s interval, 90s stale timeout)
- [x] Admin node management dashboard: view all nodes, their data sources, and status
- [x] Mesh token authentication — prevents rogue devices from querying

**V2**
- [ ] Multi-office federation via account-based clustering (same account, different networks)
- [ ] Data source replication for high-availability (same data source on multiple nodes)
- [ ] Load balancing across nodes with same data source
- [ ] Cross-network mesh via proximity clustering

### Department / Security Isolation

**Demo**
- [x] Assign network data sources to specific nodes (data-source-to-device binding)
- [x] Query routing respects data-source-to-node assignments

**MVP**
- [x] Department-level access control: which users can query which data sources
- [x] Admin assigns data source access by role/department (userMeshGroups)
- [x] Audit log: immutable hash-chained log of data source access
- [x] Cross-department query requires explicit admin-configured permission

**V2**
- [ ] Sensitivity tiers: public → internal → confidential → restricted
- [ ] Automatic tier enforcement: restricted data sources only queryable by named users
- [ ] Compliance reporting: data residency proof per data source per device

---

## 3.4 Group Chats

**MVP**
- [x] Create group chat (name, expiration: 24h / 1w / 1m / never)
- [x] Invite members (creator only, with confirmation warnings)
- [x] Share data sources into group chat (any member, with confirmation dialog)
- [x] @bot / @edgebric to query shared data sources — bot only responds when tagged
- [x] Human-to-human conversation flows freely without bot intervention
- [x] Threaded replies (flat threads, like Discord) — branch off any message
- [x] Bot reads conversation/thread context before responding
- [x] Real-time updates via SSE (new messages, member joins/leaves, data source shares)
- [x] Creator can remove members; members can leave
- [x] Context summarization for long conversations (auto-compress older messages)

**V2**
- [ ] Read receipts
- [ ] Typing indicators
- [ ] File attachments in chat
- [ ] Group chat templates (pre-configured data source sets)

---

## 3.5 Meeting Mode (Distributed)

> **Not implemented.** Spec below is the design target.

**Demo**
- [ ] Create meeting session (generates room code)
- [ ] Join session via room code
- [ ] See participant list and their opted-in data sources
- [ ] Opt in/out data sources for the session (granular per-data-source control)
- [ ] Ask questions that query all opted-in data sources across all participants' devices
- [ ] Synthesized answers with citations from each contributing data source
- [ ] End session (dissolves all ephemeral sharing)

**MVP**
- [ ] Session expiry (auto-close after configurable inactivity, default 2 hours)
- [ ] Session transcript export (questions and answers only, not source documents)
- [ ] Participant can leave session without ending it for others
- [ ] Session creator can remove participants
- [ ] Network data sources can be pre-attached to sessions by admin
- [ ] Visual indicator showing which data sources contributed to each answer

**V2**
- [ ] Recurring session codes (same code for weekly standup)
- [ ] Session templates (pre-configured data source sets for common meeting types)
- [ ] Meeting notes generation (AI-summarized key Q&A from session)
- [ ] Calendar integration (auto-create session for scheduled meetings)

---

## 3.6 Integrations

### Cloud Storage Connectors

> Schema and connector framework exists (cloudConnections, cloudFolderSyncs, cloudOauthTokens tables).

**V1.0**
- [ ] Google Drive OAuth flow + folder sync
- [ ] OneDrive/SharePoint folder sync
- [ ] Confluence sync
- [ ] Notion sync
- [ ] Admin integration settings UI (IntegrationsTab covers cloud storage)

**Post-V1.0** (contributor-friendly additions)
- [ ] Dropbox
- [ ] Box
- [ ] Other cloud storage providers

### Slack Bot

> **Not implemented.** Deferred — post group chats.

**MVP**
- [ ] "Add to Slack" OAuth install flow in admin settings
- [ ] Socket Mode connection (outbound WebSocket — works behind firewalls)
- [ ] @Edgebric mention in any channel triggers RAG query against accessible data sources
- [ ] Bot responds in threaded replies to keep channels clean
- [ ] Per-channel data source configuration

**V2**
- [ ] Microsoft Teams bot integration
- [ ] Direct message queries to bot (not just channel @mentions)

### Notifications

**Implemented:**
- [x] In-app notification system with SSE streaming
- [x] Unread notification counts
- [x] Notification types: group_chat_invite, group_chat_message, group_chat_mention, source_shared, chat_expiring

**Not implemented:**
- [ ] Email delivery (no sending infrastructure — in-app only)
- [ ] User notification preferences

---

## 3.7 Admin Dashboard

**Demo**
- [x] Secure admin login (OIDC/SSO — V1.0: Google, Microsoft. Post-V1.0: Okta, OneLogin, Ping, generic OIDC)
- [x] Network data source management (create, upload, view, delete)
- [x] Node status view (discovered devices and their data sources)

**MVP**
- [x] Data Sources page: all data sources with list/table and card views, sorting, filters
- [x] PII warning display during ingestion
- [x] Document staleness alerts — schema ready, UI pending
- [x] User management: invite, roles (owner/admin/member), permissions
- [x] Integration settings: privacy modes, cloud storage
- [x] Node management: assign data sources to devices, view health
- [x] Onboarding wizard (org → data source → upload → query)

**V2**
- [ ] Aggregate query analytics: topic clusters
- [ ] Unanswered questions list
- [ ] Query volume trends (weekly/monthly graphs)
- [ ] Policy gap report: exportable unanswered questions by topic
- [ ] Multi-department dashboard views

---

## 3.8 Authentication & Security

**MVP**
- [x] Admin + employee login via OIDC/SSO (V1.0: Google, Microsoft. Post-V1.0: Okta, OneLogin, Ping, generic OIDC)
- [x] Role by email: ADMIN_EMAILS env var determines admin access
- [x] Post-login: anonymous queryToken UUID in session (queries not linked to identity)
- [x] Session cookies (httpOnly, session-file-store)
- [x] CSRF protection (double-submit cookie, timing-safe comparison)
- [x] Rate limiting (global: 100/min, query: 20/min, OAuth: 5/min)
- [x] CSP headers via Helmet + HSTS in production
- [x] Zod input validation on all routes
- [x] Per-data-source access control lists (dataSourceAccess table)
- [x] Immutable hash-chained audit log

**V2**
- [ ] Incognito mode: biometric gate (Face ID / fingerprint) on vault access — UI skeleton exists
- [ ] Incognito vault contents encrypted with device-bound key
- [ ] Device token enforcement for all API requests — middleware exists but unused

---

## 3.9 iOS Companion App

> **Not planned for V1.** V2+ roadmap item.

- [ ] iOS app with local inference or data-source-only mode
- [ ] sqlite-vec search endpoint accessible to mesh peers
- [ ] Join meeting sessions via room code

---

## 3.10 Deployment & Infrastructure

**Demo**
- [x] Runs on macOS with llama-server for inference and sqlite-vec for vector storage
- [x] Single-device setup via desktop app setup wizard
- [x] Multi-device demo via mesh networking
- [x] Configuration via environment file

**MVP**
- [x] Desktop app setup wizard: org name, auth config, first data source, model download
- [x] mDNS-based device discovery (desktop-only, via bonjour-service)
- [x] Works fully offline after initial setup
- [x] macOS support (primary), Linux via Docker
- [x] Docker Compose for single-node deployment (Dockerfile + docker-compose.yml)
- [x] Self-signed TLS certificate generation (HTTPS by default for Admin mode)

**V2**
- [ ] Windows support
- [ ] Health dashboard: node status, resource usage, uptime across all mesh devices
- [ ] Pre-configured appliance image (flash to Mac Mini, plug in, done)

---

## 3.11 Privacy Modes

**Implemented:**
- [x] Standard mode — default baseline, full features
- [x] Private Mode — disables query tracking, anonymous queries
- [x] Vault Mode — on-device only with AES-256-GCM encryption, llama-server local inference
- [x] Privacy context in UI (PrivacyContext.tsx, PrivacyTab.tsx, ExitPrivacyDialog.tsx)

**V2 — Incognito Enhancements:**
- [ ] Biometric gate (Face ID / fingerprint) required to unlock
- [ ] One-time download: company policy embeddings + local LLM
- [ ] Zero network requests during active query
- [ ] Personal records sub-feature: download own records for local-only querying
