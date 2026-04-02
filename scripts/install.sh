#!/usr/bin/env bash
#
# Edgebric — one-line installer for macOS
#
# Usage:
#   curl -fsSL https://edgebric.com/install.sh | bash
#
#   Or with options:
#   curl -fsSL https://edgebric.com/install.sh | bash -s -- --dir ~/edgebric
#
# What this does:
#   1. Checks prerequisites (macOS, Apple Silicon, Node.js, pnpm)
#   2. Clones the repo
#   3. Installs dependencies
#   4. Builds the desktop app
#   5. Launches it
#
# What this does NOT do:
#   - Install Node.js or pnpm (tells you how if missing)
#   - Modify system files or require sudo
#   - Send any data anywhere

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────

REPO_URL="https://github.com/jerv/edgebric.git"
DEFAULT_DIR="$HOME/edgebric"
INSTALL_DIR="${1:-$DEFAULT_DIR}"
MIN_NODE_VERSION=20
MIN_PNPM_VERSION=10

# ─── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${BLUE}▸${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}!${NC} $1"; }
fail()  { echo -e "${RED}✗${NC} $1"; exit 1; }

# ─── Parse args ──────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: install.sh [--dir <path>]"
      echo "  --dir <path>  Install directory (default: ~/edgebric)"
      exit 0 ;;
    *) shift ;;
  esac
done

# ─── Banner ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}  Edgebric Installer${NC}"
echo -e "  Private knowledge platform — runs on your hardware"
echo ""

# ─── Check: macOS ────────────────────────────────────────────────────────────

if [[ "$(uname)" != "Darwin" ]]; then
  fail "Edgebric currently supports macOS only. Linux support coming soon."
fi
ok "macOS detected"

# ─── Check: Apple Silicon ────────────────────────────────────────────────────

ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  ok "Apple Silicon ($ARCH)"
elif [[ "$ARCH" == "x86_64" ]]; then
  warn "Intel Mac detected — Edgebric works but runs slower. Apple Silicon recommended."
else
  fail "Unsupported architecture: $ARCH"
fi

# ─── Check: Node.js ──────────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Install it first:\n  ${BOLD}brew install node${NC}\n  or visit https://nodejs.org"
fi

NODE_VERSION=$(node -v | sed 's/^v//' | cut -d. -f1)
if [[ "$NODE_VERSION" -lt "$MIN_NODE_VERSION" ]]; then
  fail "Node.js $MIN_NODE_VERSION+ required (found v$(node -v | sed 's/^v//')). Update with:\n  ${BOLD}brew upgrade node${NC}"
fi
ok "Node.js v$(node -v | sed 's/^v//')"

# ─── Check: pnpm ─────────────────────────────────────────────────────────────

if ! command -v pnpm &>/dev/null; then
  info "pnpm not found — installing..."
  npm install -g pnpm@latest || fail "Failed to install pnpm. Try:\n  ${BOLD}npm install -g pnpm${NC}"
fi

PNPM_VERSION=$(pnpm -v | cut -d. -f1)
if [[ "$PNPM_VERSION" -lt "$MIN_PNPM_VERSION" ]]; then
  info "Upgrading pnpm to v$MIN_PNPM_VERSION+..."
  npm install -g pnpm@latest || fail "Failed to upgrade pnpm"
fi
ok "pnpm v$(pnpm -v)"

# ─── Check: Python + docling ─────────────────────────────────────────────────

if command -v python3 &>/dev/null; then
  ok "Python $(python3 --version | cut -d' ' -f2)"
  if python3 -c "import docling" &>/dev/null; then
    ok "docling installed"
  else
    warn "docling not found — PDF extraction will be limited. Install with:\n  ${BOLD}pip3 install docling${NC}"
  fi
else
  warn "Python 3 not found — PDF extraction will be limited. Install with:\n  ${BOLD}brew install python${NC}"
fi

# ─── Check: git ───────────────────────────────────────────────────────────────

if ! command -v git &>/dev/null; then
  fail "git is not installed. Install with:\n  ${BOLD}xcode-select --install${NC}"
fi

# ─── Clone ────────────────────────────────────────────────────────────────────

echo ""
if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Existing installation found at $INSTALL_DIR — pulling latest..."
  cd "$INSTALL_DIR"
  git pull --ff-only || warn "Could not pull latest — continuing with existing code"
else
  info "Cloning Edgebric to $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR" || fail "Failed to clone repository"
  cd "$INSTALL_DIR"
fi
ok "Source code ready"

# ─── Install dependencies ────────────────────────────────────────────────────

echo ""
info "Installing dependencies (this may take a minute)..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install || fail "Failed to install dependencies"
ok "Dependencies installed"

# ─── Build ────────────────────────────────────────────────────────────────────

info "Building Edgebric..."
pnpm build || fail "Build failed"
ok "Build complete"

# ─── Launch ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}  Edgebric is ready!${NC}"
echo ""
echo -e "  Starting the desktop app..."
echo ""
echo -e "  ${BOLD}To start manually later:${NC}"
echo -e "    cd $INSTALL_DIR"
echo -e "    cd packages/desktop && pnpm dev"
echo ""
echo -e "  ${BOLD}To update:${NC}"
echo -e "    cd $INSTALL_DIR && git pull && pnpm install && pnpm build"
echo ""
echo -e "  ${BOLD}Like Edgebric?${NC} Consider sponsoring: https://github.com/sponsors/jerv"
echo ""

# Launch desktop app
cd packages/desktop
pnpm dev &
disown

echo -e "  Look for the Edgebric icon in your menu bar ↗"
echo ""
