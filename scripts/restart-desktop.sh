#!/usr/bin/env bash
# Kill any running Edgebric desktop/electron processes, then restart in dev mode.
set -e

PROJ_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Stopping Edgebric..."

# Kill Electron processes (desktop app)
pkill -f "electron.*desktop" 2>/dev/null || true
pkill -f "electron-vite" 2>/dev/null || true

# Kill the API server if it was spawned by the desktop app
if [ -f "$HOME/Edgebric/edgebric.pid" ]; then
  PID=$(cat "$HOME/Edgebric/edgebric.pid" 2>/dev/null)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    echo "Killed API server (PID $PID)"
  fi
  rm -f "$HOME/Edgebric/edgebric.pid"
fi

# Kill any node process listening on port 3001 (the API server port)
lsof -ti:3001 2>/dev/null | xargs kill 2>/dev/null || true

# Brief pause for cleanup
sleep 1

echo "Starting Edgebric desktop..."
cd "$PROJ_ROOT/packages/desktop"
exec pnpm dev
