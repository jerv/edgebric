#!/usr/bin/env bash
# deploy-mimik.sh — Deploy mILM and mKB containers to local edgeEngine
# Requires: edgeEngine running on localhost:8083, DEVELOPER_ID_TOKEN set
#
# Usage:
#   export DEVELOPER_ID_TOKEN="<your token from console.mimik.com>"
#   export MILM_API_KEY="choose-any-secret-key"
#   ./scripts/deploy-mimik.sh

set -euo pipefail

EDGE_BASE="http://localhost:8083"
MILM_API_KEY="${MILM_API_KEY:-edgebric-milm-key-$(openssl rand -hex 8)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARIES_DIR="$SCRIPT_DIR/binaries"
MILM_TAR="$BINARIES_DIR/mILM/mim-v1-1.6.0.tar"
MKB_TAR="$BINARIES_DIR/mKB/mkb-v1-1.3.0.tar"

# ── Step 1: Verify edgeEngine is up ──────────────────────────────────────────
echo "Checking edgeEngine..."
if ! curl -sf "$EDGE_BASE/info" > /dev/null 2>&1; then
  echo "ERROR: edgeEngine not responding at $EDGE_BASE"
  echo "Start it first: cd scripts/binaries/edgeEngine && ./start.sh"
  exit 1
fi
echo "edgeEngine is up."

# ── Step 2: Get edge access token ─────────────────────────────────────────────
if [[ -z "${DEVELOPER_ID_TOKEN:-}" ]]; then
  echo "ERROR: DEVELOPER_ID_TOKEN is not set."
  echo "Get it from console.mimik.com → your project → ID Token"
  exit 1
fi

echo "Getting edge access token..."
EDGE_TOKEN_JSON=$(node -e "
const account = require('/opt/homebrew/lib/node_modules/@mimik/mimik-edge-cli/src/lib/account');
account.getEdgeAccessToken('$DEVELOPER_ID_TOKEN', undefined, false)
  .then(r => console.log(JSON.stringify(r)))
  .catch(e => { console.error(e.message); process.exit(1); });
")
EDGE_TOKEN=$(echo "$EDGE_TOKEN_JSON" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); console.log(JSON.parse(d).access_token);")
echo "Got edge access token."

# ── Step 3: Associate account ─────────────────────────────────────────────────
echo "Associating developer account with edge node..."
node -e "
const account = require('/opt/homebrew/lib/node_modules/@mimik/mimik-edge-cli/src/lib/account');
account.callJsonRpc('associateAccount', ['$EDGE_TOKEN', undefined])
  .then(r => { console.log('Associated:', JSON.stringify(r.result)); })
  .catch(e => { console.error('Associate error:', e.message); process.exit(1); });
"

# ── Step 4: Load mILM image ──────────────────────────────────────────────────
echo "Loading mILM image (this may take 30–60s for the first load)..."
curl -sf -X POST \
  -H "Authorization: Bearer $EDGE_TOKEN" \
  -F "image=@$MILM_TAR;type=application/x-tar" \
  "$EDGE_BASE/mcm/v1/images" | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const r=JSON.parse(d);
if(r.error) { console.error('Load mILM failed:', r.error.message); process.exit(1); }
console.log('mILM image loaded:', r.name || JSON.stringify(r));
"

# ── Step 5: Start mILM container ─────────────────────────────────────────────
echo "Starting mILM container..."
curl -sf -X POST \
  -H "Authorization: Bearer $EDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"mim-v1\",
    \"image\": \"mim-v1\",
    \"env\": {
      \"MCM.BASE_API_PATH\": \"/mim/v1\",
      \"MCM.API_ALIAS\": \"true\",
      \"API_KEY\": \"$MILM_API_KEY\"
    }
  }" \
  "$EDGE_BASE/mcm/v1/containers" | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const r=JSON.parse(d);
if(r.error) { console.error('Start mILM failed:', r.error.message); process.exit(1); }
console.log('mILM container started.');
"

# ── Step 6: Load mKB image ───────────────────────────────────────────────────
echo "Loading mKB image..."
curl -sf -X POST \
  -H "Authorization: Bearer $EDGE_TOKEN" \
  -F "image=@$MKB_TAR;type=application/x-tar" \
  "$EDGE_BASE/mcm/v1/images" | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const r=JSON.parse(d);
if(r.error) { console.error('Load mKB failed:', r.error.message); process.exit(1); }
console.log('mKB image loaded:', r.name || JSON.stringify(r));
"

# ── Step 7: Start mKB container ──────────────────────────────────────────────
# mKB points at mILM's embedding endpoint for internal embedding calls
MILM_EMBED_URL="$EDGE_BASE/api/mim/v1/embeddings"

echo "Starting mKB container..."
curl -sf -X POST \
  -H "Authorization: Bearer $EDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"mkb-v1\",
    \"image\": \"mkb-v1\",
    \"env\": {
      \"MCM.BASE_API_PATH\": \"/mkb/v1\",
      \"MCM.API_ALIAS\": \"true\",
      \"MCM.DB_EMBEDDING_SUPPORT\": \"true\",
      \"API_KEY\": \"$MILM_API_KEY\",
      \"GEN_AI_EMBEDDING_URI\": \"$MILM_EMBED_URL\",
      \"GEN_AI_API_KEY\": \"$MILM_API_KEY\"
    }
  }" \
  "$EDGE_BASE/mcm/v1/containers" | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const r=JSON.parse(d);
if(r.error) { console.error('Start mKB failed:', r.error.message); process.exit(1); }
console.log('mKB container started.');
"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "All containers deployed successfully!"
echo ""
echo "mILM:   $EDGE_BASE/api/mim/v1"
echo "mKB:    $EDGE_BASE/api/mkb/v1"
echo "API Key: $MILM_API_KEY"
echo ""
echo "Save the API key to your .env file:"
echo "  MIMIK_BASE_URL=$EDGE_BASE"
echo "  MIMIK_API_KEY=$MILM_API_KEY"
echo ""
echo "Next: run Spike 1 (mILM) to download models and verify chat/embeddings."
