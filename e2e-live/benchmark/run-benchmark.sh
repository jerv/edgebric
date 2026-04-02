#!/bin/bash
# Benchmark runner — handles API lifecycle automatically.
#
# Usage:
#   ./e2e-live/benchmark/run-benchmark.sh
#   ./e2e-live/benchmark/run-benchmark.sh qwen3:4b,phi4-mini
#
# This script:
# 1. Kills any existing API/Electron on port 3001
# 2. Starts a standalone API in solo mode (no auth, no CSRF, no rate limit)
# 3. Runs the benchmark for all specified models
# 4. Saves results incrementally (safe to Ctrl+C — partial results preserved)
# 5. Starts the grading UI on port 3099

set -euo pipefail
cd "$(dirname "$0")/../.."

MODELS="${1:-qwen3:4b,qwen3:8b,qwen3:14b,phi4-mini,gemma3:4b,gemma3:12b}"

echo "=== Edgebric Benchmark Runner ==="
echo "Models: $MODELS"
echo ""

# 1. Kill anything on port 3001
echo "Stopping existing API/Electron..."
lsof -ti:3001 | xargs kill 2>/dev/null || true
sleep 2

# 2. Start standalone API
echo "Starting API server (solo mode)..."
SKIP_RATE_LIMIT=1 SKIP_CSRF=1 AUTH_MODE=none pnpm --filter api dev &>/tmp/edgebric-benchmark-api.log &
API_PID=$!

# Wait for API
for i in $(seq 1 30); do
  if curl -s http://localhost:3001/api/health >/dev/null 2>&1; then
    echo "API ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: API failed to start. Check /tmp/edgebric-benchmark-api.log"
    exit 1
  fi
  sleep 1
done

# 3. Verify inference server is reachable
echo "Checking inference server..."
if ! curl -s http://localhost:8080/health >/dev/null 2>&1; then
  echo "WARNING: Chat inference server not reachable on port 8080."
fi
sleep 1

# 4. Run benchmark
echo ""
echo "Starting benchmark..."
echo "Results will be saved incrementally — safe to Ctrl+C."
echo ""

pnpm --filter api exec tsx ../../e2e-live/benchmark/run.ts --models="$MODELS" --skip-pull

# 5. Kill the standalone API
echo ""
echo "Stopping benchmark API server..."
kill $API_PID 2>/dev/null || true

# 6. Start grading UI
echo ""
echo "Starting grading UI on http://localhost:3099 ..."
echo "(Press Ctrl+C to stop)"
pnpm --filter api exec tsx ../../e2e-live/benchmark/serve-grader.ts
