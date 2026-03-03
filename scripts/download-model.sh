#!/usr/bin/env bash
# download-model.sh — Download LLM and embedding models into mILM
# Requires: mILM container running, MILM_API_KEY set
#
# Usage:
#   export MILM_API_KEY="your-key-from-deploy"
#   ./scripts/download-model.sh

set -euo pipefail

EDGE_BASE="http://localhost:8083"
MILM_API_KEY="${MILM_API_KEY:?Set MILM_API_KEY first}"
MILM_URL="$EDGE_BASE/api/mim/v1"

echo "Checking mILM is running..."
if ! curl -sf -H "Authorization: Bearer $MILM_API_KEY" "$MILM_URL/models" > /dev/null 2>&1; then
  echo "ERROR: mILM not responding. Deploy containers first: ./scripts/deploy-mimik.sh"
  exit 1
fi

echo "Downloading Qwen2.5-1.5B-Instruct (chat model, ~1GB)..."
curl -sf -X POST \
  -H "Authorization: Bearer $MILM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "modelId": "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
    "modelName": "qwen2.5-1.5b-instruct-q4_k_m.gguf",
    "huggingFaceUrl": "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"
  }' \
  "$MILM_URL/models/download" | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
console.log('Chat model download started:', d.trim());
"

echo "Downloading nomic-embed-text-v1.5 (embedding model, ~270MB)..."
curl -sf -X POST \
  -H "Authorization: Bearer $MILM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "modelId": "nomic-ai/nomic-embed-text-v1.5-GGUF",
    "modelName": "nomic-embed-text-v1.5.Q4_K_M.gguf",
    "huggingFaceUrl": "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf"
  }' \
  "$MILM_URL/models/download" | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
console.log('Embedding model download started:', d.trim());
"

echo ""
echo "Model downloads queued. Poll status:"
echo "  curl -H 'Authorization: Bearer \$MILM_API_KEY' $MILM_URL/models"
echo ""
echo "Once models show status: 'ready', run Spike 1 tests."
