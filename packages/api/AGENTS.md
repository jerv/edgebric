# @edgebric/api

Express backend for auth, documents, query, integrations, mesh, and audit features.

## Route Mounts

```text
/api/health
/api/auth
/api/documents
/api/query
/api/admin/models
/api/conversations
/api/notifications
/api/sync
/api/feedback
/api/data-sources
/api/admin/org
/api/admin/integrations
/api/cloud-connections
/api/group-chats
/api/audit
/api/vault
/api/mesh/peer
/api/mesh
/api/avatars
```

Check prefixes in `src/app.ts` before writing or updating route tests.

## Backend Rules

- Keep route handlers thin: validate input, call services, return responses.
- Put business logic in `src/services/`, not directly in routes.
- Use the existing service/store helpers to seed test state instead of direct DB writes when practical.
- Keep `schema.ts`, CREATE TABLE statements in `src/db/index.ts`, and any ALTER TABLE migrations aligned.

## Security Rules

- All route input must go through the shared Zod validation helpers.
- Tool code that touches documents must respect accessible data source filtering.
- Mesh requests must forward and enforce the requesting user’s allowed data source IDs.
- Preserve prompt-injection hardening in the RAG/system prompt path.
- Use the crypto helpers for encrypted DB fields or files; do not invent parallel encryption paths.

## Testing

- `createApp()` supports test-mode options for skipping session/CSRF/rate-limit/logging layers when needed.
- Cover both happy paths and rejection paths for auth, org scoping, and admin-only behavior.
- When changing background-job flows, account for async completion in tests and teardown.
