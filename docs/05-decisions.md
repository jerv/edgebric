# Design Decisions & Open Questions

---

## Resolved Decisions

### AUTH-01 — Authentication Model ✅

Authentication posture varies by surface, designed to maximize privacy by default.

| Surface | Auth Method | Identity Exposure |
|---|---|---|
| Admin dashboard | Username/password (SSO — V2) | Full identity, logged |
| Employee standard mode | Anonymous device token | None — token is not linked to identity |
| Employee incognito mode | Biometric (vault access only) | None — no server contact during query |

**Employee device tokens:** Issued at first launch on the company network. A UUID, not linked to employee identity. Required for all standard-mode API requests — not just network presence. Admin can revoke any token (lost device, terminated employee). A stranger on the network without a registered token gets nothing.

**Incognito vault:** Biometric (Face ID / fingerprint) required to open — not just device passcode. Contents encrypted with a device-bound key derived from the secure enclave. A lost phone with extracted storage files yields encrypted garbage without the biometric.

**SSO (V2):** Companies requiring mandatory identity can enable SSO. When enabled, a persistent in-UI warning is displayed: "⚠️ Authenticated Mode: your identity is associated with this session." This is opt-in per company, not the default.

---

### SEC-01 — Preventing Employee Data Leakage ✅

**This is solved architecturally, not by guardrails alone.**

The root cause of "tell me Sarah's salary" attacks is personal employee records being in the same retrieval index as policy documents. The solution is to ensure they are never there.

**Layer 1 — Document classification at upload (primary protection)**
Admins must explicitly tag every document as `Policy / Public` before ingestion. Personal records (performance reviews, disciplinary files, salary records, medical accommodations, investigation records) are never in the shared index. A system that doesn't contain Sarah's salary cannot reveal it.

**Layer 2 — PII detection at ingestion (accident prevention)**
spaCy NER runs on every document before chunking. If patterns matching `PERSON + sensitive term` (salary, PIP, termination, accommodation, investigation) are detected, admin sees a blocking warning before the document can be added. Makes accidents deliberate rather than passive.

**Layer 3 — System prompt guardrail (defense in depth)**
LLM is instructed to never surface information about named individuals. Catches edge cases where a policy doc includes an illustrative example with a real name.

**Layer 4 — Query-time semantic filter**
Queries containing a person's name combined with sensitive terms (salary, fired, PIP, complaint, accommodation, performance) are intercepted before retrieval and redirected: "Edgebric provides company-wide policy information and cannot access records about specific individuals. Please contact your administrator or the relevant team directly."

**On jailbreaking:** Layer 3 (system prompt) can theoretically be jailbroken. This is why Layers 1 and 2 are the actual protection. If personal records aren't in the index, no jailbreak can surface them. Layers 3 and 4 are defense-in-depth for edge cases only.

---

### SEC-02 — Personal Records in Incognito Mode ✅

Employees can optionally download their own personal records to their device for private querying.

**What this unlocks:** Employees can privately ask about their own performance reviews, salary grade, contract terms, PIP status, non-compete coverage, PTO balance — all without HR knowing they looked.

**Architecture:**
- HR admin uploads personal documents, assigns to specific employee IDs
- Server stores an encrypted package per employee (write-once; admin cannot retrieve after upload)
- Employee downloads their package in incognito mode using email + OTP (server logs: "email X downloaded their package" — not what they asked)
- Package stored in biometric-gated local vault, encrypted with device-bound key
- All queries against personal records run 100% locally; zero network contact
- Personal index contains only that employee's own data — jailbreak attempts find nothing about anyone else

**Why the personal records index doesn't create a jailbreak risk:** The local vault only contains the requesting employee's documents. There is no other employee data to extract. The architectural isolation makes the system prompt guardrail for this mode effectively moot.

---

### ANALYTICS-01 — Aggregate Analytics Anonymization ✅

Topic clusters do not surface in the admin dashboard until a minimum of **5 distinct queries** contribute to that cluster within the reporting period. Below threshold, topics are suppressed and grouped into "Other."

