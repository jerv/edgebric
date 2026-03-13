# Feature Requirements

Features are organized into three release tiers: **Demo**, **MVP**, and **V2**.

**Demo** is the minimum required to demonstrate the distributed architecture to mimik. **MVP** is a shippable product. **V2** is the growth roadmap.

---

## 3.1 Knowledge Base Management

### Personal Knowledge Bases (All Users)

**Demo**
- [ ] Create personal knowledge base (name, optional description)
- [ ] Upload PDF, Word (.docx), plain text (.txt, .md) to personal KB
- [ ] View list of personal KBs with document count and last updated
- [ ] Query personal KB in private chat

**MVP**
- [ ] Multiple personal KBs per user (e.g., "Project Alpha Notes," "My Research")
- [ ] Delete documents from personal KB
- [ ] Re-upload / update documents (triggers re-ingestion)
- [ ] KB storage usage indicator (helps users manage device storage)

**V2**
- [ ] Import from Google Drive (OAuth, per-user)
- [ ] Import from Notion (per-user workspace)
- [ ] KB templates (pre-configured structure for common use cases)

### Organization Knowledge Bases (Admin-Managed)

**Demo**
- [ ] Admin creates organization KBs (e.g., "HR Policies," "Employee Handbook")
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
- [ ] RAG pipeline: embed query → retrieve top-k chunks → generate grounded answer
- [ ] Answer displayed with inline source citation: document name, section, page number
- [ ] Streaming response via SSE
- [x] Conversation context maintained across sessions (persistent multi-turn via SQLite)

**MVP**
- [ ] Clickable source link opens original document at the relevant section
- [ ] Prominent, non-dismissible disclaimer on every response
- [x] "Request verification" escalation button on every standard-mode response
- [ ] Graceful no-answer: if no relevant chunks retrieved, respond with redirect to administrator — no hallucinated answer
- [ ] Query-time semantic filter: queries containing person's name + sensitive terms intercepted before retrieval
- [x] Conversations linked to users via session email; accessible in conversation viewer
- [ ] Feedback (thumbs up/down) on AI responses and admin replies

**V2**
- [ ] Highlighted source passage in original document view
- [ ] Suggested follow-up questions
- [ ] Answer confidence indicator (low confidence → stronger prompt to verify)
- [ ] Voice input support
- [ ] Multi-language Q&A

---

## 3.3 Distributed Knowledge Mesh

### Device Discovery & Mesh

**Demo**
- [ ] mimik mDNS-based auto-discovery of Edgebric nodes on local network
- [ ] Node registry: each node advertises its available knowledge bases
- [ ] Health status per node (online / offline / degraded)
- [ ] Graceful degradation: queries to offline nodes return "unavailable" with explanation

**MVP**
- [ ] Supernode election (mimik handles this) — coordinator node for query routing
- [ ] Cross-device query routing: query travels to relevant KB node(s), results return to requester
- [ ] Multi-node response synthesis: answers drawn from multiple KBs are merged with per-source citations
- [ ] Node auto-reconnection: returning device re-joins mesh automatically
- [ ] Admin node management dashboard: view all nodes, their KBs, and status

**V2**
- [ ] Multi-office federation via mimik account-based clustering (same account, different networks)
- [ ] KB replication for high-availability (same KB on multiple nodes)
- [ ] Load balancing across nodes with same KB
- [ ] Cross-network mesh via mimik proximity clustering

### Department / Security Isolation

**Demo**
- [ ] Assign organization KBs to specific nodes (KB-to-device binding)
- [ ] Query routing respects KB-to-node assignments

**MVP**
- [ ] Department-level access control: which users can query which KBs
- [ ] Admin assigns KB access by role/department
- [ ] Audit log: which KBs were queried (not what was asked) per session
- [ ] Cross-department query requires explicit admin-configured permission

**V2**
- [ ] Sensitivity tiers: public → internal → confidential → restricted
- [ ] Automatic tier enforcement: restricted KBs only queryable by named users
- [ ] Compliance reporting: data residency proof per KB per device

---

## 3.4 Meeting Mode

**Demo**
- [ ] Create meeting session (generates room code)
- [ ] Join session via room code
- [ ] See participant list and their opted-in KBs
- [ ] Opt in/out personal KBs for the session (granular per-KB control)
- [ ] Ask questions that query all opted-in KBs across all participants' devices
- [ ] Synthesized answers with citations from each contributing KB
- [ ] End session (dissolves all ephemeral sharing)

**MVP**
- [ ] Session expiry (auto-close after configurable inactivity, default 2 hours)
- [ ] Session transcript export (questions and answers only, not source documents)
- [ ] Participant can leave session without ending it for others
- [ ] Session creator can remove participants
- [ ] Organization KBs can be pre-attached to sessions by admin
- [ ] Visual indicator showing which KBs contributed to each answer

