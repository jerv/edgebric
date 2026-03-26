# Design Decisions & Open Questions

---

## Resolved Decisions

### MESH-01 — Why Distributed Architecture Requires mimik

**Decision:** The distributed knowledge architecture is built on mimik's edge mesh because no alternative provides the same combination of capabilities without introducing a central aggregation point that defeats the privacy model.

**What mimik provides that alternatives don't:**

| Capability | mimik | Without mimik |
|---|---|---|
| Device discovery | mDNS auto-discovery, zero config | Manual IP config or central registry server |
| Cross-device queries | HTTP routing through mesh | Central API gateway aggregating all data |
| Local AI inference | mILM on each device | Cloud API or single-server inference |
| Local vector storage | mKB on each device | Central vector database |
| iOS/Android nodes | Native SDKs (CocoaPods/Maven) | Custom P2P networking from scratch |
| Multi-node coordination | mAIChain fan-out + synthesis | Custom orchestration layer |

**The key test:** "Could we build this without mimik?" Yes — but only by routing all data through a central server, which means all knowledge is in one place, which means the physical isolation guarantee is gone. At that point, you're just building another cloud AI with on-prem hosting.

---

### MESH-02 — Department Isolation Is Security Architecture, Not Convenience

**Decision:** Distributing data sources across physical devices by department is a security architecture decision, not an organizational convenience feature.

**Why this matters:**
- Access control lists can be misconfigured, bypassed, or escalated through privilege vulnerabilities
- A central database holding all company knowledge is a single point of compromise
- Physical device isolation means a compromised HR node literally cannot access Legal's data — the data isn't there
- This is the difference between "we configured permissions correctly" and "the data physically doesn't exist on this machine"

**Scaling down:** Organizations that don't need department isolation can run everything on one device (Org Mode). The architecture doesn't force distribution — it enables it when the security posture demands it.

---

### MEET-01 — Room Codes for Meeting Sessions (Not Network Proximity)

**Decision:** Meeting sessions are gated by room codes, not by network proximity or device discovery alone.

**Why room codes, not auto-discovery:**
- Network proximity includes everyone on the network — intern Bob sitting outside the conference room shouldn't auto-join the board strategy meeting
- Room codes provide explicit opt-in: you only join if you have the code
- Codes can be shared via any channel (Slack, email, verbally, on a whiteboard)
- Codes work across network boundaries if needed (via mimik account-based clustering)
- Simple UX: "enter this code to join" is universally understood

**Code format:** 6-character alphanumeric or organizer-chosen label (e.g., "LAUNCH-Q3"). Auto-generated codes avoid collisions via timestamp + random suffix.

---

### DS-01 — Data Source Types: Vault vs. Network

**Decision:** Data sources come in two types. Network data sources are admin-managed and stored on the org's network. Vault data sources are personal, device-local, and encrypted.

**Vault Data Sources:**
- Created by any authenticated user
- Stored encrypted on the user's device
- Private by default — never searchable by anyone else
- Can be selectively shared in group chats or meeting sessions (granular, per-data-source opt-in)
- Use cases: project notes, research, personal reference documents

**Network Data Sources:**
- Created and managed by administrators
- Stored on designated devices (in distributed mode) or the primary node (in org mode)
- Accessible to all employees (or scoped by department in distributed mode)
- Use cases: HR policies, employee handbook, benefits guides, compliance documents

**Why both matter:**
- Network data sources provide the institutional knowledge layer (the original product)
- Vault data sources give every employee a daily reason to use Edgebric (not just occasional HR queries)
- Group chats and meeting mode create emergent value by combining both — cross-pollination of personal and institutional knowledge

---

### DS-02 — Granular Sharing Controls

**Decision:** When sharing data sources in group chats or meeting sessions, users have per-data-source granular control with explicit confirmation.

**What this means:**
- A user might have 5 vault data sources but only share 2 in a given group chat
- Each data source requires explicit confirmation with a warning dialog explaining what data becomes accessible
- In group chats: sharing persists until the chat expires or the sharer removes it
- In meeting sessions: sharing dissolves when the session ends
- No "share everything" default — explicit opt-in only

