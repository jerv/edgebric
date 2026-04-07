# Integrations

Edgebric connects to cloud storage providers so you can sync documents from services your organization already uses. Admin credentials are configured here; individual users connect their accounts from the Library page.

## Cloud Storage Providers

### Google Drive

#### Admin Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Open the same project used for [Google authentication](/admin/auth#google-oidc)
3. Enable the **Google Drive API**:
   - Go to **APIs & Services** > **Library**
   - Search for "Google Drive API"
   - Click **Enable**
4. The OAuth credentials from your auth setup work for Drive access too — no additional credentials needed
5. In Edgebric, go to **Admin** > **Settings** > **Integrations**
6. Under Google Drive, toggle **Enabled**
7. Enter the OAuth client ID and secret (same as your auth credentials)

#### User Connection

Once the admin enables Google Drive:

1. Users go to **Library** > open a data source > **Connect Cloud Storage** > **Google Drive**
2. They sign in with Google and authorize access
3. They select folders to sync

### Microsoft OneDrive

#### Admin Setup

1. Go to [portal.azure.com](https://portal.azure.com)
2. Open your app registration (from [Microsoft auth setup](/admin/auth#microsoft-entra-id-azure-ad))
3. Add the **Microsoft Graph** API permission:
   - Go to **API permissions** > **Add a permission**
   - Select **Microsoft Graph** > **Delegated permissions**
   - Add: `Files.Read`, `Files.Read.All`
4. Click **Grant admin consent** (for your organization)
5. In Edgebric, go to **Admin** > **Settings** > **Integrations**
6. Under OneDrive, toggle **Enabled**
7. Enter the OAuth client ID, secret, and tenant ID

#### User Connection

Once the admin enables OneDrive:

1. Users go to **Library** > open a data source > **Connect Cloud Storage** > **OneDrive**
2. They sign in with Microsoft and authorize access
3. They browse OneDrive folders and select ones to sync

### Confluence

::: info Coming Soon
Confluence integration is in development. The database schema is ready, and implementation is planned for a future release.
:::

### Notion

::: info Coming Soon
Notion integration is in development. Per-user workspace sync is planned for a future release.
:::

## Privacy & General Settings

In **Admin** > **Settings** > **Integrations**, you can also configure:

| Setting | Description | Default |
|---------|-------------|---------|
| **Private Mode enabled** | Allow members to use Private Mode | Yes |
| **Vault Mode enabled** | Allow members to create Vault sources | Yes |
| **General answers enabled** | Allow AI to answer using general knowledge when no documents are relevant | Yes |
| **Staleness threshold (days)** | Days before a document is flagged as stale | 180 |

## Integration Security

- OAuth tokens are stored encrypted in Edgebric's database
- Tokens are scoped to the minimum permissions needed
- Users can disconnect their cloud accounts at any time
- Admins can see all active connections but cannot access other users' cloud files
- Documents synced from cloud storage are stored locally — Edgebric does not write back to cloud services