**V2**
- [ ] Recurring session codes (same code for weekly standup)
- [ ] Session templates (pre-configured KB sets for common meeting types)
- [ ] Meeting notes generation (AI-summarized key Q&A from session)
- [ ] Calendar integration (auto-create session for scheduled meetings)

---

## 3.5 Escalation & Human-in-the-Loop

**Demo**
- [x] "Request verification" button on every standard-mode response (absent in incognito / meeting mode)
- [x] Employee selects escalation target and delivery method (Slack DM or email)
- [x] Escalation dispatched via Slack Bot Token or SMTP email
- [x] Admin escalation log: timestamped audit view with target, method, delivery status

**MVP**
- [x] Employee optionally includes the AI's answer for context when escalating
- [x] Admin can reply to escalation — reply appended to conversation as admin message
- [x] Admin can resolve escalation without reply (system note in conversation)
- [x] Employee notification when escalation is replied to or resolved
- [x] Read/unread tracking with badge counts
- [x] Conversation viewer: read-only view of full message thread
- [x] CSV export includes target, method, and read status columns

**V2**
- [ ] Microsoft Teams integration for escalations
- [ ] SLA tracking: flag escalations unanswered beyond configurable threshold
- [ ] Escalation resolution feeds back into gap detection analytics

---

## 3.6 Admin Dashboard

**Demo**
- [ ] Secure admin login (OIDC/SSO — Google dev IdP for development, generic OIDC for production)
- [ ] Organization KB management (create, upload, view, delete)
- [ ] Node status view (discovered devices and their KBs)

**MVP**
- [ ] Document library: all uploaded documents, type, status, last updated date
- [ ] PII warning display during ingestion
- [ ] Document staleness alerts
- [ ] Aggregate query analytics: topic clusters (min 5 queries to surface a topic)
- [ ] Unanswered questions list
- [x] Escalation integration settings: configure Slack Bot Token or SMTP email
- [x] Escalation targets management: add/edit/delete people who receive escalations
- [x] Escalation log with reply/resolve workflow
- [ ] Node management: assign KBs to devices, view health

**V2**
- [ ] Query volume trends (weekly/monthly graphs)
- [ ] Policy gap report: exportable unanswered questions by topic
- [ ] SSO integration (Okta, Azure AD) for admin login
- [ ] Role-based access (admin vs. viewer vs. super admin)
- [ ] Multi-department dashboard views

---

## 3.7 Authentication & Security

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
- [ ] Per-KB access control lists

---

## 3.8 iOS Companion App

**Demo**
- [ ] iOS app with mimik mim OE runtime embedded (CocoaPods: EdgeCore + mim-OE-ai-SE-iOS-developer)
- [ ] App hosts mKB locally — functions as a knowledge node in the mesh
- [ ] Upload documents to on-device KB from iOS Files / Photos
- [ ] Auto-discovery: app joins the mesh and advertises its KBs
- [ ] Join meeting sessions via room code
- [ ] Opt in device-local KBs to meeting session

**MVP**
- [ ] Personal KB management on iOS (create, upload, delete)
- [ ] Private query interface (query own KBs locally on phone)
- [ ] Push notifications for escalation replies and meeting invites

**V2**
- [ ] Incognito mode on iOS (biometric vault, zero-network query)
- [ ] Background mesh participation (app contributes KBs even when in background)
- [ ] Offline personal KB queries (no mesh needed for own data)

---

## 3.9 Deployment & Infrastructure

**Demo**
- [ ] Runs on mimik mim OE runtime on macOS
- [ ] Single-device setup: one command to start
- [ ] Multi-device demo: MacBook coordinator + iPhone knowledge nodes
- [ ] Configuration via environment file

**MVP**
- [ ] Admin setup wizard: organization name, admin credentials, first KB creation
- [ ] Automatic device discovery via mimik edge service mesh
- [ ] Works fully offline after initial setup
- [ ] macOS, Linux support
- [ ] Docker Compose for single-node deployment

**V2**
- [ ] Windows support
- [ ] Health dashboard: node status, resource usage, uptime across all mesh devices
- [ ] Automatic mim OE runtime updates
- [ ] Pre-configured appliance image (flash to Mac Mini, plug in, done)

---

## 3.10 Incognito Mode (V2)

**V2**
- [ ] Lock icon in UI to enter Incognito Mode
- [ ] Pre-download modal: plain-language explanation, device requirements, download size
- [ ] Biometric gate (Face ID / fingerprint) required to unlock incognito vault
- [ ] One-time download: company policy embeddings + local LLM
- [ ] All query processing on-device: embedding → vector search → generation
- [ ] Zero network requests during active query
- [ ] No escalation button in incognito (incompatible by design)
- [ ] Clear exit path with explicit confirmation
- [ ] Personal records sub-feature: download own records for local-only querying