**Why not just share everything?** A marketing lead might have a data source with competitive intelligence they'd share in a strategy discussion but not in an all-hands. A lawyer might share compliance checklists but not client case files. Granularity is essential for trust.

---

### AUTH-01 — Authentication Model

Authentication posture varies by app mode and surface, designed to maximize privacy by default.

**Three app modes (one Electron app):**

| Mode | Auth | Description |
|---|---|---|
| **Solo** (free) | None — no login, no OIDC | Single user on their own machine. Full product, free forever. |
| **Admin** (org) | OIDC/SSO setup required | Multi-user org server. Admin configures OIDC provider, sets admin emails. License required. |
| **Member** (coming soon) | Connects to org server | Employee connects to an existing Admin-mode instance on the network. |

**Auth by surface (Admin/Member modes):**

| Surface | Auth Method | Identity Exposure |
|---|---|---|
| Admin dashboard | OIDC/SSO (Google dev IdP for dev, generic OIDC for prod) | Full identity, logged |
| Employee standard mode | OIDC/SSO login → anonymous queryToken UUID in session | Queries not linked to identity |
| Employee incognito mode (V2) | Biometric (vault access only) | None — no server contact during query |
| Meeting mode | Authenticated user + room code | Identity visible to session participants |

**Solo mode:** No auth at all. No OIDC, no login screen, no session management. The user launches the app and starts querying. The paywall is the OIDC setup step — configuring SSO for multi-user access requires a license.

**Session cookies (Admin/Member):** httpOnly, session-file-store. No localStorage tokens.

**Role by email:** ADMIN_EMAILS env var. Simple, works for MVP. Proper role management in V2.

---

### SEC-01 — Preventing Employee Data Leakage

**This is solved architecturally, not by guardrails alone.**

**Layer 1 — Document classification at upload (primary protection)**
Admins must explicitly tag every document as `Policy / Public` before ingestion. Personal records are never in the shared index.

**Layer 2 — PII detection at ingestion (accident prevention)**
spaCy NER runs on every document before chunking. If patterns matching `PERSON + sensitive term` are detected, admin sees a blocking warning.

**Layer 3 — System prompt guardrail (defense in depth)**
LLM is instructed to never surface information about named individuals.

**Layer 4 — Query-time semantic filter**
Queries containing a person's name + sensitive terms are intercepted before retrieval.

**On jailbreaking:** Layers 1 and 2 are the actual protection. If personal records aren't in the index, no jailbreak can surface them.

---

### SEC-02 — Personal Records in Incognito Mode (V2)

Employees can download their own personal records for private querying.

- HR admin uploads personal documents, assigns to specific employee IDs
- Server stores an encrypted package per employee (write-once; admin cannot retrieve)
- Employee downloads in incognito mode using email + OTP
- Package stored in biometric-gated local vault
- All queries run 100% locally; zero network contact
- Personal index contains only that employee's own data

---

### MODEL-01 — Model Strategy

Edgebric is model-agnostic. The inference layer targets the OpenAI-compatible API spec. **Ollama** is the inference backend, auto-managed by the desktop app (download, start, stop, auto-update with rollback). This replaces the previous llama-server approach.

**Ollama management:**
- Desktop app downloads and manages Ollama automatically — users never interact with Ollama directly
- Users can install, load, and unload multiple models from within the app
- Model picker dropdown in the chat interface lets users select which model to use
- RAM and disk usage displayed per model so users can manage resources
- Auto-update with rollback: Ollama binary is updated on app launch if a newer version is available, with automatic rollback if the update fails

**Recommended defaults (March 2026):**
- Coordinator / server-side: Qwen3.5-9B Q4_K_M (~5.8GB)
- Constrained hardware / data-source-only nodes: Qwen3.5-4B Q4_K_M (~2.6GB)
- iOS / incognito: Qwen3.5-2B Q4_K_M
- Embedding: nomic-embed-text (768-dim)

