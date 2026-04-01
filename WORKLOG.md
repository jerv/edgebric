# WORKLOG

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

**Result:** 53/53 cloudConnections tests pass. 5 pre-existing failures in meshInterNode tests (not in scope).
