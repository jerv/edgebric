# Security

Edgebric is designed with security at every layer — from physical data isolation to encrypted sessions and tamper-evident audit logs.

## API Keys

API keys allow external applications and AI agents to access Edgebric's [Agent API](/api/agent-api).

### Creating API Keys

1. Go to **Admin** > **API Keys**
2. Click **Create Key**
3. Configure:
   - **Name** — A descriptive label (e.g., "Claude integration", "CI pipeline")
   - **Permission** — `read`, `read-write`, or `admin`
   - **Source scope** — All sources, or specific ones
   - **Rate limit** — Optional per-key limit

4. Copy the key immediately — it's only shown once

### Permission Levels

| Permission | Can do |
|------------|--------|
| `read` | Search, generate answers, list sources and documents |
| `read-write` | Everything in `read`, plus create sources and upload documents |
| `admin` | Everything in `read-write`, plus manage webhooks |

### Revoking Keys

Click **Revoke** on any key to immediately disable it. Revoked keys cannot be un-revoked — create a new one instead.

## Audit Trail

Edgebric maintains a hash-chained audit log with tamper detection. Each entry is cryptographically linked to the previous one, making tampering detectable. Integrity can be verified manually from the admin interface.

### What's Logged

- Data source creation, modification, and deletion
- Document uploads, approvals, and rejections
- User invitations and removals
- Role changes
- Access control changes
- Mesh node registrations
- API key creation and revocation

### Viewing the Audit Log

Go to **Admin** > **Audit Log** to:

- Browse events chronologically
- Filter by event type
- View event details
- Verify chain integrity (checks that no entries have been tampered with)

### Exporting

Export the audit log as CSV or JSON for external compliance tools:

- **Admin** > **Audit Log** > **Export**
- Choose format and date range

## Access Control

### Per-Source Permissions

Each data source can be set to:

- **All** — Accessible to every org member
- **Restricted** — Only users on the access list can query it

Configure access lists in the data source settings page.

### Mesh Groups

For multi-node deployments, mesh groups control which users can query which nodes. See [Mesh Networking](/guide/mesh) for details.

## PII Detection

Edgebric automatically scans uploaded documents for personally identifiable information before making them searchable.

### Detection Settings

Configure in **Admin** > **Settings** > **Integrations**:

| Mode | Behavior |
|------|----------|
| **Warn** | Flag documents for admin review (default) |
| **Block** | Automatically reject documents with PII |
| **Off** | Skip PII detection |

### What's Detected

- Person names
- Email addresses
- Phone numbers
- Social Security numbers
- Addresses
- Other patterns identified by pattern-based heuristic rules

## Network Security

### Session Management

- Sessions use `httpOnly` cookies (not accessible to JavaScript)
- 24-hour session expiration
- CSRF protection via double-submit cookie with timing-safe comparison

### Transport Security

- HTTPS by default (self-signed TLS certificates generated during setup)
- Helmet CSP headers in production
- HSTS enabled

### Rate Limiting

| Scope | Limit |
|-------|-------|
| Global | 100 requests/min |
| Query | 20 requests/min |
| OAuth | 5 requests/min |
| Agent API (search/generate) | 100 requests/min |

### Input Validation

All API inputs are validated with Zod schemas. Malformed requests are rejected before reaching application logic.

## Encryption

### Vault Mode

Vault sources use AES-256-GCM encryption for document text. Embedding vectors (numerical representations used for search) are stored unencrypted to enable similarity search. Vault encryption keys are generated in the browser and never sent to the server. The key is stored in the browser's local storage. Note: the key is not password-protected in the current version.

### Cloud Token Storage

OAuth tokens for cloud integrations (Google Drive, OneDrive) are stored encrypted in the database.

## Privacy by Architecture

The most important security feature is architectural: **full documents never leave the machine that stores them.**

In a mesh deployment, when Node A queries Node B:

1. Only the query text is sent to Node B
2. Node B searches locally and returns relevant text excerpts with citations
3. Full documents are never transferred between nodes
4. A compromised Node A cannot access Node B's full document store

This means security is enforced by architecture, not just access control policies.

## External Network Calls

Edgebric makes the following external network calls. All are user-initiated or configurable — there is no telemetry or analytics.

| Call | When | Configurable |
|------|------|-------------|
| **Auto-update checks** | On launch (GitHub Releases API) | Can be disabled in settings |
| **HuggingFace API** | When searching for models in the admin dashboard | User-initiated |
| **Web search** | When the AI uses the `web_search` tool | User-initiated; disabled in Vault Mode |
| **URL reading** | When the AI uses the `read_url` tool | User-initiated; disabled in Vault Mode |
| **OIDC/SSO authentication** | During sign-in (to your identity provider) | Required for multi-user; not used in Solo mode |
| **Cloud sync OAuth** | When connecting Google Drive, OneDrive, etc. | User-initiated |
| **Cloud document fetching** | During cloud sync (downloads files from connected services) | User-initiated; runs on configured schedule |
| **Telegram Bot API** | When Telegram integration is enabled (sends/receives messages via Telegram servers) | Opt-in; disabled by default; vault sources excluded |
