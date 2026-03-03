# Feature Requirements

Features are organized into three release tiers: **MVP**, **V2**, and **Future**.

---

## 3.1 Document Ingestion

**MVP**
- [ ] Upload PDF, Word (.docx), plain text (.txt, .md) via drag-and-drop
- [ ] Document type detection (magic bytes, not extension)
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
- [ ] Ingestion status display (processing / ready / failed)

**V2**
- [ ] Google Drive folder sync (OAuth, polling for changes)
- [ ] SharePoint folder sync (Microsoft Graph API)
- [ ] Confluence space import
- [ ] Automatic re-sync when source documents change
- [ ] Excel (.xlsx) ingestion — structured table extraction via pandas
- [ ] HTML / Confluence export ingestion (BeautifulSoup + html2text)
- [ ] Personal records upload — admin assigns documents to specific employee IDs
- [ ] Personal records encrypted at rest per employee; write-once, admin cannot retrieve

**Future**
- [ ] Notion workspace import
- [ ] PowerPoint (.pptx) ingestion
- [ ] Slack channel archive ingestion
- [ ] Multi-language document support

---

## 3.2 AI Q&A — Core Experience

**MVP**
- [ ] Natural language question input
- [ ] RAG pipeline: embed query → retrieve top-k chunks → generate grounded answer
- [ ] Answer displayed with inline source citation: document name, section, page number
- [ ] Clickable source link opens original document at the relevant section
- [ ] Prominent, non-dismissible disclaimer on every response:
      `⚠️ This is not legal advice. Always verify important decisions with HR or a qualified professional.`
- [ ] "Ask HR to verify this" escalation button on every standard-mode response
- [ ] Graceful no-answer: if no relevant chunks retrieved, respond with
      "I couldn't find a clear answer in the current documentation. Please contact HR directly." — no hallucinated answer
- [ ] Query-time semantic filter: queries containing a person's name + sensitive terms (salary, PIP, fired, complaint, accommodation) are intercepted before retrieval and returned with a redirect to HR
- [ ] Conversation context maintained within a single session (multi-turn)
- [ ] Session reset on new conversation

**V2**
- [ ] Highlighted source passage in original document view (not just page-level citation)
- [ ] "Was this helpful?" thumbs up/down per response
- [ ] Suggested follow-up questions
- [ ] Answer confidence indicator (low confidence → stronger prompt to verify with HR)

**Future**
- [ ] Voice input support
- [ ] Multi-language Q&A (question in any language, answer in same language)
- [ ] Citation comparison when multiple policy documents conflict

---

## 3.3 Incognito Mode

**V2**
- [ ] Lock icon in UI to enter Incognito Mode
- [ ] Pre-download modal: plain-language explanation of what incognito means technically, minimum device requirements, estimated download size
- [ ] Minimum spec check before offering download (RAM, available storage)
- [ ] MDM detection with fallback: "Your device may be managed by company IT policy — Incognito Mode may not be available on managed devices"
- [ ] Biometric gate (Face ID / fingerprint) required to unlock the incognito vault — not just device passcode
- [ ] Encrypted local vault for storing: policy embeddings + (optionally) personal record package
- [ ] One-time download: company policy embeddings (~5–50MB) + local LLM (~1.8GB)
- [ ] All query processing on-device: embedding → vector search → generation
- [ ] Zero network requests during active query (confirmed by visible network-blocked indicator)
- [ ] Background embedding sync when on company network (silent, incremental — only re-downloads changed chunks)
- [ ] Incognito indicator persistent throughout session
- [ ] No "Ask HR to verify" button — escalation not available in incognito (incompatible by design)
- [ ] Clear exit path: "Leave Incognito Mode" with explicit confirmation: "You are leaving Incognito Mode. Your next question will be visible to HR."
- [ ] Personal records sub-feature:
  - [ ] "Download My Personal Records" option within incognito vault
  - [ ] Email + OTP authentication for download (server logs download event only, not queries)
  - [ ] Personal package stored encrypted in biometric-gated vault
  - [ ] All personal record queries run locally — same zero-network guarantee as policy queries
  - [ ] System prompt scoped to employee's own data only

