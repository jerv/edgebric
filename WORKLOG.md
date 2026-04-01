# Worklog

## 2026-04-01 — agent/cloud-oauth (cloud sync agent)

### Split integrations: admin credentials + user connected accounts

**Problem:** Google Drive OAuth was broken (redirect_uri_mismatch) and all cloud integration was crammed into the admin-only Organization > Integrations page. Non-admin users couldn't connect their own accounts.

**Design decisions:**
- **Solo mode**: Shipped OAuth credentials "just work" — redirect URI is always `http://localhost:3001`. No setup needed.
- **Org mode**: Admin provides their own Google Cloud OAuth credentials (same project they already have for OIDC). Redirect URI uses their `FRONTEND_URL`.
- Users connect their own accounts from **Account > Connected Accounts** (both work and personal Google accounts supported).
- Setup instructions note: set OAuth consent screen to "External" if personal accounts should be allowed.

**Changes:**
- `shared/types/src/index.ts` — Added `googleDriveClientId`, `googleDriveClientSecret`, `onedriveClientId`, `onedriveClientSecret` to `IntegrationConfig`
- `packages/api/src/routes/integrations.ts` — Accept new credential fields in validation schema
- `packages/api/src/connectors/googleDrive.ts` — `getGoogleCredentials()` resolves custom > env > shipped defaults, exports `isCustom` flag
- `packages/api/src/routes/cloudConnections.ts` — `getBaseUrl` uses `frontendUrl` for custom credentials, `localhost` for shipped; `/providers` checks integration config; OAuth callback redirects to `/account?tab=connected-accounts`
- `packages/web/src/components/shared/ProviderLogos.tsx` — Extracted shared provider logo SVGs
- `packages/web/src/components/settings/ConnectedAccountsTab.tsx` — New "Connected Accounts" tab for Account page (any user)
- `packages/web/src/components/settings/IntegrationsTab.tsx` — Redesigned as admin credentials form
- `packages/web/src/components/SettingsPage.tsx` — Added "Connected Accounts" tab
- `packages/web/src/routes/_shell/account.tsx` — Added `connected-accounts` to valid tabs
- `packages/web/src/routes/_shell/integrations.tsx` — Legacy redirect now goes to `/account?tab=connected-accounts`

**Result:** 387/387 tests pass. Typecheck clean.

---

## 2026-03-31 — agent/cloud-work (cloud sync agent)

### Fixed blank page when non-admin clicks Integrations

**Problem:** Non-admin users navigating to `/organization?tab=integrations` (via legacy `/integrations` redirect or direct URL) saw blank content. The tab was hidden from `visibleTabs` and content guard blocked rendering.

**Fix:** Added redirect in `OrganizationPage` — if current tab is `adminOnly` and user isn't admin, redirect to `"general"` tab.

**File:** `packages/web/src/components/OrganizationPage.tsx`

---

## 2026-03-31 — agent/cloud-fixes (cloud sync agent)

### Fixed 15 failing cloudConnections tests

**Problem:** The route layer (`cloudConnections.ts`) was refactored to a folder-sync architecture but the test suite still expected connection-level endpoints (`PUT /:id`, `POST /:id/sync`, `GET /:id/files`). These routes were missing, causing 15 test failures.

**Changes:**
- `packages/api/src/routes/cloudConnections.ts`
  - Added `PUT /:id` — update connection fields + folder sync fields with Zod validation
  - Added `POST /:id/sync` — trigger sync at connection level (delegates to first folder sync)
  - Added `GET /:id/files` — list sync files across all folder syncs for a connection
  - Updated `GET /:id` — now returns `syncing` (boolean) and `syncedFileCount` on the connection object
  - Fixed OAuth callback error redirect: `/organization?tab=integrations&error=` → `/integrations?error=`
- `packages/api/src/services/cloudConnectionStore.ts`
  - Added `listFolderSyncsByConnectionId()`, `listSyncFilesByConnectionId()`, `countSyncedFilesByConnectionId()`
  - Fixed `deleteConnection()` to also cascade-delete sync files directly linked by connectionId

**Result:** 53/53 cloudConnections tests pass.

## 2026-03-31 — agent/mesh-fixes (mesh agent)

### Fixed 5 failing mesh tests

**Root causes**:
1. `searchAllNodes` tests in meshClient.test.ts had state leaking between tests — `beforeEach` called `deleteMeshConfig()` but never cleared registered nodes from the DB, so nodes accumulated across test runs causing incorrect fetch call counts.
2. `GET /api/mesh/peer/info` endpoint didn't return `meshVisibleSourceCount` field that the test expected.

**Changes**:
- `packages/api/src/services/nodeRegistry.ts` — added `removeAllNodes()` export
- `packages/api/src/__tests__/meshClient.test.ts` — call `removeAllNodes()` in `beforeEach`
- `packages/api/src/routes/meshInterNode.ts` — added `meshVisibleSourceCount` to `/info` response

**Status**: All 39 mesh tests passing.

## 2026-03-31 — agent/mesh-sidebar-fix (mesh agent)

### Fixed sidebar node click → blank page + node count off-by-one

**Problem 1:** Clicking the node name ("Main Office") in the sidebar navigated to `/organization?tab=network`, but in solo auth mode the OrganizationPage early-returned with a "Multi-user features" lock screen before rendering any tab content.

**Problem 2:** Mesh status showed "0 of 0 nodes online" because `/api/mesh/status` only counted nodes in the `meshNodes` table (remote peers). The local node is stored in `meshConfig`, not `meshNodes`, so it was never included.

**Changes:**
- `packages/web/src/components/OrganizationPage.tsx` — skip solo-mode block when `tab === "network"`
- `packages/api/src/routes/mesh.ts` — add +1 to `connectedNodes` and `totalNodes` to include self

**Status**: All 73 mesh tests passing.

## 2026-03-31 — agent/mesh-discovery-fix (mesh agent)

### Fixed LAN discovery showing self + icon change

**Problem:** "Scan LAN" showed the user's own node in results (e.g. "edgebric" at `https://edgebric.local:3001`). The self-filter compared `cfg.nodeName` (user-set, e.g. "Main Office") against the mDNS service name (hostname-derived, e.g. "edgebric") — these never matched.

**Changes:**
- `packages/api/src/routes/mesh.ts` — filter self by `os.hostname()` + `config.port` instead of node name
- `packages/web/src/components/settings/NetworkTab.tsx` — changed scan icon from `Wifi` to `Radar`

**Status**: All 34 mesh route tests passing, web typecheck clean.
