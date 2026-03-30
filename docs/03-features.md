# Feature Requirements

Features are organized into three release tiers: **Demo**, **MVP**, and **V2**.

**Demo** is the minimum required to demonstrate the distributed architecture. **MVP** is a shippable product. **V2** is the growth roadmap.

---

## 3.1 Data Source Management

### Vault Data Sources (Personal, Device-Local)

**Demo**
- [ ] Create vault data source (name, optional description)
- [ ] Upload PDF, Word (.docx), plain text (.txt, .md) to vault data source
- [ ] View list of vault data sources with document count and last updated
- [ ] Query vault data source in private chat

**MVP**
- [ ] Multiple vault data sources per user (e.g., "Project Alpha Notes," "My Research")
- [ ] Delete documents from vault data source
- [ ] Re-upload / update documents (triggers re-ingestion)
- [ ] Storage usage indicator (helps users manage device storage)
- [ ] Share vault data sources selectively into group chats

**V2**
- [ ] Import from Google Drive (OAuth, per-user)
- [ ] Import from Notion (per-user workspace)
- [ ] Data source templates (pre-configured structure for common use cases)

### Network Data Sources (Admin-Managed, Org Network)

**Demo**
- [ ] Admin creates network data sources (e.g., "HR Policies," "Employee Handbook")
- [ ] Upload PDF, Word (.docx), plain text (.txt, .md) via drag-and-drop
- [ ] Document type detection (magic bytes, not extension)
- [ ] Ingestion status display (processing / ready / failed)

**MVP**
- [ ] Docling for layout-aware PDF extraction (tables, multi-column, headings preserved)
- [ ] Tesseract OCR fallback for scanned/image-based PDFs
- [ ] Mammoth for Word (.docx) → clean Markdown extraction
- [ ] Semantic chunking by heading hierarchy (not fixed character count)
- [ ] Table chunking: tables kept as atomic chunks with column headers embedded
- [ ] Chunk metadata: source document, section path, page number, heading
- [ ] PII detection pass before embedding — admin warning if personal data patterns detected
- [ ] Document classification: admin must tag as `Policy / Public` before ingest
- [ ] Document metadata stored: name, upload date, section headings, page numbers
- [ ] Admin can archive or delete documents
- [ ] Re-ingestion triggered on document update
- [ ] Document staleness alerts (configurable threshold, default 6 months)
- [ ] Data sources list/table view with sorting and filters (alongside card view)

**V2**
- [ ] Google Drive folder sync (OAuth, polling for changes)
- [ ] SharePoint folder sync (Microsoft Graph API)
- [ ] Excel (.xlsx) ingestion — structured table extraction
- [ ] HTML / Confluence export ingestion
- [ ] Personal records upload — admin assigns documents to specific employee IDs
- [ ] Personal records encrypted at rest per employee; write-once, admin cannot retrieve

---

## 3.2 AI Q&A — Core Experience

**Demo**
- [ ] Natural language question input
- [ ] RAG pipeline: embed query → hybrid search (BM25 + vector via sqlite-vec) → generate grounded answer
- [ ] Answer displayed with inline source citation: document name, section, page number
- [ ] Streaming response via SSE
- [x] Conversation context maintained across sessions (persistent multi-turn via SQLite)

**MVP**
- [ ] Clickable source link opens original document at the relevant section
- [ ] Prominent, non-dismissible disclaimer on every response
- [ ] Graceful no-answer: if no relevant chunks retrieved, respond with redirect to administrator — no hallucinated answer
- [ ] Query-time semantic filter: queries containing person's name + sensitive terms intercepted before retrieval
- [x] Conversations linked to users via session email; accessible in conversation viewer
- [ ] Feedback (thumbs up/down) on AI responses

**V2**
- [ ] Highlighted source passage in original document view
- [ ] Suggested follow-up questions
- [ ] Answer confidence indicator (low confidence → stronger prompt to verify)
- [ ] Voice input support
- [ ] Multi-language Q&A

---

## 3.3 Distributed Data Source Mesh

### Device Discovery & Mesh

**Demo**
- [ ] mDNS-based auto-discovery of Edgebric nodes on local network
- [ ] Node registry: each node advertises its available data sources
- [ ] Health status per node (online / offline / degraded)
- [ ] Graceful degradation: queries to offline nodes return "unavailable" with explanation

**MVP**
- [ ] Coordinator election — coordinator node for query routing
- [ ] Cross-device query routing: query travels to relevant data source node(s), results return to requester
- [ ] Multi-node response synthesis: answers drawn from multiple data sources are merged with per-data-source citations
- [ ] Node auto-reconnection: returning device re-joins mesh automatically
- [ ] Admin node management dashboard: view all nodes, their data sources, and status

**V2**
- [ ] Multi-office federation via account-based clustering (same account, different networks)
- [ ] Data source replication for high-availability (same data source on multiple nodes)
- [ ] Load balancing across nodes with same data source
- [ ] Cross-network mesh via proximity clustering

### Department / Security Isolation

**Demo**
- [ ] Assign network data sources to specific nodes (data-source-to-device binding)
- [ ] Query routing respects data-source-to-node assignments

**MVP**
- [ ] Department-level access control: which users can query which data sources
- [ ] Admin assigns data source access by role/department
- [ ] Audit log: which data sources were queried (not what was asked) per session
- [ ] Cross-department query requires explicit admin-configured permission

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
- [ ] Context summarization for long conversations (auto-compress older messages)