For very small teams (under a configurable headcount threshold), analytics can be disabled entirely to prevent any possibility of de-anonymization.

---

### MODEL-01 — Model Strategy ✅

Edgebric is model-agnostic. The inference layer targets the OpenAI-compatible API spec — the same interface exposed by mILM and any compatible local inference runtime. Companies configure endpoint URL and model name. No vendor lock-in.

**Recommended defaults (updated March 2026):**
- Server-side: Qwen3.5-9B Q4_K_M (~5.8GB) — released March 2, 2026
- Incognito / mobile: Qwen3.5-4B Q4_K_M (~2.6GB) — same family, consistent behavior
- Fallback (constrained hardware): Qwen3.5-2B Q4_K_M

Qwen3.5 selected over Qwen3/Qwen2.5: latest generation (released 2 days ago),
consistent instruction-following across all tier sizes, single-file GGUF compatible
with mILM's single-URL download API. Qwen2.5-1.5B confirmed insufficient for
production: fails multi-column table reading and "I don't know" instruction following.
Spike 4 model comparison in progress (4B and 9B tests pending download).

---

### INGEST-01 — PDF Handling & Document Processing ✅

Standard PDF parsers fail on real corporate documents (multi-column, tables, scanned, footnotes). Full pipeline:

- **Docling** (IBM open source) — primary PDF extractor; layout-aware, table-aware, exports clean Markdown
- **Tesseract OCR** — fallback for scanned/image-only PDFs
- **Mammoth** — Word (.docx) extraction
- **Semantic chunking** at heading/section boundaries; tables kept as atomic chunks with headers embedded
- Chunk sizes: 100–800 tokens, 50-token overlap between adjacent chunks
- See [04-technical.md](04-technical.md) for full pipeline diagram

---

### UX-01 — Escalation in Incognito Mode ✅

The "Request verification" button is absent in Incognito Mode. Escalation requires identifying yourself to HR — fundamentally incompatible with incognito.

If an employee wants to escalate, they exit incognito first. The transition requires explicit confirmation: "You are leaving Incognito Mode. Your next question will be visible to administrators."

---

## Open Questions

### OPEN-01 — Pricing Model
Self-hosted free tier + paid managed hosting? Open core with paid enterprise features (SSO, analytics export, SharePoint sync)? TBD post-MVP.

### OPEN-02 — Table Retrieval for Benefits Documents ✅ RESOLVED

**Resolution (Spike 2 + Spike 4):** Table extraction works correctly end-to-end.
Docling extracts tables as markdown pipe tables. nomic-embed-text embeds them
well. cosine similarity correctly retrieves the right table chunk for benefits
questions ("What is the Gold plan deductible?" → score 0.88, first result).
The "keep tables atomic" chunking strategy is confirmed correct.

---

### OPEN-05 — mimik edgeEngine Binary Compatibility ✅ RESOLVED

**Resolution:** Download `mim-OE-ai-SE-macOS-developer-ARM64-v3.18.0.zip` from
`github.com/mim-OE/mim-OE-SE-macOS` (the maintained repo, not the archived
`edgeEngine/edgeEngine-SE-macOS` repo). The new binary is called `mim` (not `edge`).
Binary at `scripts/binaries/mim-OE-ai/mim`. All 4 spikes run and passed on real
mim-OE-ai v3.18.0 macOS ARM64. See `spikes/spike-milm/README.md`.

### OPEN-03 — Model Update Cadence
How does an admin running a self-hosted Edgebric get notified that a better recommended model is available? Needs a lightweight notification mechanism that doesn't require external connectivity (could be a version check on the local update feed, signed by Edgebric).

### OPEN-04 — Post-Termination Personal Records
When an employee leaves the company, should their personal records package be deleted from the server? Should they retain access to download their own data for a period after leaving (many jurisdictions give employees the right to their own records)? Legal question that needs a configurable retention policy.
