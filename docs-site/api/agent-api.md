# Agent API Reference

The Agent API (`/api/v1/`) lets AI agents and external applications interact with Edgebric programmatically. Use it to search documents, generate answers, manage sources, and receive event notifications.

## Authentication

All Agent API requests require an API key in the `Authorization` header:

```
Authorization: Bearer eb_your_api_key_here
```

Create API keys in **Admin** > **API Keys**. Each key has:

- **Name** — A label for identification
- **Permission level** — `read`, `read-write`, or `admin`
- **Source scope** — Access to all sources or specific ones
- **Rate limit** — Optional per-key rate limit override

## Rate Limits

| Endpoint | Default limit |
|----------|--------------|
| Search | 100 requests/min |
| Generate | 100 requests/min |
| All others | No limit |

Rate limit headers are included in every response:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 97
X-RateLimit-Reset: 1712345678
```

---

## Sources

### List Sources

```
GET /api/v1/sources
```

Returns all data sources accessible to the API key.

**Response:**

```json
[
  {
    "id": "uuid",
    "name": "Company Policies",
    "description": "HR and company-wide policies",
    "type": "network",
    "documentCount": 42,
    "createdAt": "2026-01-15T10:30:00Z"
  }
]
```

### Create Source

```
POST /api/v1/sources
```

Requires `read-write` permission.

**Request body:**

```json
{
  "name": "Engineering Docs",
  "description": "Technical documentation",
  "type": "network"
}
```

### Get Source

```
GET /api/v1/sources/:id
```

Returns details for a specific data source, including document list.

---

## Documents

### List Documents

```
GET /api/v1/sources/:id/documents
```

Returns all documents in a data source.

**Response:**

```json
[
  {
    "id": "uuid",
    "name": "employee-handbook.pdf",
    "status": "ready",
    "pageCount": 45,
    "createdAt": "2026-02-01T08:00:00Z"
  }
]
```

### Upload Document

```
POST /api/v1/sources/:id/documents/upload
```

Requires `read-write` permission. Send a file as `multipart/form-data`.

```bash
curl -X POST https://localhost:3001/api/v1/sources/{id}/documents/upload \
  -H "Authorization: Bearer eb_your_key" \
  -F "file=@handbook.pdf"
```

The document is processed asynchronously. Check its status via the document detail endpoint.

### Bulk Upload

```
POST /api/v1/sources/:id/documents/upload-bulk
```

Upload multiple files at once. Same format as single upload but accepts multiple `file` fields.

### Get Document

```
GET /api/v1/sources/:id/documents/:docId
```

### Delete Document

```
DELETE /api/v1/sources/:id/documents/:docId
```

Requires `read-write` permission.

---

## Search

### Hybrid Search

```
POST /api/v1/search
```

Search across accessible data sources using hybrid retrieval (vector + keyword).

**Request body:**

```json
{
  "query": "What is the refund policy?",
  "sourceIds": ["uuid1", "uuid2"],
  "limit": 10
}
```

- `query` (required) — The search query
- `sourceIds` (optional) — Limit search to specific sources. Omit to search all accessible sources.
- `limit` (optional) — Max results to return (default: 10)

**Response:**

```json
{
  "results": [
    {
      "content": "Refunds are processed within 14 business days...",
      "score": 0.87,
      "document": {
        "id": "uuid",
        "name": "refund-policy.pdf"
      },
      "dataSource": {
        "id": "uuid",
        "name": "Company Policies"
      },
      "metadata": {
        "section": "Section 3: Refund Process",
        "page": 5
      }
    }
  ]
}
```

---

## Generate

### RAG Generation

```
POST /api/v1/generate
```

Ask a question and get an AI-generated answer with citations. Responses are streamed via Server-Sent Events (SSE).

**Request body:**

```json
{
  "query": "What is our parental leave policy?",
  "sourceIds": ["uuid1"],
  "conversationId": "uuid"
}
```

- `query` (required) — The question (1–4000 characters)
- `sourceIds` (optional) — Limit to specific sources
- `conversationId` (optional) — Continue an existing conversation

**SSE events:**

| Event | Data | Description |
|-------|------|-------------|
| `delta` | `{ "text": "..." }` | Streaming answer text |
| `done` | `{ "conversationId": "...", "messageId": "...", "citations": [...] }` | Final response with metadata |
| `queued` | `{ "position": 3 }` | Queue position if the model is busy |
| `error` | `{ "message": "..." }` | Error description |

**Example with curl:**

```bash
curl -N -X POST https://localhost:3001/api/v1/generate \
  -H "Authorization: Bearer eb_your_key" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is our parental leave policy?"}'
```

---

## Memory

### List Memories

```
GET /api/memory
```

Returns all saved memories for the authenticated user.

### Create Memory

```
POST /api/memory
```

**Request body:**

```json
{
  "content": "I prefer concise answers with bullet points"
}
```

### Update Memory

```
PUT /api/memory/:id
```

**Request body:**

```json
{
  "content": "Updated memory content"
}
```

### Delete Memory

```
DELETE /api/memory/:id
```

### Toggle Memory

```
PATCH /api/memory/toggle
```

Enable or disable the memory feature.

**Request body:**

```json
{
  "enabled": true
}
```

---

## Webhooks

See [Webhooks](/api/webhooks) for registering event callbacks.

### List Webhooks

```
GET /api/v1/webhooks
```

Requires `admin` permission.

### Create Webhook

```
POST /api/v1/webhooks
```

### Delete Webhook

```
DELETE /api/v1/webhooks/:id
```

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Not found",
  "message": "Data source with ID xyz does not exist"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request — invalid parameters |
| 401 | Unauthorized — missing or invalid API key |
| 403 | Forbidden — API key doesn't have required permission |
| 404 | Not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

## Version Endpoint

A lightweight, unauthenticated endpoint for checking the running Edgebric version. Useful for monitoring, health checks, and agent version awareness.

```
GET /api/health/version
```

No authentication required.

**Response:**

```json
{
  "version": "0.9.0"
}
```

::: info Read-only
This endpoint only reports the current version. There are no API endpoints to change update settings — update preferences are a user-level decision controlled via the desktop app.
:::
