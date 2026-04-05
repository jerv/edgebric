# Adding Integrations

This guide explains how to add a new cloud storage connector or authentication provider to Edgebric. These are great first contributions — the patterns are well-established and each new integration follows the same structure.

## Adding a Cloud Storage Connector

Cloud connectors let users sync documents from external services (Google Drive, OneDrive, Dropbox, etc.) into Edgebric data sources.

### Architecture

```
User clicks "Connect" → OAuth flow → Store tokens
                                        ↓
Sync trigger (manual or scheduled) → List remote files
                                        ↓
Download new/updated files → Run ingestion pipeline → Searchable
```

### Steps

#### 1. Add the Provider Enum

In `shared/types/src/`, add your provider to the cloud provider union type:

```typescript
type CloudProvider = 'google_drive' | 'onedrive' | 'confluence' | 'notion' | 'your_provider'
```

#### 2. Create the Connector

In `packages/api/src/services/cloud/`, create a new file for your connector (e.g., `dropbox.ts`):

```typescript
export class DropboxConnector {
  // Get the OAuth authorization URL
  getAuthUrl(state: string): string { ... }

  // Exchange auth code for tokens
  async handleCallback(code: string): Promise<OAuthTokens> { ... }

  // List files in a folder
  async listFiles(folderId: string, token: string): Promise<RemoteFile[]> { ... }

  // Download a file
  async downloadFile(fileId: string, token: string): Promise<Buffer> { ... }

  // List folders for the folder picker UI
  async listFolders(parentId: string | null, token: string): Promise<RemoteFolder[]> { ... }
}
```

Look at the existing Google Drive or OneDrive connector for the exact interface.

#### 3. Register the Provider

In the cloud connections route, add your provider to the provider list and wire up the OAuth flow and sync logic.

#### 4. Add Admin Configuration

In the integrations settings, add enable/disable toggle and any required OAuth credentials for your provider.

#### 5. Add UI

In the frontend, add your provider to:

- The cloud connection picker (with an icon)
- The folder browser
- The sync status display

#### 6. Write Tests

Test the connector's:

- OAuth URL generation
- Token exchange
- File listing
- File download
- Error handling (expired tokens, API errors, rate limits)

### Database Schema

The existing schema supports new providers without migrations:

- `cloudConnections` — Stores the user's connection to the provider
- `cloudFolderSyncs` — Tracks which folders are synced to which data sources
- `cloudOauthTokens` — Encrypted token storage

The `provider` column accepts any string, so adding a new provider doesn't require a schema change.

## Adding an Auth Provider

Auth providers let organizations use their identity provider (Okta, OneLogin, etc.) for SSO.

### Architecture

Edgebric uses `passport-openidconnect`, which supports any OIDC-compliant provider. Adding a new provider mainly means:

1. Documenting the provider-specific setup steps
2. Adding provider detection (for display name and icon)
3. Testing the flow

### Steps

#### 1. Test the OIDC Flow

Most providers work with Edgebric's existing generic OIDC support. Test by configuring the provider's OIDC issuer URL, client ID, and client secret in the `.env` file.

#### 2. Add Provider Detection

In the auth routes, add logic to detect the provider from the issuer URL:

```typescript
function detectProvider(issuer: string): { name: string; icon: string } {
  if (issuer.includes('okta.com')) return { name: 'Okta', icon: 'okta' }
  // ...
}
```

#### 3. Document Setup Steps

Create a section in the [Authentication docs](/admin/auth) with step-by-step instructions for configuring the provider, including screenshots of the provider's admin console.

#### 4. Write Tests

Test:

- Provider detection from issuer URL
- Callback handling with the provider's token format
- User profile extraction (name, email, avatar)

## Good First Issues

Looking for your first contribution? These are well-scoped integration tasks:

- **Dropbox connector** — Similar to Google Drive, well-documented API
- **Box connector** — Enterprise file storage, REST API
- **Okta auth** — Standard OIDC, likely works with minimal changes
- **OneLogin auth** — Standard OIDC
- **Translations** — Internationalize the UI strings

Check [GitHub Issues](https://github.com/jerv/edgebric/issues) for issues labeled `good first issue`.
