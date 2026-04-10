# Changelog

All notable changes to Edgebric are documented here.

## [0.9.62] — 2026-04-10

### Fixed
- Solo-mode desktop launches now use the correct local access URL instead of broken `edgebric.local` resolution
- Solo-mode startup no longer inherits stale TLS behavior from past non-solo installs
- Model management remains available with the server off, but loading a model is now blocked until the server is running

## [0.9.61] — 2026-04-10

### Fixed
- Desktop app stuck on "starting" after reinstall — TLS cert/protocol mismatch between health check and API server
- Model management now works without server running (list, download, delete, import are all local operations)
- Auto-downloads default chat model (Qwen 3.5 4B) if no chat models exist on disk — no manual setup needed after data loss

## [0.9.6] — 2026-04-09

### Added
- Group chat feature parity with solo chat (threads, @bot queries, source sharing)
- Tool use support in group chat query route
- Multi-file (split) GGUF model download, listing, and deletion
- AI Behavior popover for customizing system behavior
- "No Sources" mode — chat without any knowledge base attached

### Fixed
- Memory system persistence across sessions
- Tool state persistence across conversations
- Auto-updater publish config — users can now check for updates
- OpenClaw skill metadata (primary credential, destructive op guards)
- CLA workflow for external contributors
- Release script enforces proper dev → PR → main → tag flow

## [0.9.54] — 2026-04-08

### Fixed
- Performance and UI polish improvements
- Model management UI overhaul (cleaner badges, unified styling)
- Disclaimer toggle in settings
- Release pipeline stability (smoke test before electron-rebuild)

## [0.9.5] — 2026-03-30

### Added
- Telegram bot integration — ask questions, upload documents, manage sources via Telegram
- Agent memory system — AI remembers preferences, facts, and instructions across conversations
- Hybrid RAG settings — query decomposition, LLM re-ranking, iterative retrieval (admin toggleable)

### Fixed
- Documentation updates for new features

## [0.9.4] — 2026-03-26

### Added
- Hybrid RAG improvements (query decomposition, LLM re-ranking, iterative retrieval)
- Auto-tweet workflow for releases

### Security
- Confirmation dialog before opening external URLs
- Stop leaking raw error messages in cloud connection routes
- Parameter validation on PII approve/reject routes
- Prototype pollution prevention in integration config merge
- LIKE wildcard escaping in chunk registry queries
- SSRF blocking in read_url tool

## [0.9.3] — 2026-03-22

### Added
- Code of Conduct, Security Policy, PR template
- Vault embedding noise protection (per-dataset, preserves ANN search)

### Fixed
- Misleading in-app messaging and documentation claims
- Private mode anonymization, tool count, path validation
- README accuracy improvements

## [0.9.2] — 2026-03-19

### Security
- Build-time Google Drive credentials (no runtime secrets in frontend)
- llama-server auth, DNS rebinding protection, PII search filter
- Vault prompt hardening

### Added
- Curl install script for CLI users
- Model catalog updates (Gemma 4, Phi-4 Reasoning Vision)
- Model compatibility guide and evaluation checklist

### Fixed
- Dead file cleanup, unused dependency removal, .gitignore hardening

## [0.9.1] — 2026-03-15

Initial public release.

### Features
- Document ingestion (PDF, DOCX, TXT, MD) with automatic chunking and embedding
- RAG-powered Q&A with source citations
- Hybrid search (vector + BM25 via Reciprocal Rank Fusion)
- Cloud integrations (Google Drive, OneDrive, Confluence, Notion)
- PII detection with configurable modes (off, warn, block)
- OIDC/SSO authentication (Google, Microsoft) or Solo mode
- Multi-org support with data isolation
- Per-source access control
- Mesh networking (multi-node, fan-out queries, no document replication)
- Privacy modes (Standard, Private, Vault)
- Dark mode, mobile-responsive UI
- macOS menu bar app (Electron) managing llama-server lifecycle
- Docker support for server deployments
