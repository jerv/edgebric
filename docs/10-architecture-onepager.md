> **Status: CURRENT** — Accurate compliance/auditor-facing architecture overview.

# Edgebric Architecture Overview

**For: Compliance officers, auditors, and IT administrators**

---

## What is Edgebric?

Edgebric is **on-premise software** that enables organizations to build private, AI-powered data sources from their internal documents. It runs entirely on your hardware. No data leaves your network.

---

## Data Flow Diagram

```
+---------------------------------------------------------+
|                YOUR ORGANIZATION'S HARDWARE               |
|                  (Mac Mini, server, VM)                    |
|                                                           |
|  +--------------+    +--------------+    +--------------+ |
|  |   Web UI      |    |   API Server |    |   AI Engine   | |
|  |  (Browser)    |--->|  (Express)   |--->|  (Ollama)     | |
|  |              |    |              |    |              | |
|  |  React app   |<---|  Auth, CRUD, |<---|  Embedding,  | |
|  |  served from |    |  RAG pipeline|    |  Generation  | |
|  |  same server |    |              |    |              | |
|  +--------------+    +------+-------+    +--------------+ |
|                             |                             |
|                      +------v-------+                     |
|                      |   Data Store  |                     |
|                      |              |                     |
|                      |  SQLite DB   |                     |
|                      |  sqlite-vec  |                     |
|                      |  FTS5 index  |                     |
|                      |  Documents   |                     |
|                      |  Sessions    |                     |
|                      +--------------+                     |
|                                                           |
|  +------------------------------------------------------+ |
|  |  EXTERNAL CONNECTION (outbound only, auth only)       | |
|  |                                                        | |
|  |  Identity Provider (Google/Okta/Azure AD)              | |
|  |  Purpose: Verify employee identity at login            | |
|  |  Data sent: OAuth redirect (no org data transmitted)   | |
|  |  Data received: Email address, name                    | |
|  +------------------------------------------------------+ |
|                                                           |
+---------------------------------------------------------+
```

---

## Key Security Properties

| Property | Implementation |
|---|---|
| **Data residency** | All data stored in a single directory on your filesystem. Never transmitted externally. |
| **AI processing** | Language model runs locally via Ollama on your hardware. No cloud AI APIs used by default. |
| **Vector search** | sqlite-vec embedded in SQLite. No separate database or external service. |
| **Keyword search** | FTS5 (BM25) built into SQLite. Combined with vector search via Reciprocal Rank Fusion. |
| **Authentication** | OIDC/SSO via your existing identity provider. Session cookies (httpOnly, secure). |
| **Anonymity** | After login, queries use anonymous UUIDs. Individual query activity cannot be traced to users. |
| **PII protection** | 4-layer defense: upload policy, PII detection scan, system prompt guardrails, query-time filter. |
| **Encryption at rest** | Vault mode: AES-256-GCM encryption for sensitive conversations. Standard mode: relies on OS-level disk encryption. |
| **Access control** | Per-data-source permissions. Organization-scoped data isolation. Role-based admin access. |
| **Network exposure** | Listens on localhost only. No inbound ports exposed to the internet. |

---

## What Data Exists Where

| Data Type | Location | Encrypted | Deletable |
|---|---|---|---|
| Uploaded documents (PDF, DOCX) | `{DATA_DIR}/uploads/` | OS-level | Yes, via admin UI |
| Document embeddings (vectors) | SQLite database (sqlite-vec) | No (on-disk) | Yes, with data source deletion |
| Full-text search index | SQLite database (FTS5) | No (on-disk) | Yes, with data source deletion |
| Conversations | SQLite database | No (standard) / AES-256 (vault) | Yes, via UI |
| User accounts | SQLite database | No | Yes, via admin |
| Session data | `{DATA_DIR}/sessions/` | No | Auto-expires |
| Server logs | `{DATA_DIR}/edgebric.log` | No | Manual deletion |

---

## External Network Connections

| Connection | Direction | Purpose | Data Transmitted | Can Be Disabled? |
|---|---|---|---|---|
| Identity provider (Google, Okta, etc.) | Outbound | User authentication | OAuth tokens (no org data) | No (required for login) |
| Custom LLM endpoint (if configured) | Outbound | AI inference | Query text + context chunks | Yes (disabled by default) |

**By default, Edgebric makes zero external API calls for AI processing.** All inference runs on Ollama locally. All vector search runs on sqlite-vec locally.

---

## Compliance Summary

- **GDPR**: Data never leaves customer infrastructure. Customer is both controller and processor. DPA template available.
- **HIPAA**: No ePHI transmitted externally. Software vendor model — no BAA required for the software itself.
- **SOC 2**: Not applicable — vendor does not access, process, or store customer data.
- **EU AI Act**: Employment-related AI use. Human-in-the-loop via group chat workflow. AI responses include source citations and accuracy disclaimers.

---

## Backup & Recovery

All data is contained in one directory. Backup procedure:

1. Stop Edgebric
2. Copy the data directory
3. Restart Edgebric

Full restore: replace the data directory with the backup copy. No external dependencies, no cloud sync required.

---

*Document version: March 2026 | Edgebric v1.0*
