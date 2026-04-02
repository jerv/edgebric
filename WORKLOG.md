# Worklog

## 2026-04-02 — agent/llama-cpp (inference agent)

### Replaced Ollama with llama-server (llama.cpp)

**Problem:** Ollama adds an abstraction layer over GGUF models with its own registry, model naming, and API. Switching to llama-server (llama.cpp's built-in HTTP server) gives direct GGUF file management, HuggingFace downloads, and an OpenAI-compatible API without the middleman.

**Architecture:**
- **Two llama-server instances**: Chat server (port 8080) and embedding server (port 8081), since llama-server loads one model at a time.
- **GGUF files stored at** `~/Edgebric/.llama/models/` — users download models from HuggingFace directly.
- **Metal GPU acceleration** enabled by default (`--n-gpu-layers 99`).

**Changes:**
- `packages/desktop/src/main/llama-server.ts` — New lifecycle manager: download pre-built binary from llama.cpp GitHub releases (macOS arm64/x64), start/stop chat+embedding instances, auto-update with rollback, GGUF download from HuggingFace
- `packages/desktop/src/main/ipc.ts` — Rewrote all model management handlers: models-list scans GGUF files on disk, models-pull downloads from HuggingFace, models-load restarts chat server with new model, models-delete removes GGUF file, models-search queries HuggingFace API
- `packages/desktop/src/main/server.ts` — Updated startup to launch two llama-server instances
- `packages/desktop/src/main/config.ts` — `ollamaAutoUpdate` → `llamaAutoUpdate`
- `packages/api/src/services/inferenceClient.ts` — New client: health checks via `/health`, embeddings via `/v1/embeddings` (OpenAI format), model listing from filesystem, GGUF download with progress
- `packages/api/src/services/chatClient.ts` — Renamed from `ollamaChatClient.ts` (already used OpenAI-compatible endpoint, no logic changes needed)
- `packages/api/src/config.ts` — `config.ollama` → `config.inference` with `chatBaseUrl` (port 8080) and `embeddingBaseUrl` (port 8081)
- `packages/api/src/routes/models.ts` — Swapped `ollamaClient` → `inferenceClient`
- `packages/api/src/routes/query.ts` — Updated imports to `inferenceClient`
- `packages/api/src/routes/vault.ts` — Updated proxy endpoints for llama-server's `/v1/embeddings` and `/v1/chat/completions`
- `packages/api/src/routes/health.ts` — Pings `/health` instead of `/api/tags`
- `packages/api/src/server.ts` — Simplified auto-setup (desktop manages model installs now)
- `shared/types/src/models.ts` — Catalog entries now include `ggufFilename` and `downloadUrl` (HuggingFace URLs); `StorageBreakdown.ollamaModelsBytes` → `modelsBytes`; added `MODEL_FILENAME_MAP`
- `packages/desktop/src/renderer/pages/ServerDashboard.tsx` — Updated storage breakdown field names
- `packages/web/src/components/shared/ResourceBars.tsx` — Updated storage breakdown field names
- `packages/web/src/routes/privacy.tsx` — "Ollama" → "llama.cpp"
- `packages/web/src/routes/acknowledgments.tsx` — Updated project card to llama.cpp
- Deleted `packages/api/src/services/ollamaClient.ts`

**Default models (GGUF Q4_K_M quantization):**
- Chat: Qwen3-4B (2.7 GB), Qwen3-8B (5.5 GB), Qwen3-14B (9.5 GB)
- Embedding: nomic-embed-text-v1.5 (0.15 GB)

**Result:** 387/387 tests pass. Typecheck clean across all packages.

---

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
