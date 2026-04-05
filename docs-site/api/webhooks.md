# Webhooks

Webhooks let you receive real-time notifications when events happen in Edgebric — like when a document finishes processing or a new file is synced from cloud storage.

## How Webhooks Work

1. You register a webhook URL with Edgebric
2. When an event occurs, Edgebric sends an HTTP POST request to your URL
3. Your service processes the event and responds with a 2xx status code

## Registering a Webhook

Use the [Agent API](/api/agent-api) with an `admin`-level API key:

```bash
curl -X POST https://localhost:3001/api/v1/webhooks \
  -H "Authorization: Bearer eb_your_admin_key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-service.example.com/webhook",
    "events": ["document.ready", "document.failed"]
  }'
```

**Request body:**

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | The HTTPS URL to receive webhook events |
| `events` | string[] | Which events to subscribe to |

## Events

### `document.ready`

Fired when a document has been fully processed and is searchable.

```json
{
  "event": "document.ready",
  "timestamp": "2026-03-15T14:30:00Z",
  "data": {
    "documentId": "uuid",
    "documentName": "quarterly-report.pdf",
    "dataSourceId": "uuid",
    "dataSourceName": "Finance",
    "chunkCount": 24
  }
}
```

### `document.failed`

Fired when document processing fails.

```json
{
  "event": "document.failed",
  "timestamp": "2026-03-15T14:30:00Z",
  "data": {
    "documentId": "uuid",
    "documentName": "corrupted-file.pdf",
    "dataSourceId": "uuid",
    "error": "Failed to extract text from PDF"
  }
}
```

### `document.pii_detected`

Fired when PII is detected in a document and it requires admin review.

```json
{
  "event": "document.pii_detected",
  "timestamp": "2026-03-15T14:30:00Z",
  "data": {
    "documentId": "uuid",
    "documentName": "employee-list.xlsx",
    "dataSourceId": "uuid",
    "piiTypes": ["person_name", "email", "phone"]
  }
}
```

## Managing Webhooks

### List Webhooks

```bash
curl https://localhost:3001/api/v1/webhooks \
  -H "Authorization: Bearer eb_your_admin_key"
```

### Delete Webhook

```bash
curl -X DELETE https://localhost:3001/api/v1/webhooks/{id} \
  -H "Authorization: Bearer eb_your_admin_key"
```

## Delivery

- Webhooks are delivered as HTTP POST requests with a JSON body
- Edgebric expects a 2xx response within 10 seconds
- Failed deliveries are not retried (in the current version)
- Use HTTPS URLs in production for security

## Use Cases

- **CI/CD pipelines** — Trigger a build or test when new documentation is ingested
- **Monitoring** — Alert your team when document processing fails
- **Automation** — Kick off downstream workflows when new documents are available
- **Compliance** — Log PII detection events to an external audit system
