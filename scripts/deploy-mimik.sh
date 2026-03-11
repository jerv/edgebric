#!/usr/bin/env bash
# deploy-mimik.sh — Deploy mILM and mKB containers to local edgeEngine
# Requires: edgeEngine running on localhost:8083
#
# Usage:
#   export DEVELOPER_ID_TOKEN="<your token from console.mimik.com → ID Token>"
#   export MILM_API_KEY="choose-any-secret-key"   # optional, auto-generated if not set
#   ./scripts/deploy-mimik.sh
#
# Auth flow (pure curl, no Node.js required):
#   1. GET license from scripts/binaries/mim-OE-ai/mimikEdge.lic
#   2. getEdgeIdToken JSON-RPC → edge ID token
#   3. POST devconsole-mid.mimik.com/token → access token
#   4. associateAccount JSON-RPC → links account to this edgeEngine node
#   5. Load mILM and mKB .tar images via MCM
#   6. Start containers with proper env config

set -euo pipefail

EDGE_BASE="http://localhost:8083"
CLIENT_ID="912e9964-953a-41a3-a3d4-45594a196471"
MILM_API_KEY="${MILM_API_KEY:-edgebric-milm-key-$(openssl rand -hex 8)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARIES_DIR="$SCRIPT_DIR/binaries"
LIC_FILE="$BINARIES_DIR/mim-OE-ai/mimikEdge.lic"
MILM_TAR="$BINARIES_DIR/mILM/mim-v1-1.6.0.tar"
MKB_TAR="$BINARIES_DIR/mKB/mkb-v1-1.3.0.tar"

# ── Step 1: Verify edgeEngine is up ──────────────────────────────────────────
echo "Checking edgeEngine..."
GETME=$(curl -sf -X POST "$EDGE_BASE/jsonrpc/v1" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"getMe","params":[],"id":1}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['version'])" 2>/dev/null || echo "")
if [[ -z "$GETME" ]]; then
  echo "ERROR: edgeEngine not responding at $EDGE_BASE"
  echo "Start it first: cd scripts/binaries/mim-OE-ai && ./start.sh"
  exit 1
fi
echo "edgeEngine up: $GETME"

# ── Step 2: Get edge access token ─────────────────────────────────────────────
if [[ -z "${DEVELOPER_ID_TOKEN:-}" ]]; then
  echo "ERROR: DEVELOPER_ID_TOKEN is not set."
  echo "Get it from console.mimik.com → your project → ID Token"
  exit 1
fi

LIC=$(cat "$LIC_FILE")

echo "Getting edge ID token..."
EDGE_ID_TOKEN=$(curl -sf -X POST "$EDGE_BASE/jsonrpc/v1" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"getEdgeIdToken\",\"params\":[\"$LIC\"],\"id\":1}" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['result']['id_token'])")

echo "Exchanging tokens for edge access token..."
ACCESS_TOKEN=$(curl -sfL -X POST "https://devconsole-mid.mimik.com/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "id_token=$DEVELOPER_ID_TOKEN" \
  --data-urlencode "grant_type=id_token_signin" \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "scope=openid edge:mcm edge:clusters edge:account:associate" \
  --data-urlencode "edge_id_token=$EDGE_ID_TOKEN" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
echo "Access token obtained."

# ── Step 3: Associate account ─────────────────────────────────────────────────
echo "Associating developer account..."
ACCOUNT_ID=$(curl -sf -X POST "$EDGE_BASE/jsonrpc/v1" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"associateAccount\",\"params\":[\"$ACCESS_TOKEN\"],\"id\":1}" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['result']['accountId'])")
echo "Account associated: $ACCOUNT_ID"

# ── Step 4: Load mILM image ──────────────────────────────────────────────────
echo "Loading mILM image..."
curl -sf -X POST \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "image=@$MILM_TAR;type=application/x-tar" \
  "$EDGE_BASE/mcm/v1/images" | python3 -c "import sys,json; d=json.load(sys.stdin); print('mILM image loaded:', d.get('name'))"

# ── Step 5: Start mILM container ─────────────────────────────────────────────
echo "Starting mILM container..."
curl -sf -X POST \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
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
  "$EDGE_BASE/mcm/v1/containers" | python3 -c "import sys,json; d=json.load(sys.stdin); print('mILM status:', d.get('status'))"

# ── Step 6: Load mKB image ───────────────────────────────────────────────────
echo "Loading mKB image..."
curl -sf -X POST \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "image=@$MKB_TAR;type=application/x-tar" \
  "$EDGE_BASE/mcm/v1/images" | python3 -c "import sys,json; d=json.load(sys.stdin); print('mKB image loaded:', d.get('name'))"

# ── Step 7: Start mKB container ──────────────────────────────────────────────
MILM_EMBED_URL="$EDGE_BASE/api/mim/v1/embeddings"

echo "Starting mKB container..."
curl -sf -X POST \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
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
  "$EDGE_BASE/mcm/v1/containers" | python3 -c "import sys,json; d=json.load(sys.stdin); print('mKB status:', d.get('status'))"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "All containers deployed successfully!"
echo ""
echo "mILM:   $EDGE_BASE/api/mim/v1"
echo "mKB:    $EDGE_BASE/api/mkb/v1"
echo "API Key: $MILM_API_KEY"
echo ""
echo "Next: download models"
echo "  export MILM_API_KEY=$MILM_API_KEY"
echo "  ./scripts/download-model.sh"
