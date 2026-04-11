# Edgebric App Repo

Private AI knowledge platform monorepo. This checkout is the real git repo for product code.

## Structure

- `packages/api/` — Express backend, SQLite, Drizzle, mesh, auth, integrations
- `packages/web/` — React frontend, Vite, TanStack Router, Tailwind, shadcn/ui
- `packages/core/` — RAG orchestration, chunking, prompt construction, retrieval
- `packages/desktop/` — Electron menu bar app and packaged runtime resources
- `shared/types/` — shared TypeScript types and model catalog
- `e2e/` and `e2e-live/` — Playwright and live integration coverage

## Workflow

- Keep work on a dedicated `codex/*` branch when making tracked changes.
- The desktop app is the only supported dev entrypoint. Do not run the API or web app as independent dev servers unless the user explicitly asks.
- After UI changes that affect the packaged app, rebuild web before restarting the desktop app.
- Do not “fix” the local environment by reinstalling dependencies, deleting caches, or nuking `node_modules` without asking.

## Commands

Run from this repo root:

```bash
pnpm build
pnpm test
pnpm test:e2e
pnpm lint
pnpm typecheck
```

- Package manager: `pnpm@10.6.4`
- Restart helper: `scripts/restart-desktop.sh`

## Guardrails

- `packages/desktop/resources/` contains generated runtime assets. Treat generated bundles as outputs, not source of truth.
- Keep DB schema definitions in `packages/api/src/db/schema.ts` aligned with CREATE TABLE logic in `packages/api/src/db/index.ts`.
- Use `@edgebric/types` and `@edgebric/core` workspace imports instead of duplicating shared types or RAG logic.

## UI Rules

- Support both light and dark mode.
- Preserve mobile-first behavior: responsive layouts, 44px touch targets, no hover-only actions without a visible touch fallback, and viewport-safe widths for wide content/popovers.
- Use shadcn/ui patterns already in the repo; do not introduce another component library.

## Testing Rules

- New or changed backend logic should get unit tests.
- Assert concrete behavior, not only status codes or `.toBeDefined()`.
- Cover happy paths and edge/error cases for new branches.
