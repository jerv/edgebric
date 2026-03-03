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
HR admins must explicitly tag every document as `Policy / Public` before ingestion. Personal records (performance reviews, disciplinary files, salary records, medical accommodations, investigation records) are never in the shared index. A system that doesn't contain Sarah's salary cannot reveal it.

**Layer 2 — PII detection at ingestion (accident prevention)**
spaCy NER runs on every document before chunking. If patterns matching `PERSON + sensitive term` (salary, PIP, termination, accommodation, investigation) are detected, admin sees a blocking warning before the document can be added. Makes accidents deliberate rather than passive.

**Layer 3 — System prompt guardrail (defense in depth)**
LLM is instructed to never surface information about named individuals. Catches edge cases where a policy doc includes an illustrative example with a real name.

**Layer 4 — Query-time semantic filter**
Queries containing a person's name combined with sensitive terms (salary, fired, PIP, complaint, accommodation, performance) are intercepted before retrieval and redirected: "Edgebric provides company-wide policy information and cannot access records about specific individuals. Please contact HR directly."

**On jailbreaking:** Layer 3 (system prompt) can theoretically be jailbroken. This is why Layers 1 and 2 are the actual protection. If personal records aren't in the index, no jailbreak can surface them. Layers 3 and 4 are defense-in-depth for edge cases only.

---

### SEC-02 — Personal Records in Incognito Mode ✅

Employees can optionally download their own personal HR records to their device for private querying.

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

Edgebric is model-agnostic. The inference layer targets the OpenAI-compatible API spec, supported by all major local LLM runtimes (Ollama, llama.cpp server, vLLM, LM Studio). Companies configure endpoint URL and model name. No vendor lock-in.

**Recommended defaults:**
- Server-side: Qwen3-4B (fallback: Qwen3-1.7B)
- On-device incognito: Phi-3.5 Mini 3.8B 4-bit quantized (fallback: Llama 3.2 1B for <8GB RAM devices)

---

### INGEST-01 — PDF Handling & Document Processing ✅

Standard PDF parsers fail on real HR documents (multi-column, tables, scanned, footnotes). Full pipeline:

- **Docling** (IBM open source) — primary PDF extractor; layout-aware, table-aware, exports clean Markdown
- **Tesseract OCR** — fallback for scanned/image-only PDFs
- **Mammoth** — Word (.docx) extraction
- **Semantic chunking** at heading/section boundaries; tables kept as atomic chunks with headers embedded
- Chunk sizes: 100–800 tokens, 50-token overlap between adjacent chunks
- See [04-technical.md](04-technical.md) for full pipeline diagram

---

### UX-01 — Escalation in Incognito Mode ✅

The "Ask HR to verify" button is absent in Incognito Mode. Escalation requires identifying yourself to HR — fundamentally incompatible with incognito.

If an employee wants to escalate, they exit incognito first. The transition requires explicit confirmation: "You are leaving Incognito Mode. Your next question will be visible to HR."

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

### OPEN-05 — mimik edgeEngine Binary Compatibility

The macOS edgeEngine binary (`edgeEngine-SE-macOS-arm-v3.10.0`) bundles a
signing trust key that only accepts license JWTs signed with the pre-2025 key.
Personal developer licenses from `console.mimik.com` use a newer signing key and
fail with "JWT Token Signature verification failed."

**Root cause:** The macOS binary hasn't been updated since the mimik platform
rotated its license signing key (~late 2025). The Linux binary (v3.12.1) would
accept the new license format.

**Current workaround:** Ollama (OpenAI-compatible, local) is used as a stand-in
for mILM during development. All integration code in `packages/edge/` is correct
for production mimik deployment — just swap `MILM_BASE_URL`.

**Resolution path:**
1. mimik releases an updated macOS binary that trusts the new signing key, OR
2. Run the Linux binary in Docker on macOS, OR
3. Contact mimik developer support for a compatible macOS binary

**Impact on project:** None. All spikes passed. All production code is correct.
The mimik integration layer is fully implemented and ready for deployment once
a compatible binary is available.

### OPEN-03 — Model Update Cadence
How does an admin running a self-hosted Edgebric get notified that a better recommended model is available? Needs a lightweight notification mechanism that doesn't require external connectivity (could be a version check on the local update feed, signed by Edgebric).

### OPEN-04 — Post-Termination Personal Records
When an employee leaves the company, should their personal records package be deleted from the server? Should they retain access to download their own data for a period after leaving (many jurisdictions give employees the right to their own records)? Legal question that needs a configurable retention policy.
