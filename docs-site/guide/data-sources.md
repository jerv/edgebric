# Data Sources

Data sources are how you organize documents in Edgebric. Think of them as folders — each data source holds a collection of related documents that Edgebric can search and answer questions from.

## Types of Data Sources

### Network Sources

Created by admins, shared across the organization. Everyone with access can query them.

**Examples:** Company policies, HR handbook, product documentation, legal contracts.

### Vault Sources

Personal and private. Only you can see and query them. Stored encrypted on your device.

**Examples:** Personal notes, medical records, tax documents, private research.

## Creating a Data Source

1. Click **New Source** in the Library page
2. Enter a name and optional description
3. Choose the type (Network or Vault)
4. For Network sources, set access permissions:
   - **All** — Everyone in the organization can query this source
   - **Restricted** — Only specific users you add can query it

## Uploading Documents

Edgebric supports these file formats:

| Format | Extension | Notes |
|--------|-----------|-------|
| PDF | `.pdf` | Text PDFs and scanned (via OCR) |
| Word | `.docx` | Converted to clean Markdown |
| Plain text | `.txt` | Direct ingestion |
| Markdown | `.md` | Direct ingestion |

### How to Upload

1. Open a data source from the Library page
2. Drag and drop files onto the upload area, or click to browse
3. Edgebric processes each document automatically

### What Happens During Processing

When you upload a document, Edgebric:

1. **Detects the file type** using the file's content (not just the extension)
2. **Extracts text** — PDFs are processed with Docling (layout-aware extraction that handles tables, columns, and complex formatting). Scanned PDFs fall back to OCR. Word files are converted to Markdown.
3. **Splits into chunks** — The text is divided at natural boundaries (headings, sections) rather than fixed character counts. Tables are kept intact.
4. **Checks for personal information** — A PII detector scans for names, addresses, and other sensitive data. If found, an admin must review and approve before the document becomes searchable.
5. **Creates embeddings** — Each chunk is converted into a numerical representation for semantic search.
6. **Indexes for keyword search** — Full-text search is built alongside the vector index.

### Document Status

Each document shows a status indicator:

| Status | Meaning |
|--------|---------|
| **Processing** | Extraction and indexing in progress |
| **Ready** | Document is searchable |
| **PII Review** | Personal information detected — admin review needed |
| **Rejected** | Admin rejected due to PII concerns |
| **Failed** | Processing error — try re-uploading |

## Managing Documents

- **View** — Click a document to see its extracted content organized by section
- **Download** — Download the original file
- **Delete** — Remove a document from the data source (also removes its search index)
- **Re-upload** — Upload a newer version of a document to replace the old one

## PII Detection

Edgebric automatically scans documents for personally identifiable information (PII) — names, email addresses, phone numbers, Social Security numbers, and similar data.

When PII is detected:

1. The document is paused in a **PII Review** state
2. An admin sees a warning showing what was found
3. The admin can **approve** (allow the document to be indexed) or **reject** (delete the document)

This protects against accidentally making sensitive personal data searchable across the organization.

Admins can configure PII detection behavior in [Security settings](/admin/security):

| Mode | Behavior |
|------|----------|
| **Warn** | Flag documents with PII for review (default) |
| **Block** | Automatically reject documents with PII |
| **Off** | Skip PII detection |

## Document Staleness

Edgebric tracks how old documents are. When a document hasn't been updated in a while (default: 6 months), it's flagged as potentially stale. This helps you keep your knowledge base current.

## Cloud Sync

Instead of uploading files manually, you can sync documents from cloud storage. See [Cloud Sync](/guide/cloud-sync) for setup instructions.
