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

**Decision:** Distributing knowledge bases across physical devices by department is a security architecture decision, not an organizational convenience feature.

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

### KB-01 — Personal vs. Organization Knowledge Bases

**Decision:** Every user can create personal knowledge bases. Organization KBs are admin-managed. Both are first-class citizens.

**Personal KBs:**
- Created by any authenticated user
- Stored on the user's device (or on the server node, associated with their account)
- Private by default — never searchable by anyone else
- Can be selectively shared in meeting sessions (granular, per-KB opt-in)
- Use cases: project notes, research, personal reference documents

**Organization KBs:**
- Created and managed by administrators
- Stored on designated devices (in distributed mode) or the primary node (in org mode)
- Accessible to all employees (or scoped by department in distributed mode)
- Use cases: HR policies, employee handbook, benefits guides, compliance documents

**Why both matter:**
- Org KBs provide the institutional knowledge layer (the original product)
- Personal KBs give every employee a daily reason to use Edgebric (not just occasional HR queries)
- Meeting mode creates emergent value by combining both — cross-pollination of personal and institutional knowledge

---

### KB-02 — Granular Sharing Controls

**Decision:** When sharing KBs in a meeting session, users have per-KB granular control.

**What this means:**
- A user might have 5 personal KBs but only share 2 in a given meeting
- Each KB shows a toggle: shared / not shared for this session
- Sharing is session-scoped: it dissolves when the session ends
- No "share everything" default — explicit opt-in only

**Why not just share everything?** A marketing lead might have a KB with competitive intelligence they'd share in a strategy meeting but not in an all-hands. A lawyer might share compliance checklists but not client case files. Granularity is essential for trust.

---

### AUTH-01 — Authentication Model

Authentication posture varies by surface, designed to maximize privacy by default.

| Surface | Auth Method | Identity Exposure |
|---|---|---|
| Admin dashboard | OIDC/SSO (Google dev IdP for dev, generic OIDC for prod) | Full identity, logged |
| Employee standard mode | OIDC/SSO login → anonymous queryToken UUID in session | Queries not linked to identity |
| Employee incognito mode (V2) | Biometric (vault access only) | None — no server contact during query |
| Meeting mode | Authenticated user + room code | Identity visible to session participants |

**Session cookies:** httpOnly, session-file-store. No localStorage tokens.

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

Edgebric is model-agnostic. The inference layer targets the OpenAI-compatible API spec.

**Recommended defaults (March 2026):**
- Coordinator / server-side: Qwen3.5-9B Q4_K_M (~5.8GB)
- Constrained hardware / KB-only nodes: Qwen3.5-4B Q4_K_M (~2.6GB)
- iOS / incognito: Qwen3.5-2B Q4_K_M
- Embedding: nomic-embed-text (768-dim, runs via mILM)

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

### ANALYTICS-01 — Aggregate Analytics Anonymization

Topic clusters do not surface until minimum **5 distinct queries** contribute. Below threshold, grouped into "Other." For very small teams, analytics can be disabled entirely.

---

### UX-01 — Escalation in Incognito Mode

The "Request verification" button is absent in Incognito Mode. Escalation requires identifying yourself — fundamentally incompatible with incognito. Employee must exit incognito first with explicit confirmation.

---

### PRICING-01 — Hardware vs. Cloud Cost Structure

**Decision:** Lead with the hardware cost comparison in marketing.

| | Edgebric | Cloud HR AI (typical) |
|---|---|---|
| 100-person company | $599 one-time (Mac Mini M4) | $3,600-$20,400/year |
| 200-person company | $599-$800 one-time | $7,200-$40,800/year |
| Break-even | Month 1 | Never (recurring) |
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

Where does meeting session state (participant list, opted-in KBs, room code mapping) live?
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
