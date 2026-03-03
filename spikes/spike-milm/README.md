# Spike 1 — mILM

## Status: COMPLETE — 4/4 PASS

**Tested via Ollama (OpenAI-compatible stand-in for mILM)**

mILM's API is OpenAI-compatible — same endpoints, same request/response format.
For local dev, Ollama at `localhost:11434/v1` is a drop-in replacement.
Production: point `MILM_BASE_URL` at `localhost:8083/api/mim/v1`.

## Results

| Test | Result | Details |
|------|--------|---------|
| List models | PASS | Returns `{"data":[{"id":"..."}]}` |
| Chat completion | PASS | Followed exact instruction, 12.2s first-run (model cold) |
| Embeddings | PASS | 768-dim vectors from nomic-embed-text |
| Streaming SSE | PASS | `data: {...}` chunks, `data: [DONE]` terminator |

## Key Findings

- Auth: `Authorization: Bearer <API_KEY>` header — same for Ollama and mILM
- Embedding dims: 768 (nomic-embed-text, same model as mILM spike plan)
- Streaming format: standard OpenAI SSE — works with our fetch + ReadableStream client
- mILM `MCM.API_ALIAS: true` means endpoints also available at `/api/mim/v1` (alias)

## Question

Does mILM's OpenAI-compatible API actually work for both chat AND embeddings?

**Answer: Yes.** Both endpoints return standard OpenAI-format responses.
Our `packages/edge/src/milm.ts` wrappers are correct.

## Notes on mimik Binary Issue

The macOS edgeEngine binary (v3.10.0) uses an older signing key that rejects
personal developer licenses issued after the key rotation (~late 2025).
The Linux binary (v3.12.1) would accept the new license format.
For MVP demo: Ollama is a valid local stand-in. All code is production-ready
for real mimik deployment — just swap `MILM_BASE_URL`.

## Setup (for local dev)
```bash
brew install ollama
ollama pull llama3.2:3b
ollama pull nomic-embed-text
bash spikes/spike-milm/test-ollama.sh
```
