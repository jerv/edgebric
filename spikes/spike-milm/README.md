# Spike 1 — mILM

## Status: COMPLETE — 4/4 PASS

**Tested against real mimik mILM v1.6.0 on macOS ARM64 (mim-OE-ai v3.18.0)**

mILM's API is OpenAI-compatible — same endpoints, same request/response format.
Production base URL: `http://localhost:8083/api/mim/v1`

## Results

| Test | Result | Details |
|------|--------|---------|
| List models | PASS | Returns `{"data":[{"id":"qwen2.5-1.5b-instruct","readyToUse":true},{"id":"nomic-embed-text","readyToUse":true}]}` |
| Chat completion | PASS | Model loaded cold in 6.4s; response correct |
| Embeddings | PASS | 768-dim vectors from nomic-embed-text |
| Streaming SSE | PASS | `data: {...}` chunks, token-by-token streaming |

## Key Findings

- Auth: `Authorization: Bearer <API_KEY>` header (uppercase Bearer)
- Embedding dims: 768 (nomic-embed-text-v1.5.Q4_K_M.gguf)
- Streaming format: standard OpenAI SSE — works with our fetch + ReadableStream client
- `MCM.API_ALIAS: true` means endpoints available at `/api/mim/v1` (alias) AND `/912e9964-.../mim/v1` (canonical)
- **Cold start behavior**: First request includes `<|loading_model|> N%` tokens in the response as the GGUF model loads into memory. Subsequent requests are instant (~0.5s). Client code should handle or filter these tokens.

## Model Loading API (confirmed from v1.6.0)

```
POST /api/mim/v1/models
Content-Type: application/json
Authorization: Bearer <API_KEY>

{
  "id": "qwen2.5-1.5b-instruct",
  "object": "model",
  "url": "https://huggingface.co/Qwen/.../qwen2.5-1.5b-instruct-q4_k_m.gguf"
}
```

Response: SSE stream of `{"size": N, "totalSize": M}` progress events.
After completion: `GET /models` shows `"readyToUse": true`.

## Setup

```bash
# edgeEngine must be running first
cd scripts/binaries/mim-OE-ai && ./start.sh

# Deploy containers (first time)
export DEVELOPER_ID_TOKEN="<from console.mimik.com>"
./scripts/deploy-mimik.sh

# Download models
export MILM_API_KEY="<from deploy output>"
./scripts/download-model.sh

# Run spike test (Spike 4 end-to-end)
cd spikes/spike-rag && python3.11 test-real-rag.py --model qwen3.5-9b
```

## Question

Does mILM's OpenAI-compatible API actually work for both chat AND embeddings?

**Answer: Yes.** Both endpoints return standard OpenAI-format responses.
Our `packages/edge/src/milm.ts` wrappers are correct.

## Notes on Previous mimik Binary Issue (RESOLVED)

The macOS edgeEngine binary (v3.10.0) used an older signing key that rejected
personal developer licenses issued after the key rotation (~late 2025).
**Resolution:** Download `mim-OE-ai-SE-macOS-developer-ARM64-v3.18.0.zip` from
`github.com/mim-OE/mim-OE-SE-macOS` (the maintained repo, not the archived
`edgeEngine/edgeEngine-SE-macOS` repo). The new binary is called `mim` (not `edge`).
