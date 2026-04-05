# Worklog

## 2026-04-04 — agent/model-capabilities (Model capabilities agent)

### Added model capability detection, Qwen 3.5 catalog, capability badges

**Changes:**
- `shared/types/src/models.ts` — Added `ModelCapabilities` interface (`vision`, `toolUse`, `reasoning`), added `capabilities` and `huggingFaceUrl` fields to `ModelCatalogEntry` and optional `capabilities` to `InstalledModel`. Added `inferCapabilitiesFromTags()` helper for HuggingFace tag mapping. Replaced Qwen 3 catalog entries (4B/8B/14B) with Qwen 3.5 (4B/9B/35B-A3B MoE recommended + 27B supported). Added capabilities to all catalog entries (Phi-4, Gemma 3, nomic-embed).
- `shared/types/src/index.ts` — Re-exported new types and functions.
- `packages/api/src/routes/models.ts` — GET `/api/admin/models` now includes `capabilities` on each `InstalledModel`. Added `GET /api/admin/models/active/capabilities` endpoint for web UI feature gating.
- `packages/api/src/config.ts` — Default chat model updated from `qwen3-4b` to `qwen3.5-4b`.
- `packages/desktop/src/main/ipc.ts` — Updated duplicate catalog to Qwen 3.5 with capabilities. `models-search` handler now passes HuggingFace tags, inferred capabilities, and `huggingFaceUrl` through to renderer.
- `packages/desktop/src/preload/index.ts` + `packages/desktop/src/renderer/App.tsx` — Updated search result types with optional `tags`, `capabilities`, `huggingFaceUrl`.
- `packages/desktop/src/renderer/pages/ServerDashboard.tsx` — Added `CapabilityBadges` component: colored pill badges (👁 Vision blue, 🔧 Tools green, 🧠 Reasoning purple) with tooltips + HuggingFace link. Badges shown on loaded models, installed models, catalog models, and search results.
- `packages/web/src/components/admin/ModelsPanel.tsx` — Same capability badges for web admin panel.
- `packages/api/src/__tests__/models.test.ts` + `e2e/models.test.ts` — Updated all `qwen3-4b` references to `qwen3.5-4b`.

**Result:** 600/600 tests pass. Typecheck clean across all 5 packages.

---

## 2026-04-03 — agent/pii-settings (PII agent)

### Added per-source PII detection mode (off/warn/block)

**Problem:** PII detection was all-or-nothing — every document was scanned and blocked on PII detection. No way to configure per-source behavior. PII warnings were only visible deep inside individual document views.

**Changes:**
- `shared/types/src/index.ts` — Added `PIIMode` type (`"off" | "warn" | "block"`) and `piiMode` field to `DataSource` interface
- `packages/api/src/db/schema.ts` — Added `piiMode` column to `dataSources` table
- `packages/api/src/db/index.ts` — Added `pii_mode` to CREATE TABLE and ALTER TABLE migration
- `packages/api/src/services/dataSourceStore.ts` — `createDataSource` and `updateDataSource` accept `piiMode`; `rowToDataSource` maps the column
- `packages/api/src/routes/dataSources.ts` — `PUT /:id` accepts `piiMode`; upload route passes `piiMode` to ingestion; added `GET /pii-summary` endpoint (returns per-source document count with PII warnings)
- `packages/api/src/jobs/ingestDocument.ts` — Accepts `piiMode` option: `"off"` skips PII detection, `"warn"` stores warnings but sets status `"ready"`, `"block"` halts at `"pii_review"` (previous behavior)
- `packages/api/src/jobs/syncConnection.ts` — Passes data source's `piiMode` to `ingestDocument` during cloud sync
- `packages/web/src/components/layout/Sidebar.tsx` — Amber warning dot on Data Sources nav icon when any source has PII warnings
- `packages/web/src/components/admin/DataSourcePanel.tsx` — Warning triangle + count on source list rows; PII mode dropdown in source detail security settings
- `packages/api/src/__tests__/piiMode.test.ts` — 16 tests: default modes, API update/validation, PII summary endpoint, ingestDocument behavior for all three modes