**V2**
- [ ] Read receipts
- [ ] Typing indicators
- [ ] File attachments in chat
- [ ] Group chat templates (pre-configured data source sets)

---

## 3.5 Meeting Mode (Distributed)

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

### Slack Bot

**MVP (deferred — post group chats)**
- [ ] "Add to Slack" OAuth install flow in admin settings
- [ ] Socket Mode connection (outbound WebSocket — works behind firewalls)
- [ ] @Edgebric mention in any channel triggers RAG query against accessible data sources
- [ ] Bot responds in threaded replies to keep channels clean
- [ ] Privacy notice on integration setup page
- [ ] Bot posts brief privacy disclaimer on first interaction in each channel
- [ ] Per-channel data source configuration (which data sources the bot can query)

**V2**
- [ ] Microsoft Teams bot integration
- [ ] Direct message queries to bot (not just channel @mentions)
- [ ] Multi-turn conversation context within Slack threads

### Email Notifications (General-Purpose)

**MVP**
- [ ] Group chat invite notifications
- [ ] Data source share notifications
- [ ] Chat expiration warnings
- [ ] Configurable notification preferences per user

---

## 3.7 Admin Dashboard

**Demo**
- [ ] Secure admin login (OIDC/SSO — Google dev IdP for development, generic OIDC for production)
- [ ] Network data source management (create, upload, view, delete)
- [ ] Node status view (discovered devices and their data sources)

**MVP**
- [ ] Data Sources page: all data sources with list/table and card views, sorting, filters
- [ ] PII warning display during ingestion
- [ ] Document staleness alerts
- [ ] User management: invite, roles, permissions
- [ ] Integration settings: Slack bot, email notifications
- [ ] Node management: assign data sources to devices, view health

**V2**
- [ ] Aggregate query analytics: topic clusters (min 5 queries to surface a topic)
- [ ] Unanswered questions list
- [ ] Query volume trends (weekly/monthly graphs)
- [ ] Policy gap report: exportable unanswered questions by topic
- [ ] SSO integration (Okta, Azure AD) for admin login
- [ ] Role-based access (admin vs. viewer vs. super admin)
- [ ] Multi-department dashboard views

---

## 3.8 Authentication & Security

**MVP**
- [x] Admin + employee login via OIDC/SSO (Google dev IdP for development)
- [x] Role by email: ADMIN_EMAILS env var determines admin access
- [x] Post-login: anonymous queryToken UUID in session (queries not linked to identity)
- [x] Session cookies (httpOnly, session-file-store)
- [ ] Device token required for all API requests
- [ ] Admin can view and revoke device tokens

**V2**
- [ ] Incognito mode: biometric gate (Face ID / fingerprint) on vault access
- [ ] Incognito vault contents encrypted with device-bound key (secure enclave)
- [ ] SSO option with identity warning in UI
- [ ] Session timeout for incognito mode (configurable, default 30 minutes inactivity)
- [ ] Per-data-source access control lists

---

## 3.9 iOS Companion App

**Demo**
- [ ] iOS app with Ollama-compatible local inference
- [ ] App hosts sqlite-vec locally — functions as a data source node in the mesh
- [ ] Upload documents to on-device data source from iOS Files / Photos
- [ ] Auto-discovery: app joins the mesh via mDNS and advertises its data sources
- [ ] Join meeting sessions via room code
- [ ] Opt in device-local data sources to meeting session

**MVP**
- [ ] Vault data source management on iOS (create, upload, delete)
- [ ] Private query interface (query own data sources locally on phone)
- [ ] Push notifications for group chat invites and meeting invites

**V2**
- [ ] Incognito mode on iOS (biometric vault, zero-network query)
- [ ] Background mesh participation (app contributes data sources even when in background)
- [ ] Offline vault data source queries (no mesh needed for own data)

---

## 3.10 Deployment & Infrastructure

**Demo**
- [ ] Runs on macOS with Ollama for inference and sqlite-vec for vector storage
- [ ] Single-device setup: one command to start
- [ ] Multi-device demo: MacBook coordinator + additional knowledge nodes
- [ ] Configuration via environment file

**MVP**
- [ ] Admin setup wizard: organization name, admin credentials, first data source creation
- [ ] Automatic device discovery via mDNS
- [ ] Works fully offline after initial setup
- [ ] macOS, Linux support
- [ ] Docker Compose for single-node deployment

**V2**
- [ ] Windows support
- [ ] Health dashboard: node status, resource usage, uptime across all mesh devices
- [ ] Automatic Ollama updates (with rollback)
- [ ] Pre-configured appliance image (flash to Mac Mini, plug in, done)

---

## 3.11 Incognito Mode (V2)

**V2**
- [ ] Lock icon in UI to enter Incognito Mode
- [ ] Pre-download modal: plain-language explanation, device requirements, download size
- [ ] Biometric gate (Face ID / fingerprint) required to unlock incognito vault
- [ ] One-time download: company policy embeddings + local LLM
- [ ] All query processing on-device: embedding → vector search → generation
- [ ] Zero network requests during active query
- [ ] No group chat or collaboration features in incognito (incompatible by design)
- [ ] Clear exit path with explicit confirmation
- [ ] Personal records sub-feature: download own records for local-only querying
