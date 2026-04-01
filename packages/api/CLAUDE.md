# @edgebric/api

Express 4 backend. SQLite (better-sqlite3) + Drizzle ORM + sqlite-vec for vector search + FTS5 for BM25.

## Route Mount Points (from app.ts)

```
/api/health              healthRouter
/api/auth                authRouter
/api/documents           documentsRouter
/api/query               queryRouter          (rate limited: 20/min per session)
/api/admin/models        modelsRouter
/api/conversations       conversationsRouter
/api/notifications       notificationsRouter
/api/sync                syncRouter
/api/feedback            feedbackRouter
/api/data-sources        dataSourcesRouter
/api/admin/org           orgRouter
/api/admin/integrations  integrationsRouter
/api/cloud-connections   cloudConnectionsRouter (OAuth endpoints: 5/min limit)
/api/group-chats         groupChatsRouter + groupChatQueryRouter
/api/audit               auditRouter
/api/vault               vaultRouter
/api/mesh/peer           meshInterNodeRouter  (MeshToken auth, NOT session)
/api/mesh                meshRouter
/api/avatars             static files from data/avatars/
```

Check these mount paths before writing tests — don't guess the prefix.

## Testing

- `createApp()` in app.ts accepts options to skip session/CSRF/rate-limit/logging for tests.
- Seed test data via service functions (e.g. `documentStore.setDocument()`, `userStore.inviteUser()`), NOT direct DB inserts.
- For routes with background jobs (upload → ingest), add async teardown delay.
- Admin-only routes (`/api/admin/*`) return 403 for members. Org-scoped routes return 404 for wrong org.

## DB Patterns

- Schema: `src/db/schema.ts` (Drizzle table definitions). CREATE TABLE: `src/db/index.ts`.
- These MUST stay in sync. When adding a column: update schema.ts, CREATE TABLE block, AND add ALTER TABLE migration.
- All IDs are text (UUIDs). Dates are ISO text strings. Booleans are integers (0/1).
- `datasetName` on dataSources/documents is the legacy "knowledge-base" column name — don't rename it, it's for DB compat.

## Key Middleware Stack (order matters)

1. Helmet (CSP headers)
2. pino-http logging
3. CORS (frontend URL + localhost + mDNS)
4. Rate limiting (100/min global)
5. JSON body parser (1mb limit)
6. Cookie parser
7. Sessions (file-backed, cookie: `edgebric.sid`)
8. CSRF (double-submit cookie: `edgebric.csrf` / header: `x-csrf-token`)

## Service Layer

Business logic lives in `src/services/`. Routes are thin — they validate input (Zod), call services, return responses. Don't put business logic in route handlers.