**Confirmed from spikes:** Qwen2.5-1.5B insufficient for production (fails multi-column table reading and "I don't know" instruction following). Qwen3.5-4B confirmed good enough via Spike 4.

---

### INGEST-01 — PDF Handling & Document Processing

- **Docling** (IBM open source) — primary PDF extractor; layout-aware, table-aware
- **Tesseract OCR** — fallback for scanned/image-only PDFs
- **Mammoth** — Word (.docx) extraction
- **Semantic chunking** at heading/section boundaries; tables kept as atomic chunks
- Chunk sizes: 100-800 tokens, 50-token overlap

**Confirmed from Spike 3:** Docling handles IRS Pub 15, DOL FMLA, Medicare & You cleanly. Table extraction works end-to-end (confirmed Spike 2 + 4).

---

### COLLAB-01 — Group Chats Replace Escalations

**Decision:** The escalation system (escalation targets, Slack DM/email dispatch, admin reply workflow) is removed entirely. Group chats replace this functionality with a more natural, collaborative approach.

**Why:**
- Escalations were a workaround for "I need help from a person." Group chats solve this natively — invite the expert, share the data source, discuss in context.
- Group chats support threaded async discussion, which is more useful than a one-shot escalation/reply cycle.
- The bot participates in group chats only when @tagged, so humans can discuss freely.
- Expiration controls (24h, 1w, 1m, never) provide appropriate data lifecycle management.

**What's kept:** General-purpose email notifications (for group chat invites, data source shares, expiration warnings).

---

### INTEGRATION-01 — Slack Bot Architecture

**Decision:** Slack bot integration uses Socket Mode (outbound WebSocket) for on-prem compatibility. Planned for post-group-chat stabilization.

**Key design choices:**
- **Socket Mode, not HTTP webhooks** — works behind corporate firewalls without opening inbound ports
- **Privacy notice required** — displayed during integration setup AND as a brief disclaimer on first bot interaction in each channel
- **Query/response text transits Slack's cloud** — this is inherent to using Slack and is the same trust model as any Slack bot. Source documents never leave the network.
- **No cost from Slack** — Slack doesn't charge for app development or distribution
- **Threaded replies** — bot responds in threads to keep channels clean

---

### UX-01 — Incognito Mode Restrictions

Group chats and collaboration features are absent in Incognito Mode. Collaboration requires identifying yourself — fundamentally incompatible with incognito. Employee must exit incognito first with explicit confirmation.

---

### UX-02 — Terminology: "Data Sources" Not "Knowledge Bases"

**Decision:** User-facing terminology uses "Data Sources" (not "Knowledge Bases").

**Data source types:**
- **Network Data Sources** — stored on the org's network servers, admin-managed
- **Vault Data Sources** — stored encrypted on an individual member's device, personal

**Top-level page:** "Data Sources" (the page where you browse all data sources)

**Why "Data Sources":** It's what non-technical users intuitively understand — these are the data sources the AI draws answers from. "Add a data source" is clearer than "Create a knowledge base" (legacy term). Industry precedent: Glean, Perplexity both use "Sources."

**Why not other terms:**
- "Workspace" — conflicts with org concept
- "Collection" — too technical (vector DB term)
- "Vault" — already used for the encryption feature specifically
- "Repository" — developer connotation

---

### UX-03 — Analytics Deferred to V2

**Decision:** The analytics dashboard page is removed from the current release. Analytics will be rebuilt from scratch after core features (group chats, integrations, data source management) are stable and real usage patterns inform what metrics actually matter.

**V2 analytics** will include: aggregate topic clusters (min 5 queries), unanswered questions, query volume trends.

---

### PRICING-01 — Pricing & Distribution Model

**Decision:** Self-service distribution. Solo mode is free forever. License required only for multi-user (org) mode. See [11-pricing-distribution.md](11-pricing-distribution.md) for full details.