**Future**
- [ ] Native mobile incognito (iOS, Android apps)
- [ ] Automatic model update prompts when a better recommended model is available
- [ ] Admin-side: ability to push a policy embeddings update to all enrolled devices

---

## 3.4 HR Admin Dashboard

**MVP**
- [ ] Secure admin login (username/password; SSO in V2)
- [ ] Document library: all uploaded documents, type, status, last updated date
- [ ] Drag-and-drop document upload with classification tagging
- [ ] PII warning display during ingestion
- [ ] Document staleness alerts (configurable threshold, default 6 months)
- [ ] Aggregate query analytics: topic clusters (min 5 queries to surface a topic)
- [ ] Unanswered questions list: queries where Edgebric returned no confident answer
- [ ] Escalation inbox: questions forwarded by employees via "Ask HR to verify"
- [ ] Escalation response: HR replies from dashboard, response delivered to employee
- [ ] Device token management: view enrolled devices, revoke lost/terminated devices

**V2**
- [ ] Personal records management: upload documents, assign to employee IDs, revoke access
- [ ] Query volume trends (weekly/monthly graphs)
- [ ] Policy gap report: exportable unanswered questions by topic
- [ ] Document update workflow: flag for review, assign to team member
- [ ] SSO integration (Okta, Azure AD)

**Future**
- [ ] Role-based access (HR admin vs. HR viewer vs. super admin)
- [ ] Multi-department support (separate document sets per team: HR, Legal, IT)
- [ ] Slack / Teams notifications for escalations and staleness alerts

---

## 3.5 Escalation & Human-in-the-Loop

**MVP**
- [ ] "Ask HR to verify this answer" button on every standard-mode response (absent in incognito)
- [ ] Employee optionally includes the AI's answer for context when escalating
- [ ] HR notified via email (configurable recipient)
- [ ] HR responds via dashboard or email reply
- [ ] Employee receives HR's response in-app or via email
- [ ] Escalation logged with timestamp for compliance records

**V2**
- [ ] Slack / Teams integration for HR escalation notifications
- [ ] SLA tracking: flag escalations unanswered beyond configurable time threshold
- [ ] Escalation resolution feeds back into gap detection analytics

---

## 3.6 Authentication & Device Security

**MVP**
- [ ] Admin dashboard: username/password authentication
- [ ] Employee standard mode: anonymous device token (issued at first launch on company network)
- [ ] Device token required for all API requests — not just network presence
- [ ] Admin can view and revoke device tokens (lost device, terminated employee)
- [ ] No identity-linked data stored server-side for employee standard mode
- [ ] Incognito mode: biometric gate (Face ID / fingerprint) on vault access
- [ ] Incognito vault contents encrypted with device-bound key (secure enclave)

**V2**
- [ ] SSO option for employee standard mode (Okta, Azure AD) — opt-in per company, displays identity warning in UI
- [ ] Admin SSO
- [ ] Session timeout for incognito mode (configurable, default 30 minutes inactivity)

---

## 3.7 Deployment & Infrastructure

**MVP**
- [ ] Runs on mimik mim OE runtime
- [ ] Single-command deploy (Docker Compose or mim OE equivalent)
- [ ] Configuration via environment file
- [ ] Admin setup wizard: company name, admin credentials, first document upload
- [ ] Automatic device discovery via mimik edge service mesh (no IP configuration needed)
- [ ] Works fully offline after initial setup
- [ ] macOS, Linux support

**V2**
- [ ] Windows Server support
- [ ] Health dashboard: server status, resource usage, uptime
- [ ] Automatic mim OE runtime updates

**Future**
- [ ] Multi-node deployment (failover, load distribution)
- [ ] Kubernetes deployment manifest