**Result:** 562/562 tests pass. Typecheck clean across all 5 packages.

---

## 2026-04-03 — agent/agent-api (Agent API agent)

### Added universal agent API with API key authentication, OpenClaw skill, and web UI

**Problem:** No programmatic API existed for AI agents or integrations to access Edgebric. All access required browser-based session auth with CSRF tokens.

**Architecture decisions:**
- **API key auth**: Keys prefixed with `eb_` (256-bit random, base64url-encoded). Only SHA-256 hash stored — raw key shown once at creation. Keys have permission levels (read / read-write / admin) and optional source scoping (all or JSON array of source IDs).
- **Agent API v1**: Mounted at `/api/v1/` with Bearer token auth. Bypasses session/CSRF but NOT access control, safety checks, or the same ingestion pipeline as web uploads. CSRF middleware skips `/api/v1/` paths.
- **Rate limiting**: Per-key rate limiting (default 300/min general, 60/min for /query endpoint). Separate from web rate limits. Uses in-memory sliding window.
- **Source scoping**: Keys can be restricted to specific data sources. Scoped keys only see/access sources in their scope. Out-of-scope source IDs are silently ignored in search requests.

**Changes:**
- `packages/api/src/db/schema.ts` — Added `apiKeys` table (id, name, keyHash, orgId, permission, sourceScope, rateLimit, createdBy, createdAt, lastUsedAt, revoked)
- `packages/api/src/db/index.ts` — Added CREATE TABLE for api_keys with indexes on key_hash and org_id
- `packages/api/src/services/apiKeyStore.ts` — Key CRUD: createApiKey (generates eb_ prefixed key), getApiKeyByHash (lookup), listApiKeys, revokeApiKey, touchApiKey, parseScopeIds
- `packages/api/src/middleware/apiKeyAuth.ts` — Bearer token auth middleware, per-key rate limiting with sliding window, permission check factory, audit logging helper. Augments Express Request with apiKey and apiKeySourceIds.
- `packages/api/src/routes/apiKeys.ts` — Admin key management: POST / (create, returns raw key once), GET / (list without hashes), DELETE /:id (revoke). Session auth, admin-only.
- `packages/api/src/routes/agentApi.ts` — Agent API v1 endpoints:
  - GET /discover — API version, capabilities, available sources, endpoint map
  - GET /sources — List accessible sources (filtered by key scope)
  - GET /sources/:id/documents — List documents in a source
  - POST /search — Hybrid BM25+vector search with citations, no LLM synthesis
  - POST /query — Full RAG pipeline with local LLM, streaming support (SSE)
  - POST /sources — Create data source (read-write+)
  - POST /sources/:id/upload — Upload document with same validation pipeline as web (magic bytes, encryption, async ingestion)
  - DELETE /documents/:id — Delete document (read-write+)
  - DELETE /sources/:id — Delete source + all documents (admin only)
  - GET /jobs/:id — Check ingestion job status