**Summary:**
- **Solo mode** — free, full product, single user, no auth, no time limit. This replaces the 30-day trial concept.
- **Org mode paywall** — configuring OIDC/SSO for multi-user access requires a license.
- **Perpetual license**: $499 one-time (free updates within major version, discount offered for major version upgrades — amount uncommitted)
- **Subscription**: $49/mo (always latest, monthly only — costs more than license over 12 months)
- No per-user pricing. Unlimited users on the node.
- No sales team. No tiered pricing at launch.
- Distribution via website + GUI installer (Electron). macOS only at launch.
- Payments/licensing via LemonSqueezy or Paddle (handles keys, tax, delivery).

**Hardware cost comparison (marketing angle):**

| | Edgebric | Cloud HR AI (typical) |
|---|---|---|
| Solo user | Free (runs on any Mac) | $30-60/mo per user |
| 15-person company | $499 license + $499 Mac Mini = $998 total | $3,600-$9,000/year |
| Break-even vs cloud | Month 1 | Never (recurring) |
| Data custody | Customer owns hardware + data | Vendor holds data |
| Ongoing costs | Electricity (~$10/year) | Subscription + overages |

**On-prem software model:** We sell software, not a service. The customer buys/owns the hardware. This means:
- SOC 2 barely applies to us (we never touch their data)
- HIPAA BAA is simpler (we're a software vendor, not a data processor)
- Compliance burden shifts to the customer's existing IT infrastructure
- Minimum viable compliance for us: privacy policy, ToS, DPA template, one-page architecture doc

---

### DEMO-01 — Three-Device Demo Strategy

**Decision:** The primary demo uses 3 devices: MacBook (coordinator + mILM + mKB) + 2 iPhones (mKB knowledge nodes).

**Why this setup:**
- MacBook runs the coordinator node, API server, web UI, and has the most compute for mILM
- Each iPhone runs the mimik iOS SDK, hosts a local mKB with different knowledge
- Demonstrates: auto-discovery, cross-device query, meeting mode, physical data isolation
- Works over WiFi hotspot (no corporate network needed)

**Target audience:** mimik leadership. Language to use: "device-first," "data sovereignty," "agentic," "zero-config," "autonomous nodes."

See [09-demo-plan.md](09-demo-plan.md) for detailed demo script.

---

## Open Questions

### OPEN-01 — mAIChain API Specification

mAIChain's "response synthesis" mechanism is undocumented publicly. We know it fans out queries to multiple Agent Machines and synthesizes responses, but the exact API spec (request format, how synthesis works, configuration) needs to be confirmed with mimik or reverse-engineered from the .tar container.

**Fallback:** If mAIChain doesn't meet our needs, we can implement fan-out and synthesis in our own coordinator service using raw HTTP calls to each node's mKB + a single mILM call for synthesis. This is more work but gives us full control.

### OPEN-02 — Meeting Mode Session State Persistence

Where does meeting session state (participant list, opted-in data sources, room code mapping) live?
- Option A: On the coordinator node (simplest, single point of failure)
- Option B: Distributed across participants via mesh (resilient, complex)
- Leaning toward A for MVP — session state is small and ephemeral.

### OPEN-03 — Model Update Cadence

How does an admin get notified that a better recommended model is available? Needs a lightweight notification mechanism that doesn't require external connectivity.

### OPEN-04 — Post-Termination Personal Records

When an employee leaves, should their personal records package be deleted? Configurable retention policy needed. Legal question varies by jurisdiction.

### OPEN-05 — iOS App Distribution

For demo: TestFlight (free, up to 100 testers). For production: App Store or enterprise distribution? Enterprise distribution ($299/year) avoids App Store review but limits to organizations. Decision depends on go-to-market strategy.

### OPEN-06 — mKB Chunk Deletion

mKB currently has no per-chunk delete API. Deleting a document doesn't remove its chunks. Current workaround: delete and recreate the entire dataset. This is acceptable for MVP but needs a better solution for production.
