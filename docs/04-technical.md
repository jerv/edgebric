# Technical Architecture

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Company Infrastructure                    │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                  Edgebric Edge Node                      │  │
│  │               (mimik mim OE Runtime)                   │  │
│  │                                                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────┐            │  │
│  │  │   mKB    │  │  mILM   │  │ mAIChain  │            │  │
│  │  │(embeddings  │(local   │  │(RAG       │            │  │
│  │  │+ vectors)│  │  LLM)   │  │ pipeline) │            │  │
│  │  └──────────┘  └──────────┘  └───────────┘            │  │
│  │                                                        │  │
│  │  ┌────────────────────┐  ┌────────────────────────┐   │  │
│  │  │  Policy Doc Store  │  │ Encrypted Personal      │   │  │
│  │  │  (shared index)    │  │ Record Packages         │   │  │
│  │  └────────────────────┘  │ (per-employee, write-   │   │  │
│  │                          │  once, encrypted)        │   │  │
│  │                          └────────────────────────┘   │  │
│  │  ┌────────────────────────────────────────────────┐   │  │
│  │  │            Admin API + Dashboard               │   │  │
│  │  └────────────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                  │
│             mimik Edge Service Mesh                          │
│         (auto-discovery, device tokens, no IP config)        │
│                           │                                  │
│         ┌─────────────────┼─────────────────┐               │
│         │                 │                 │               │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐           │
│  │  Employee  │   │  Employee  │   │  HR Admin  │           │
│  │  Browser   │   │  Browser   │   │  Dashboard │           │
│  │ (anon token│   │ (anon token│   │  (authed)  │           │
│  └────────────┘   └────────────┘   └────────────┘           │
│                                                              │
└──────────────────────────────────────────────────────────────┘

╔═══════════════════════════════════════════════════╗
║  INCOGNITO MODE (V2) — Employee Device Only       ║
║                                                   ║
║  ┌───────────────────────────────────────────┐    ║
║  │  Biometric-Gated Local Vault              │    ║
║  │  ┌─────────────────┐ ┌─────────────────┐  │    ║
║  │  │ Policy Embeddings│ │Personal Records │  │    ║
║  │  │ (synced from    │ │Package (optional│  │    ║
║  │  │  edge node)     │ │ OTP download)   │  │    ║
║  │  └─────────────────┘ └─────────────────┘  │    ║
║  │  Local LLM (Phi-3.5 Mini / Qwen3-1.7B)   │    ║
║  │  Zero network during queries              │    ║
║  └───────────────────────────────────────────┘    ║
╚═══════════════════════════════════════════════════╝

  ✗ No external cloud services
  ✗ No OpenAI / Azure / AWS
  ✗ No telemetry or analytics to third parties
  ✓ Internet optional after initial setup
```

---

## Document Ingestion Pipeline

```
INPUT
  │
  ▼
1. DETECTION
   ├── File type via magic bytes (not extension)
   ├── PDF: text layer present? → text-based or scanned
   └── Complexity flags: tables, multi-column, images

  │
  ▼
2. EXTRACTION (routed by detection result)
   ├── Text PDF (any layout)    → Docling  ← primary, layout-aware
   ├── Scanned PDF (no text)    → Tesseract OCR → clean text
   ├── Word (.docx)             → Mammoth → Markdown
   ├── Excel (.xlsx)            → pandas → structured Markdown tables
   ├── HTML / Confluence export → BeautifulSoup + html2text
   └── Plain text / Markdown   → direct pass-through

  │
  ▼
3. CLEANING
   ├── Strip repeated headers/footers (pollute chunks)
   ├── Normalize bullet points and formatting artifacts
   ├── Remove inline page numbers
   └── Collapse excessive whitespace

  │
  ▼
4. CHUNKING  (semantic, heading-based)
   ├── Split at heading boundaries (H1 → H2 → H3)
   ├── Tables: atomic chunks, column headers embedded in text
   │          e.g. "Benefits Plan Table | Plan: Gold | Deductible: $500 | ..."
   ├── Long sections: split with 50-token overlap
   ├── Short adjacent sections: merge if total < 100 tokens
   ├── Max chunk size: 800 tokens
   └── Each chunk tagged with: {source, section_path, page, heading}

  │
  ▼
5. PII DETECTION  (before any embedding)
   ├── spaCy NER: flag PERSON entity + sensitive term co-occurrence
   │             (salary, PIP, termination, accommodation, investigation)
   ├── Pattern matching: SSN-like patterns, salary figures attached to names
   └── If flagged → admin warning modal, admin must confirm to proceed

  │
  ▼
6. EMBEDDING
   └── nomic-embed-text or BGE-M3
       (open source, runs fully locally, multilingual)
       → stored via mimik mKB

  │
  ▼
7. STORAGE
   ├── Vector store (mKB): embeddings + chunk metadata
   └── Document store: original files (for source link rendering)
```

---

## RAG Query Pipeline

```
Employee question (natural language)
  │
  ▼
Query-time filter
  ├── Contains person name + sensitive term? → intercept, redirect to HR
  └── Passes → continue

  │
  ▼
Embed query
  └── Same embedding model as ingestion (nomic-embed-text / BGE-M3)

  │
  ▼
Retrieve top-k chunks (mKB)
  └── Cosine similarity search, k=5 by default

  │
  ▼
Context check
  ├── Any relevant chunks found? → generate answer
  └── No relevant chunks → return "no answer found" message, prompt to contact HR

  │
  ▼
Generate answer (mILM via OpenAI-compatible endpoint)
  └── System prompt includes:
      - Retrieved chunks as context
      - Instruction: answer only from provided context
      - Instruction: never reveal information about named individuals
      - Instruction: if context is insufficient, say so clearly

  │
  ▼
Response assembly
  ├── Answer text
  ├── Source citations: {document name, section, page number}
  ├── Disclaimer: ⚠️ Not legal advice. Verify with HR.
  └── Escalation button (standard mode only)
```

---

## Core Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Edge runtime | mimik mim OE | Runs on company hardware; handles service mesh |
| Embeddings + vector store | mimik mKB | Local; no cloud dependency |
| LLM inference | mimik mILM | OpenAI-compatible endpoint; model-agnostic |
| RAG orchestration | mimik mAIChain | Wires retrieval + generation |
| PDF extraction | Docling (IBM) | Layout-aware, table-aware, open source, local |
| OCR fallback | Tesseract | For scanned PDFs |
| Word extraction | Mammoth | .docx → clean Markdown |
| PII detection | spaCy | NER, runs locally |
| Embedding model | nomic-embed-text or BGE-M3 | Open source, multilingual, local |
| Frontend | React | Web app, responsive; mobile browser supported |
| Admin backend | Node.js | REST API |

### Recommended LLM Defaults (Model-Agnostic)

Edgebric's inference layer targets the **OpenAI-compatible API spec**. Any model/runtime exposing this interface can be substituted. No vendor lock-in.

| Mode | Recommended | Fallback | Notes |
|---|---|---|---|
| Server-side (standard) | Qwen3-4B | Qwen3-1.7B | Via Ollama; strong instruction following |
| On-device (incognito) | Phi-3.5 Mini 3.8B (4-bit) | Llama 3.2 1B | Best mobile RAG benchmarks |

---

## Non-Functional Requirements

### Performance
- Standard mode query: < 5 seconds end-to-end (server RAG + inference on reasonable hardware)
- Incognito mode query: < 30 seconds on minimum-spec device (acceptable — still faster than emailing HR)
- Document ingestion: < 2 minutes per 100-page PDF
- Dashboard load: < 2 seconds

### Security
- All data at rest: AES-256 encrypted
- All data in transit: TLS 1.3
- Admin panel: authenticated access only
- Employee standard mode: anonymous device token required (not raw network access)
- Incognito vault: biometric-gated, device-bound key (secure enclave / Android Keystore)
- No telemetry or analytics transmitted to any external server
- No training data leaves company infrastructure under any circumstance

### Privacy
- Standard mode: individual queries not stored beyond session; only aggregate topic-level analytics retained
- Analytics: topics suppressed until minimum 5 distinct queries contribute (prevents de-anonymization in small teams)
- Incognito mode: zero query data touches any server — enforced by architecture, not policy
- Personal records: server stores encrypted package only; after employee download, queries are entirely local
- Escalation records: retained for compliance purposes with configurable retention period

### Compliance Posture (out-of-the-box)
- **GDPR**: data residency by design — data never crosses borders unless company's own infrastructure does
- **CCPA**: data stays on company infrastructure, fully auditable with one-sentence answer
- **HIPAA**: health benefits data processed locally, no ePHI transmitted externally
- **EU AI Act**: human-in-the-loop (escalation) built into core product; disclaimer on every response; not used for automated employment decisions

### Reliability
- Uptime: dependent on company's own server infrastructure
- Graceful degradation: clear "Edgebric is offline" state when edge node unreachable — no silent failure
- No single-point-of-failure dependency on external services
