# Edgebric

> Status: archived / maintenance-only. This project is no longer being actively developed. The repository remains available as-is for reference and local use.

Private AI knowledge platform. Upload documents, ask questions, get cited answers — all processed locally on your hardware.

Open source under [AGPL-3.0](LICENSE). See [edgebric.com](https://edgebric.com) for details and downloads.

## Quick Start

### Download the app

Head to [edgebric.com](https://edgebric.com) — download, drag to Applications, launch. No terminal required.

### Or install via command line

```bash
curl -fsSL https://edgebric.com/install.sh | bash
```

### Or build from source

Prerequisites: macOS, Node.js 20+, pnpm 10+.

```bash
git clone https://github.com/jerv/edgebric.git
cd edgebric
pnpm install
pnpm build
cd packages/desktop && pnpm dev
```

The desktop app manages everything (llama-server, API server, setup). Open the web UI from the tray menu.

## Project Structure

```
packages/
  api/       Express backend (TypeScript, SQLite, Drizzle ORM)
  web/       React frontend (Vite, TanStack Router, shadcn/ui)
  core/      RAG orchestrator, ingestion, PII detection
  desktop/   Electron menu bar app (macOS)
shared/
  types/     Shared TypeScript type definitions
```

## Development

```bash
pnpm build        # Build all packages
pnpm test         # Unit tests (Vitest)
pnpm test:e2e     # E2E tests (Playwright)
pnpm lint         # ESLint
pnpm typecheck    # TypeScript check
```

The desktop app is the only entry point — don't start the API or web dev servers separately. Use `scripts/restart-desktop.sh` to restart after changes.

See [docs](https://docs.edgebric.com/contributing/development) for the full development guide.

## Contributing

This project is no longer being actively worked on. Issues and pull requests may not be reviewed or merged.

- [Bug reports & feature requests](https://github.com/jerv/edgebric/issues)
- [Questions & discussion](https://github.com/jerv/edgebric/discussions)
- [Security issues](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

[GNU Affero General Public License v3.0](LICENSE)
