#!/usr/bin/env bash
# download-model.sh — Download LLM and embedding models into mILM
# Requires: mILM container running, MILM_API_KEY set
#
# Usage:
#   export MILM_API_KEY="your-key-from-deploy"
#   ./scripts/download-model.sh
#
# mILM model API (confirmed from v1.6.0):
#   POST /api/mim/v1/models  with {id, object, url}
#   Response: SSE stream of {size, totalSize} progress events
#   When complete: GET /api/mim/v1/models shows readyToUse: true

set -euo pipefail

EDGE_BASE="http://localhost:8083"
MILM_API_KEY="${MILM_API_KEY:?Set MILM_API_KEY first}"
MILM_URL="$EDGE_BASE/api/mim/v1"

echo "Checking mILM is running..."
if ! curl -sf -H "Authorization: Bearer $MILM_API_KEY" "$MILM_URL/models" > /dev/null 2>&1; then
  echo "ERROR: mILM not responding. Deploy containers first: ./scripts/deploy-mimik.sh"
  exit 1
fi

# Check if models already downloaded
EXISTING=$(curl -sf -H "Authorization: Bearer $MILM_API_KEY" "$MILM_URL/models" | python3 -c "
import sys, json
d = json.load(sys.stdin)
ids = [m['id'] for m in d.get('data', [])]
print(' '.join(ids))
" 2>/dev/null || echo "")

echo "Existing models: ${EXISTING:-none}"

# ── Chat model: Qwen2.5-1.5B-Instruct (dev/test only) ────────────────────────
if echo "$EXISTING" | grep -q "qwen2.5-1.5b-instruct"; then
  echo "Qwen2.5-1.5B already downloaded, skipping."
else
  echo "Downloading Qwen2.5-1.5B-Instruct (~1.1GB)..."
  curl -sf -X POST \
    -H "Authorization: Bearer $MILM_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "id": "qwen2.5-1.5b-instruct",
      "object": "model",
      "url": "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"
    }' \
    "$MILM_URL/models" | tail -1
  echo "Qwen2.5-1.5B download complete."
fi

# ── Chat model: Qwen3.5-4B (incognito / mobile target) ───────────────────────
if echo "$EXISTING" | grep -q "qwen3.5-4b"; then
  echo "Qwen3.5-4B already downloaded, skipping."
else
  echo "Downloading Qwen3.5-4B Q4_K_M (~2.5GB)..."
  curl -sf -X POST \
    -H "Authorization: Bearer $MILM_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "id": "qwen3.5-4b",
      "object": "model",
      "url": "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf"
    }' \
    "$MILM_URL/models" | tail -1
  echo "Qwen3.5-4B download complete."
fi

# ── Chat model: Qwen3.5-9B (production server target) ────────────────────────
if echo "$EXISTING" | grep -q "qwen3.5-9b"; then
  echo "Qwen3.5-9B already downloaded, skipping."
else
  echo "Downloading Qwen3.5-9B Q4_K_M (~5.8GB)..."
  curl -sf -X POST \
    -H "Authorization: Bearer $MILM_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "id": "qwen3.5-9b",
      "object": "model",
      "url": "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf"
    }' \
    "$MILM_URL/models" | tail -1
  echo "Qwen3.5-9B download complete."
fi

# ── Embedding model: nomic-embed-text ─────────────────────────────────────────
if echo "$EXISTING" | grep -q "nomic-embed-text"; then
  echo "nomic-embed-text already downloaded, skipping."
else
  echo "Downloading nomic-embed-text-v1.5 (~270MB)..."
  curl -sf -X POST \
    -H "Authorization: Bearer $MILM_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "id": "nomic-embed-text",
      "object": "model",
      "url": "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf"
    }' \
    "$MILM_URL/models" | tail -1
  echo "nomic-embed-text download complete."
fi

echo ""
echo "All models ready. Verify:"
curl -sf -H "Authorization: Bearer $MILM_API_KEY" "$MILM_URL/models" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for m in d.get('data', []):
    status = 'READY' if m.get('readyToUse') else 'not ready'
    print(f'  {status}  {m[\"id\"]}')
"
