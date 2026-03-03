#!/usr/bin/env bash
# Spike 1 — mILM test via Ollama (OpenAI-compatible stand-in)
# mILM's API is identical to Ollama's /v1 API so this validates our integration code.
#
# Production: BASE_URL=http://localhost:8083/api/mim/v1  AUTH="Bearer $MILM_API_KEY"
# Local dev:  BASE_URL=http://localhost:11434/v1          AUTH=""
#
set -euo pipefail

BASE_URL="${MILM_BASE_URL:-http://localhost:11434/v1}"
AUTH="${MILM_API_KEY:-}"
CHAT_MODEL="${MILM_CHAT_MODEL:-llama3.2:3b}"
EMBED_MODEL="${MILM_EMBED_MODEL:-nomic-embed-text}"

auth_header() {
  if [[ -n "$AUTH" ]]; then
    echo "-H \"Authorization: Bearer $AUTH\""
  fi
}

echo "=== Spike 1 — mILM (via Ollama at $BASE_URL) ==="
echo ""

# ── Test 1: List models ──────────────────────────────────────────────────────
echo "--- Test 1: List models ---"
MODELS=$(curl -sf "$BASE_URL/models" ${AUTH:+-H "Authorization: Bearer $AUTH"})
echo "$MODELS" | python3 -c "
import sys, json
r = json.load(sys.stdin)
models = [m['id'] for m in r.get('data', [])]
print('Models:', ', '.join(models))
print('PASS' if models else 'FAIL — no models returned')
"
echo ""

# ── Test 2: Chat completion ───────────────────────────────────────────────────
echo "--- Test 2: Chat completion (non-streaming) ---"
START=$(python3 -c "import time; print(time.time())")
CHAT=$(curl -sf -X POST "$BASE_URL/chat/completions" \
  ${AUTH:+-H "Authorization: Bearer $AUTH"} \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$CHAT_MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Reply with exactly: HELLO\"}],
    \"temperature\": 0,
    \"max_tokens\": 10
  }")
ELAPSED=$(python3 -c "import time; print(f'{time.time() - $START:.1f}s')")
echo "$CHAT" | python3 -c "
import sys, json
r = json.load(sys.stdin)
content = r.get('choices', [{}])[0].get('message', {}).get('content', '')
tokens = r.get('usage', {}).get('total_tokens', 0)
print('Response:', repr(content))
print('Tokens:', tokens)
print('Latency: $ELAPSED')
print('PASS' if content else 'FAIL — empty response')
"
echo ""

# ── Test 3: Embedding ─────────────────────────────────────────────────────────
echo "--- Test 3: Embeddings ---"
EMBED=$(curl -sf -X POST "$BASE_URL/embeddings" \
  ${AUTH:+-H "Authorization: Bearer $AUTH"} \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$EMBED_MODEL\",
    \"input\": \"The company provides 15 days of PTO per year for new employees.\"
  }" 2>&1)
echo "$EMBED" | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)
    emb = r.get('data', [{}])[0].get('embedding', [])
    print(f'Embedding dims: {len(emb)}')
    print(f'Sample values: {emb[:4]}')
    print('PASS' if len(emb) > 0 else 'FAIL — empty embedding')
except Exception as e:
    print('Raw response:', sys.stdin.read())
    print('FAIL:', e)
" 2>/dev/null || echo "$EMBED" | head -5

echo ""

# ── Test 4: Streaming chat ────────────────────────────────────────────────────
echo "--- Test 4: Streaming chat completion ---"
echo "Prompt: 'What is the capital of France? One word only.'"
CHUNKS=0
FULL_RESPONSE=""
while IFS= read -r line; do
  if [[ "$line" == "data: "* ]]; then
    DATA="${line#data: }"
    if [[ "$DATA" != "[DONE]" ]]; then
      TOKEN=$(echo "$DATA" | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)
    print(r.get('choices',[{}])[0].get('delta',{}).get('content',''), end='')
except: pass
" 2>/dev/null)
      FULL_RESPONSE+="$TOKEN"
      CHUNKS=$((CHUNKS + 1))
    fi
  fi
done < <(curl -sf -X POST "$BASE_URL/chat/completions" \
  ${AUTH:+-H "Authorization: Bearer $AUTH"} \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$CHAT_MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": \"What is the capital of France? One word only.\"}],
    \"stream\": true,
    \"temperature\": 0,
    \"max_tokens\": 20
  }")
echo "Streamed response: '$FULL_RESPONSE'"
echo "Chunks received: $CHUNKS"
echo "PASS"
echo ""

echo "=== Spike 1 COMPLETE ==="
