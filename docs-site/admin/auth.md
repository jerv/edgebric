# Authentication Setup

Edgebric uses OIDC (OpenID Connect) for authentication — the same technology behind "Sign in with Google" and "Sign in with Microsoft" buttons. In Solo mode, no authentication is needed. In Admin mode, you configure an identity provider so your team can sign in.

## Supported Providers

| Provider | Status |
|----------|--------|
| Google | Supported |
| Microsoft Entra ID (Azure AD) | Supported |
| Okta | Planned |
| OneLogin | Planned |
| Ping Identity | Planned |
| Generic OIDC | Planned |

## Google OIDC

### Step 1: Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **Select a project** > **New Project**
3. Name it (e.g., "Edgebric Auth") and click **Create**

### Step 2: Configure the OAuth Consent Screen

1. In the left menu, go to **APIs & Services** > **OAuth consent screen**
2. Choose **Internal** (for Google Workspace orgs) or **External** (for anyone with a Google account)
3. Fill in:
   - **App name**: Edgebric
   - **User support email**: Your email
   - **Authorized domains**: Your domain (if applicable)
4. Under **Scopes**, add:
   - `openid`
   - `email`
   - `profile`
5. Click **Save and Continue**

### Step 3: Create OAuth Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Choose **Web application**
4. Set:
   - **Name**: Edgebric
   - **Authorized redirect URIs**: `https://YOUR_SERVER:3001/api/auth/callback`
5. Click **Create**
6. Copy the **Client ID** and **Client Secret**

### Step 4: Configure Edgebric

Enter these values in the Edgebric setup wizard, or set them as environment variables:

| Variable | Value |
|----------|-------|
| `OIDC_ISSUER` | `https://accounts.google.com` |
| `OIDC_CLIENT_ID` | Your client ID from step 3 |
| `OIDC_CLIENT_SECRET` | Your client secret from step 3 |
| `OIDC_REDIRECT_URI` | `https://YOUR_SERVER:3001/api/auth/callback` |
| `ADMIN_EMAILS` | Comma-separated list of admin email addresses |

### Step 5: Test

1. Restart Edgebric
2. Open the web interface
3. Click **Sign in with Google**
4. Sign in with one of the admin emails
5. You should land on the admin dashboard

## Microsoft Entra ID (Azure AD)

### Step 1: Register an Application

1. Go to [portal.azure.com](https://portal.azure.com)
2. Navigate to **Microsoft Entra ID** > **App registrations**
3. Click **New registration**
4. Fill in:
   - **Name**: Edgebric
   - **Supported account types**: Choose based on your needs:
     - "Single tenant" for your organization only
     - "Multitenant" for any Microsoft account
   - **Redirect URI**: Select **Web** and enter `https://YOUR_SERVER:3001/api/auth/callback`
5. Click **Register**

### Step 2: Create a Client Secret

1. In your app registration, go to **Certificates & secrets**
2. Click **New client secret**
3. Add a description and choose an expiration
4. Click **Add**
5. Copy the **Value** immediately (you can't see it again)

### Step 3: Note Your IDs

From the app registration **Overview** page, copy:

- **Application (client) ID**
- **Directory (tenant) ID**

### Step 4: Configure Edgebric

| Variable | Value |
|----------|-------|
| `OIDC_ISSUER` | `https://login.microsoftonline.com/YOUR_TENANT_ID/v2.0` |
| `OIDC_CLIENT_ID` | Your application (client) ID |
| `OIDC_CLIENT_SECRET` | Your client secret value |
| `OIDC_REDIRECT_URI` | `https://YOUR_SERVER:3001/api/auth/callback` |
| `ADMIN_EMAILS` | Comma-separated list of admin email addresses |

### Step 5: Test

1. Restart Edgebric
2. Open the web interface
3. Click **Sign in with Microsoft**
4. Sign in with an admin account
5. You should land on the admin dashboard

## Environment Variables Reference

All authentication configuration is done through environment variables in `packages/api/.env`:

| Variable | Description | Required |
|----------|-------------|----------|
| `OIDC_ISSUER` | Identity provider URL | Yes (Admin mode) |
| `OIDC_CLIENT_ID` | OAuth client ID | Yes (Admin mode) |
| `OIDC_CLIENT_SECRET` | OAuth client secret | Yes (Admin mode) |
| `OIDC_REDIRECT_URI` | Callback URL | Yes (Admin mode) |
| `FRONTEND_URL` | Frontend URL for redirects | Yes |
| `ADMIN_EMAILS` | Comma-separated admin emails | Yes (Admin mode) |
| `SESSION_SECRET` | Secret for signing session cookies | Yes |

## Troubleshooting

### "Redirect URI mismatch"

The redirect URI in your identity provider must exactly match the `OIDC_REDIRECT_URI` in your `.env` file, including the protocol (`https://`), hostname, port, and path.

### "Access denied" after sign-in

Check that the user's email is in the `ADMIN_EMAILS` list (for admin access) or that they've been invited as a member.

### Users can't see the sign-in page

Make sure the Edgebric server is running and accessible on the network. The desktop app's menu bar icon should be green.
