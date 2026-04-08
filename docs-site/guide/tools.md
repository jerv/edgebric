# Tools

Edgebric can use tools to extend the AI's capabilities beyond basic document search. When your active model supports tool use, the AI autonomously decides which tools to call — up to 5 rounds per question — then synthesizes everything into a final answer.

## How Tool Use Works

1. You ask a question in the chat
2. The AI evaluates your question and picks the best tools to call
3. Tools execute and return results (you'll see a collapsible **Tool Use** panel showing what ran)
4. The AI may call additional tools based on initial results (up to 5 rounds)
5. A final answer is generated from all gathered context

You don't need to specify which tools to use. The AI picks the best approach based on your question. If your model doesn't have the **Tool Use** badge, the standard RAG pipeline (search → answer) is used instead.

## Model Capabilities

Not all models support all tools. The model picker shows capability badges:

| Badge | Meaning |
|-------|---------|
| 🔧 **Tools** | Can call knowledge and web tools autonomously |
| 👁 **Vision** | Can analyze images, screenshots, and diagrams |
| 🧠 **Reasoning** | Enhanced multi-step analysis |

## Knowledge Tools

These tools let the AI search, manage, and analyze your local knowledge base — all without your data leaving your machine.

### search_knowledge

Searches your data sources using hybrid vector + keyword (BM25) search. Returns ranked document chunks with citations.

**Example prompt:**
> "What does our employee handbook say about remote work policies?"

The AI calls `search_knowledge` with your question, optionally restricting to specific sources, and gets back the most relevant passages with similarity scores, document names, and section headings.

**Parameters:**
- `query` (required) — The search query
- `sourceIds` — Restrict search to specific source IDs
- `topK` — Maximum results to return (default: 5)

---

### list_sources

Lists all data sources you have access to, with document counts and status.

**Example prompt:**
> "What knowledge bases do I have?"

**Parameters:** None.

---

### list_documents

Lists all documents in a specific data source.

**Example prompt:**
> "Show me what's in the HR Policies source."

The AI calls `list_sources` first to find the source ID, then `list_documents` to enumerate its contents.

**Parameters:**
- `sourceId` (required) — The data source ID

---

### get_source_summary

Retrieves a summary of a data source including document names, types, and section headings. Returns up to 20 documents with their first 5 section headings.

**Example prompt:**
> "Give me an overview of what's in the Engineering Wiki source."

**Parameters:**
- `sourceId` (required) — The data source ID

---

### create_source

Creates a new data source (knowledge base).

**Example prompt:**
> "Create a new knowledge base called 'Meeting Notes' for our weekly standup summaries."

**Parameters:**
- `name` (required) — Name for the new source
- `description` — Optional description

---

### upload_document

Saves text content as a document in a data source, then triggers ingestion for RAG indexing.

**Example prompt:**
> "Save these meeting notes to the Meeting Notes source."

The AI writes the content to a file, creates a document record, and kicks off background ingestion so the content becomes searchable.

**Parameters:**
- `sourceId` (required) — Target data source ID
- `content` (required) — The text content to save
- `filename` (required) — Filename (e.g., `standup-2026-04-04.md`)

---

### delete_document

Deletes a document and its indexed chunks from the knowledge base. Also removes the stored file and triggers a dataset rebuild.

**Example prompt:**
> "Delete the outdated Q3 report from the Finance source."

**Parameters:**
- `documentId` (required) — The document ID to delete

---

### delete_source

Deletes an entire data source and all its documents. **Admin only.** This is destructive and cannot be undone.

**Example prompt:**
> "Remove the old 'Test Data' knowledge base entirely."

**Parameters:**
- `sourceId` (required) — The data source ID to delete

---

### save_to_vault

Saves content to your personal vault source mid-conversation. If you don't have a personal vault source yet, one is created automatically.

**Example prompt:**
> "Save this summary to my vault for later reference."

The AI calls `save_to_vault` with the content and a title. The content is indexed and becomes searchable in future conversations.

**Parameters:**
- `content` (required) — The content to save
- `title` (required) — Title for the saved content

---

### compare_documents

Compares two documents by analyzing their section headings, highlighting topics unique to each and topics they share.

**Example prompt:**
> "Compare the 2025 and 2026 employee handbooks — what changed?"

The AI retrieves both documents' metadata and returns sections unique to each plus shared sections, then explains the differences.

**Parameters:**
- `docId1` (required) — First document ID
- `docId2` (required) — Second document ID

---

### cite_check

Verifies or contradicts a claim by searching all your data sources for supporting or contradicting evidence.

**Example prompt:**
> "Is it true that our return policy allows 60-day returns?"

The AI searches across all sources for evidence related to the claim and returns a verdict: `evidence_found` (similarity > 0.6) or `uncertain`.

**Parameters:**
- `claim` (required) — The claim to verify

---

### find_related

Finds documents related to a given document using vector similarity search across all sources. Returns up to 5 related documents.

**Example prompt:**
> "What other documents are related to the API design spec?"

The AI uses the document's name and headings to search for semantically similar documents, excluding the document itself.

**Parameters:**
- `documentId` (required) — The document ID to find related documents for

## Memory Tools

These tools let the AI save and recall information about you across conversations. See [Agent Memory](/guide/memory) for full details.

### save_memory

Saves a preference, fact, or instruction so the AI remembers it in future conversations.

**Example prompt:**
> "Remember that I prefer answers in bullet point format."

**Parameters:**
- `content` (required) — The memory text to save

---

### list_memories

Lists all saved memories for the current user.

**Example prompt:**
> "What do you remember about me?"

**Parameters:** None.

---

### delete_memory

Deletes a specific memory by ID.

**Example prompt:**
> "Forget that I prefer bullet points."

The AI calls `list_memories` to find the relevant memory, then `delete_memory` to remove it.

**Parameters:**
- `memoryId` (required) — The memory ID to delete

---

## Web Tools

Web tools let the AI access the internet when your local knowledge doesn't cover a topic. These use DuckDuckGo and require no API keys.

::: warning Privacy Note
Web tools send queries to external services. If you need complete privacy, use **Vault Mode** or disable web tools. Web tools are never used in Vault Mode.
:::

### web_search

Searches the internet using DuckDuckGo. Returns titles, URLs, and snippets from top results (up to 8).

**Example prompt:**
> "What are the latest GDPR compliance requirements for 2026?"

The AI searches DuckDuckGo and returns relevant results with titles, links, and snippets.

**Parameters:**
- `query` (required) — The search query

---

### read_url

Fetches a URL and extracts its text content. HTML is converted to clean text, limited to ~10KB.

**Example prompt:**
> "Read this article and summarize it: https://example.com/blog/post"

The AI fetches the page, strips HTML, and returns the text content for analysis.

**Parameters:**
- `url` (required) — The URL to fetch

## Multi-Tool Workflows

The real power of tools comes from combining them. Here are some examples of what the AI can do in a single conversation turn:

**Research and save:**
> "Search our docs for info about the deployment process, also check the web for best practices, and save a combined summary to my vault."

The AI might: `search_knowledge` → `web_search` → `read_url` (on a promising result) → `save_to_vault` (with the combined summary).

**Fact-check against your docs:**
> "Our vendor claims their SLA guarantees 99.99% uptime. Can you verify this against our contract?"

The AI calls `cite_check` to search your documents for evidence about the vendor's SLA terms.

**Compare and report:**
> "Compare the Q1 and Q2 security audit reports and list what's new."

The AI uses `list_documents` to find the reports, then `compare_documents` to analyze differences.

## Tool Use Panel

When tools are used during a response, a collapsible **Tool Use** panel appears above the answer. It shows:

- Which tools were called
- Whether each call succeeded or failed
- A brief summary of what each tool returned

The panel is collapsed by default — click to expand and see the details.

## Access Control and Permissions

Tools respect the same access control rules as the rest of Edgebric:

- **Source-level access** — Knowledge tools only operate on data sources the current user has access to. If a tool tries to read or modify a source you don't have permission to view, it returns an "Access denied" error.
- **Admin-only tools** — `delete_source` requires admin privileges. Non-admin users cannot delete entire data sources.
- **Organization scoping** — In multi-user setups, tools are scoped to the user's organization. You cannot access sources belonging to a different organization.
- **Personal vault isolation** — `save_to_vault` writes only to the current user's personal vault source. Other users cannot access your vault.

## Audit Logging

Every tool execution is recorded in the immutable audit log with the tool name, execution time, success/failure status, and the user who triggered it. Admins can review tool usage via the audit log.
