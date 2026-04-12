#!/usr/bin/env bash
# Kill any running Edgebric desktop/electron processes, rebuild, then restart in
# a stable local mode that does not depend on the Vite renderer dev server.
set -e

PROJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${HOME}/Edgebric"
PID_FILE="${DATA_DIR}/edgebric.pid"

echo "Stopping Edgebric..."

# Kill Electron processes (desktop app)
pkill -f "electron.*desktop" 2>/dev/null || true
pkill -f "electron-vite" 2>/dev/null || true
pkill -f "Electron .*packages/desktop" 2>/dev/null || true
pkill -f "electron/cli\\.js .*packages/desktop" 2>/dev/null || true

# Kill the API server if it was spawned by the desktop app
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE" 2>/dev/null)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    echo "Killed API server (PID $PID)"
  fi
  rm -f "$PID_FILE"
fi

# Kill any node process listening on port 3001 (the API server port)
lsof -ti:3001 2>/dev/null | xargs kill 2>/dev/null || true

# Brief pause for cleanup
sleep 1

echo "Building Edgebric..."
cd "$PROJ_ROOT"
pnpm build

echo "Starting Edgebric desktop..."
cd "$PROJ_ROOT/packages/desktop"

# Clear dev-only renderer overrides so Electron always uses the built renderer.
unset ELECTRON_RUN_AS_NODE
unset ELECTRON_RENDERER_URL

ELECTRON_BIN="$(pnpm exec node -e "process.stdout.write(require('electron'))")"
nohup "$ELECTRON_BIN" "$PWD" >/tmp/edgebric-desktop-launch.log 2>&1 &
DESKTOP_PID=$!
echo "Started desktop process (PID $DESKTOP_PID)"

echo "Waiting for API server..."
for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:3001/api/query/status >/dev/null 2>&1; then
    echo "Edgebric restarted successfully."
    exit 0
  fi
  sleep 1
done

echo "Edgebric desktop launched, but the API did not become ready in time."
echo "Recent launch log:"
tail -n 60 /tmp/edgebric-desktop-launch.log 2>/dev/null || true
exit 1