- `packages/api/src/app.ts` — Mounted apiKeysRouter at /api/admin/api-keys, agentApiRouter at /api/v1. Added CSRF bypass for /api/v1/ paths.
- `packages/api/src/services/auditLog.ts` — Added audit event types: api.search, api.query, api.upload, api.delete, api.source_create, api.source_delete, api.key_created, api.key_revoked
- `openclaw-skill/SKILL.md` — OpenClaw skill definition with YAML frontmatter (user-invocable + model-invocable), full API documentation covering all endpoints, authentication, error handling, citation formatting, and usage tips
- `packages/web/src/components/settings/ApiKeysTab.tsx` — React component: list keys with permission badges, create key dialog with security warning, show raw key once with copy button, revoke with confirmation modal. Dark mode support.
- `packages/web/src/components/OrganizationPage.tsx` — Added "API Keys" admin tab
- `packages/web/src/components/SettingsPage.tsx` — Added "API Keys" tab for solo mode
- `packages/web/src/routes/_shell/account.tsx` — Added "api-keys" to valid tabs
- `packages/web/src/routes/_shell/organization.tsx` — Added "api-keys" to valid tabs
- `packages/api/src/__tests__/agentApi.test.ts` — 38 tests covering: key store CRUD, auth middleware (valid/invalid/revoked keys), permission enforcement (read can't write, source scoping), all read/write endpoints, error response format validation, key management routes, audit logging

**Security constraints enforced:**
- API keys bypass session/CSRF but NOT access control or safety checks
- Scoped keys cannot access out-of-scope sources (tested)
- Read keys cannot create/upload/delete (tested)
- Revoked keys immediately rejected (tested)
- Raw keys never stored, never logged, never in error messages
- All uploads go through same validation pipeline as web (file type, magic bytes, encryption, PII)
- Error responses always JSON with {error, code, status} format (tested)

**Result:** 584/584 tests pass (38 new agent API). Typecheck clean across all 5 packages.

---

## 2026-04-03 — agent/mesh-e2e (Mesh E2E testing agent)

### Full mesh testing audit + bug fixes + missing coverage

**Test audit (7 files):** All existing mesh tests are meaningful — no weak tests deleted. Tests cover: mesh config CRUD, node CRUD, group CRUD, mesh client (searchRemoteNode, getRemoteNodeInfo, sendHeartbeat, searchAllNodes), mesh inter-node protocol (auth, search, heartbeat, info), mesh scheduler lifecycle + stale detection, query router (local-only, fan-out, dedup, group filtering), Playwright E2E full lifecycle, and e2e-live vault+mesh tests.

**Bug fixed:**
- `deleteNodeGroup` in `nodeRegistry.ts` did not clean up `userMeshGroups` rows when a group was deleted. Users kept orphaned group assignments with dangling foreign keys. Fixed by adding `db.delete(userMeshGroups).where(eq(userMeshGroups.groupId, id))` before the group deletion.

**Flaky test fixed:**
- `meshScheduler.test.ts` "marks old nodes as offline" used `markStaleNodesOffline(0)` right after `heartbeat()`, causing a same-millisecond race condition. Fixed by explicitly setting `lastSeen` to 2 minutes ago and using a 60s timeout.

**New tests added (33 tests):**
- `packages/api/src/__tests__/userMeshGroups.test.ts` — 25 tests: assignUserToGroup (success, idempotent, multi-group), getUserGroups, getUserGroupIds, removeUserFromGroup, removeAllUserGroups, setUserGroups (replace, clear), getGroupMembers, deleteNodeGroup cascade cleanup, plus API route tests for PUT/GET/POST/DELETE `/api/mesh/users/:userId/groups` and GET `/api/mesh/groups/:id/members`
- `meshClient.test.ts` — 4 new tests: broadcastRevocation (sends to online nodes, handles unreachable nodes, no-op when unconfigured, skips offline nodes)
- `meshInterNode.test.ts` — 4 new tests: POST `/api/mesh/peer/revoke-user` (valid email, invalid email, missing email, unknown user returns 0)
- `e2e/mesh.test.ts` — 7 new tests: user group assignment/retrieval/members/removal, peer revoke-user endpoint with and without auth

**Code quality review (8 implementation files):**
- `meshAuth.ts` — Good. Uses `timingSafeEqual` for token comparison.
- `nodeRegistry.ts` — Good after bug fix. Batch group name loading avoids N+1.
- `meshClient.ts` — Good. Proper timeout handling, response validation, Promise.allSettled for graceful degradation.
- `meshScheduler.ts` — Good. Clean interval management, unref() for process exit.
- `queryRouter.ts` — Good. Clean merge/dedup/cap logic.
- `userMeshGroupStore.ts` — Good. Proper idempotency in assignUserToGroup.
- `mesh.ts` (routes) — Good. Audit logging on all mutations, Zod validation, token masking.
- `meshInterNode.ts` — Good. Proper search access model (group control on requesting side).

**Note:** `chunkId` parsing in both `meshInterNode.ts:92` and `queryRouter.ts:75` uses `/-(\d+)$/` regex. If a dataset name contains a hyphen followed by digits (e.g., "data-2024"), this could extract the wrong chunk index. Not fixing here as it's not in scope — just flagging for awareness.

**Result:** 637/637 tests pass (91 core + 546 api). 0 failures.

## 2026-04-02 — agent/confluence (Confluence agent)

### Added Confluence Cloud connector end-to-end

**Problem:** No Confluence integration existed. Users with Confluence Cloud couldn't sync their wiki pages into Edgebric for RAG search.

**Changes:**
- `packages/api/src/connectors/confluence.ts` — New CloudConnectorAdapter implementation:
  - Atlassian 3LO OAuth 2.0 (JSON body, not URL-encoded like Google/Microsoft)
  - `listFolders` lists Confluence spaces (composite ID: `cloudId::spaceKey`)
  - `getChanges` initial sync: CQL search for all pages in a space, plus supported attachments (PDF, DOCX) on each page
  - `getChanges` delta sync: CQL `lastModified>=` filter for incremental updates
  - `downloadFile` for pages: fetches storage format (XHTML), converts to markdown via `storageToMarkdown()`
  - `downloadFile` for attachments: binary download via encoded path in composite file ID
  - `getConfluenceCredentials()` with same priority logic: org custom > env vars > shipped defaults
- `packages/api/src/app.ts` — Side-effect import to register connector
- `packages/api/src/config.ts` — Added `config.cloud.confluence` (clientId/clientSecret from env vars)
- `packages/api/src/routes/cloudConnections.ts` — Added Confluence to credential check in `/providers`, `getBaseUrl()` helper
- `packages/api/src/routes/integrations.ts` — Added `confluenceClientId`/`confluenceClientSecret` to Zod validation schema
- `shared/types/src/cloud.ts` — Set Confluence `enabled: true`
- `shared/types/src/index.ts` — Added `confluenceClientId`/`confluenceClientSecret` to `IntegrationConfig`
- `packages/web/src/components/shared/ProviderLogos.tsx` — Added Confluence logo SVG
- `packages/web/src/components/settings/IntegrationsTab.tsx` — Added Confluence credentials card with Atlassian Developer Console setup instructions
- `packages/api/src/__tests__/confluence.test.ts` — 30 tests covering: getAuthUrl, exchangeCode, refreshAccessToken, listFolders, getChanges (initial + delta), downloadFile (pages + attachments), getConfluenceCredentials, storageToMarkdown, formatCqlDate

**Result:** 478/478 tests pass. Typecheck clean across all 5 packages.

---

## 2026-04-02 — agent/notion (Notion agent)

### Added Notion connector end-to-end

**Problem:** Notion was listed as a cloud provider but disabled (`enabled: false`) with no connector implementation.

**Architecture decisions:**
- Notion's content model differs from file-based connectors (Google Drive, OneDrive). "Folders" = databases + workspace-level pages. "Files" = individual pages downloaded as markdown.
- Notion tokens don't expire and have no refresh tokens — `refreshAccessToken` throws (should never be called).
- Notion uses Basic auth (base64 `clientId:clientSecret`) for token exchange, not form-encoded credentials.
- No shipped OAuth defaults — admin must create a public Notion integration and configure credentials. This is because Notion requires per-workspace authorization.
- Delta sync uses `last_edited_time` filter (ISO timestamp cursor) instead of change tokens.
- Page content is assembled by fetching blocks recursively (up to 3 levels deep) and converting to markdown.

**Changes:**
- `packages/api/src/connectors/notion.ts` — Full `CloudConnectorAdapter` implementation: OAuth flow, `listFolders` (databases + workspace pages), `getChanges` (database query + page sync with delta), `downloadFile` (blocks → markdown), `richTextToMarkdown`, `pageToMarkdown`. Handles all common block types (headings, lists, todos, code, quotes, dividers, images, bookmarks, tables, child pages).
- `packages/api/src/app.ts` — Side-effect import to register connector.
- `packages/api/src/routes/cloudConnections.ts` — Added `notion` to `credentialsConfigured` map, imported `getNotionCredentials`, added Notion case to `getBaseUrl` helper.
- `packages/api/src/routes/integrations.ts` — Added `notionClientId`, `notionClientSecret` to Zod validation schema.
- `shared/types/src/cloud.ts` — Set Notion `enabled: true`.
- `shared/types/src/index.ts` — Added `notionClientId`, `notionClientSecret` to `IntegrationConfig`.
- `packages/web/src/components/shared/ProviderLogos.tsx` — Added `NotionLogo` SVG and `notion` case to `ProviderLogo` switch.
- `packages/web/src/components/settings/IntegrationsTab.tsx` — Added `NotionCredentialsCard` with setup instructions (public integration creation, redirect URI, capabilities). Updated solo-mode text to mention Notion.
- `packages/api/src/__tests__/notion.test.ts` — 35 tests covering: credentials resolution, `richTextToMarkdown` (plain, bold, italic, code, strikethrough, links, combined), `extractPageTitle`, `getAuthUrl`, `exchangeCode` (Basic auth, missing email, failure), `refreshAccessToken` (throws), `listFolders` (databases + pages, pagination, errors), `getChanges` for databases (initial + delta + archived), `getChanges` for pages (with children, delta skip), `downloadFile` (markdown output, filename sanitization, errors), `pageToMarkdown` (block types, recursive children, errors).

**Result:** 476/477 tests pass (35 Notion). 1 pre-existing meshScheduler flake. Typecheck clean across all 5 packages.

---

## 2026-04-02 — agent/onedrive-finish (OneDrive agent)

### Finished OneDrive/SharePoint integration end-to-end

**Problem:** OneDrive connector existed but had no org-level custom credential support (unlike Google Drive), no setup instructions in the admin UI, no Remove button, and was marked `enabled: false` in shared types.

**Changes:**
- `packages/api/src/connectors/oneDrive.ts` — Added `getOnedriveCredentials()` with same priority logic as Google Drive: org-level integrationConfig > env vars > shipped defaults. Exports `isCustom` flag for redirect URI resolution.
- `packages/api/src/routes/cloudConnections.ts` — Updated `getBaseUrl()` to use org's `frontendUrl` when OneDrive has custom credentials (matching Google Drive behavior).
- `packages/web/src/components/settings/IntegrationsTab.tsx` — Added setup instructions (Azure Entra ID app registration steps, redirect URI, API permissions, SharePoint note), added Remove button, improved label/placeholder text.
- `shared/types/src/cloud.ts` — Set OneDrive `enabled: true`.
- `packages/api/src/__tests__/oneDrive.test.ts` — Added 3 tests for `getOnedriveCredentials` (env fallback, custom credentials priority, partial config fallback).

**Result:** 399/399 tests pass (29 OneDrive). Typecheck clean (api, web, types).

---

## 2026-04-02 — agent/release-pipeline (release agent)

### Added auto-update system, release CI/CD, and release script

**Auto-updater (`packages/desktop/src/main/updater.ts`):**
- Uses `electron-updater` with GitHub Releases as the update server
- Checks for updates 10s after app launch (packaged builds only)
- Downloads updates in the background, prompts user to restart
- "Skip this version" preference persisted to disk
- "Check for Updates..." tray menu item with dynamic label (shows download progress / restart prompt)

**electron-builder config (`packages/desktop/electron-builder.yml`):**
- Added `publish.provider: github` for electron-updater auto-update detection
- Builds DMG + zip for both arm64 and x64
- Hardened runtime + notarization config (entitlements plist)
- DMG branding: window size, icon positions, background image placeholder

**Release workflow (`.github/workflows/release.yml`):**
- Triggers on `v*` tags
- Builds on `macos-latest` with pnpm + Node 22
- Imports Apple Developer ID certificate into temporary keychain
- Runs `electron-builder --mac --arm64 --x64 --publish always`
- Notarizes via electron-builder's built-in `notarize` config
- Creates GitHub Release with DMG, zip, and `latest-mac.yml` artifacts
- Auto-generated changelog from commits

**Release script (`scripts/release.sh`):**
- Usage: `./scripts/release.sh 1.0.0`
- Validates semver, bumps version in root + desktop `package.json`
- Commits, tags, and pushes to trigger the release workflow

**New files:** `updater.ts`, `entitlements.mac.plist`, `resources/dmg-background.png` (placeholder), `scripts/release.sh`
**Modified:** `electron-builder.yml`, `release.yml`, `package.json`, `index.ts`, `tray.ts`, `pnpm-lock.yaml`
**Dependencies added:** `electron-updater@^6.3.0`, `electron-log@^5.3.0`
**Result:** Typecheck clean.

---

## 2026-04-02 — agent/ms-auth (Microsoft auth agent)

### Verified Microsoft Entra ID OIDC auth + added multi-tenant support + tests

**Review:** Audited the full Microsoft OIDC auth flow: setup wizard, OIDC discovery, login redirect, callback, token validation, claims extraction, Graph API avatar fetch. Core flow was solid — no bugs found.

**Multi-tenant support:** Updated the setup wizard to mention both single-tenant and multi-tenant options. Added `isMicrosoftMultiTenant()` and `validateMicrosoftIssuer()` helpers to `oidcProviders.ts` for issuer URL validation. The `openid-client` v5 library handles the `{tenantid}` template pattern in Microsoft's multi-tenant discovery documents, so the callback flow works for both single-tenant (UUID) and multi-tenant (`common`/`organizations`) issuer URLs.

**Changes:**
- `packages/api/src/lib/oidcProviders.ts` — Added `isMicrosoftMultiTenant()` and `validateMicrosoftIssuer()` exports
- `packages/desktop/src/renderer/pages/SetupWizard.tsx` — Added multi-tenant option in supported account types step; added `organizations` alternative in issuer URL hint
- `packages/api/src/__tests__/auth.test.ts` — Added 43 new Microsoft-specific tests covering: provider definition validation, claims extraction (email/preferred_username/upn fallbacks, guest users, B2B accounts, edge cases), multi-tenant issuer detection, issuer URL validation, scope configuration

**Result:** 91/91 auth tests pass (up from 48). Typecheck clean across api + desktop.

---

## 2026-04-02 — agent/gdrive-finish (cloud sync agent)

### Fixed orphaned documents on file modify + added sync tests

**Bug:** When a Google Drive file was modified and re-synced, `processFileChange` created a new document without cleaning up the old one. Old document, chunks, and storage file were orphaned in the database and on disk.

**Fix:** Before creating the replacement document for "modified" changes, look up the existing sync file by external ID, delete the old document's chunks, document record, and storage file.

**New store helper:** `getSyncFileByExternalId(folderSyncId, externalFileId)` in `cloudConnectionStore.ts`.

**Tests:** Added `syncConnection.test.ts` with 9 tests covering added/deleted/modified files, unsupported MIME types, empty syncs, error handling, and Google Docs MIME mapping.

**UI:** Replaced duplicate `GoogleDriveLogo` in `CloudDriveSyncSection.tsx` with shared `ProviderLogos` component.

**Result:** 399/399 tests pass. Typecheck clean.

---

## 2026-04-02 — agent/ci-fixes (CI fix agent)

### Verified CI: all checks green

Ran full CI suite (`pnpm test`, `pnpm lint`, `pnpm typecheck`) after the llama-cpp migration merge.

**Results:**
- Tests: 481 passed (91 core + 390 api), 0 failures
- Lint: 0 errors (15 pre-existing `no-explicit-any` warnings in test files)
- Typecheck: Clean across all 5 packages

No fixes needed — the llama-cpp migration landed cleanly.

---

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
