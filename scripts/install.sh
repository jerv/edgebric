#!/usr/bin/env bash
#
# Edgebric — one-line installer for macOS
#
# Usage:
#   curl -fsSL https://edgebric.com/install.sh | bash
#
#   Install a specific version:
#   curl -fsSL https://edgebric.com/install.sh | bash -s -- --version v0.9.0
#
# What this does:
#   1. Detects your Mac's architecture (Apple Silicon or Intel)
#   2. Downloads the latest Edgebric DMG from GitHub Releases
#   3. Mounts it and copies Edgebric.app to /Applications
#   4. Cleans up
#
# What this does NOT do:
#   - Send any data anywhere
#   - Install anything outside /Applications
#   - Require Node.js, pnpm, or any dev tools

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────

GITHUB_REPO="jerv/edgebric"
GITHUB_API="https://api.github.com/repos/${GITHUB_REPO}/releases"
APP_NAME="Edgebric.app"
INSTALL_DIR="/Applications"
VERSION=""

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

# ─── Cleanup on exit ────────────────────────────────────────────────────────

TMPDIR_INSTALL=""
MOUNT_POINT=""

cleanup() {
  if [[ -n "$MOUNT_POINT" ]] && diskutil info "$MOUNT_POINT" &>/dev/null; then
    hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
  fi
  if [[ -n "$TMPDIR_INSTALL" ]] && [[ -d "$TMPDIR_INSTALL" ]]; then
    rm -rf "$TMPDIR_INSTALL"
  fi
}
trap cleanup EXIT

# ─── Parse args ──────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version|-v)
      if [[ $# -lt 2 ]]; then
        fail "--version requires a value (e.g., --version v0.9.0)"
      fi
      VERSION="$2"
      shift 2
      ;;
    --help|-h)
      echo ""
      echo "Edgebric Installer"
      echo ""
      echo "Downloads and installs Edgebric.app to /Applications."
      echo ""
      echo "Usage:"
      echo "  curl -fsSL https://edgebric.com/install.sh | bash"
      echo "  curl -fsSL https://edgebric.com/install.sh | bash -s -- [options]"
      echo ""
      echo "Options:"
      echo "  --version, -v <version>  Install a specific version (e.g., v0.9.0)"
      echo "  --help, -h               Show this help message"
      echo ""
      echo "Examples:"
      echo "  # Install latest version"
      echo "  curl -fsSL https://edgebric.com/install.sh | bash"
      echo ""
      echo "  # Install specific version"
      echo "  curl -fsSL https://edgebric.com/install.sh | bash -s -- --version v0.9.0"
      echo ""
      exit 0
      ;;
    *)
      fail "Unknown option: $1. Use --help for usage."
      ;;
  esac
done

# ─── Banner ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}  Edgebric Installer${NC}"
echo -e "  Private knowledge platform — runs on your hardware"
echo ""

# ─── Check: macOS ────────────────────────────────────────────────────────────

if [[ "$(uname)" != "Darwin" ]]; then
  echo ""
  echo -e "${RED}${BOLD}  Edgebric currently supports macOS only.${NC}"
  echo ""
  echo "  Linux and Windows support is planned. Follow progress at:"
  echo "  https://github.com/${GITHUB_REPO}/issues"
  echo ""
  exit 1
fi
ok "macOS detected"

# ─── Check: Architecture ────────────────────────────────────────────────────

ARCH="$(uname -m)"
DMG_SUFFIX=""

if [[ "$ARCH" == "arm64" ]]; then
  ok "Apple Silicon detected"
  DMG_SUFFIX="-arm64"
elif [[ "$ARCH" == "x86_64" ]]; then
  ok "Intel Mac detected"
  DMG_SUFFIX=""
else
  fail "Unsupported architecture: $ARCH. Edgebric requires Apple Silicon (arm64) or Intel (x86_64)."
fi

# ─── Check: curl ─────────────────────────────────────────────────────────────

if ! command -v curl &>/dev/null; then
  fail "curl is required but not found. It should be pre-installed on macOS."
fi

# ─── Find release ────────────────────────────────────────────────────────────

echo ""
if [[ -n "$VERSION" ]]; then
  # Ensure version starts with 'v'
  if [[ "$VERSION" != v* ]]; then
    VERSION="v${VERSION}"
  fi
  info "Fetching release ${VERSION}..."
  RELEASE_URL="${GITHUB_API}/tags/${VERSION}"
else
  info "Fetching latest release..."
  RELEASE_URL="${GITHUB_API}/latest"
fi

RELEASE_JSON=$(curl -fsSL "$RELEASE_URL" 2>/dev/null) || fail "Failed to fetch release info from GitHub. Check your internet connection."

# Parse version from tag_name
RELEASE_TAG=$(echo "$RELEASE_JSON" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"//;s/"//')
if [[ -z "$RELEASE_TAG" ]]; then
  fail "Could not determine release version. The GitHub API response may have changed."
fi

# Strip 'v' prefix for filename matching
RELEASE_VERSION="${RELEASE_TAG#v}"

ok "Found version ${RELEASE_TAG}"

# ─── Find DMG asset ──────────────────────────────────────────────────────────

# Expected filename: Edgebric-{version}-arm64.dmg (Apple Silicon) or Edgebric-{version}.dmg (Intel)
DMG_FILENAME="Edgebric-${RELEASE_VERSION}${DMG_SUFFIX}.dmg"

# Extract download URL for the matching asset
DMG_URL=$(echo "$RELEASE_JSON" | grep -o '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"//;s/"//' | grep "${DMG_FILENAME}" | head -1)

if [[ -z "$DMG_URL" ]]; then
  # List available assets for debugging
  AVAILABLE=$(echo "$RELEASE_JSON" | grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*\.dmg"' | sed 's/.*"name"[[:space:]]*:[[:space:]]*"//;s/"//' || echo "none found")
  fail "Could not find ${DMG_FILENAME} in release ${RELEASE_TAG}.\n  Available DMG files: ${AVAILABLE}\n  Your architecture: ${ARCH}"
fi

info "Downloading ${DMG_FILENAME}..."

# ─── Download DMG ────────────────────────────────────────────────────────────

TMPDIR_INSTALL=$(mktemp -d)
DMG_PATH="${TMPDIR_INSTALL}/${DMG_FILENAME}"

curl -fL --progress-bar -o "$DMG_PATH" "$DMG_URL" || fail "Download failed. Check your internet connection and try again."

if [[ ! -f "$DMG_PATH" ]] || [[ ! -s "$DMG_PATH" ]]; then
  fail "Downloaded file is missing or empty."
fi

ok "Download complete"

# ─── Mount DMG ───────────────────────────────────────────────────────────────

echo ""
info "Installing Edgebric..."

MOUNT_OUTPUT=$(hdiutil attach "$DMG_PATH" -nobrowse 2>&1) || fail "Failed to mount DMG:\n${MOUNT_OUTPUT}"

# Find the mount point
MOUNT_POINT=$(echo "$MOUNT_OUTPUT" | grep -o '/Volumes/.*' | head -1 | sed 's/[[:space:]]*$//')

if [[ -z "$MOUNT_POINT" ]] || [[ ! -d "$MOUNT_POINT" ]]; then
  fail "Could not find mount point after mounting DMG."
fi

# ─── Copy app to /Applications ───────────────────────────────────────────────

APP_SOURCE="${MOUNT_POINT}/${APP_NAME}"

if [[ ! -d "$APP_SOURCE" ]]; then
  fail "Could not find ${APP_NAME} in the mounted DMG."
fi

# Remove existing installation if present
if [[ -d "${INSTALL_DIR}/${APP_NAME}" ]]; then
  info "Removing previous installation..."
  if [[ -w "${INSTALL_DIR}/${APP_NAME}" ]]; then
    rm -rf "${INSTALL_DIR}/${APP_NAME}"
  else
    sudo rm -rf "${INSTALL_DIR}/${APP_NAME}" || fail "Failed to remove existing installation. Try running with sudo."
  fi
fi

# Copy new version
if [[ -w "$INSTALL_DIR" ]]; then
  cp -R "$APP_SOURCE" "$INSTALL_DIR/" || fail "Failed to copy ${APP_NAME} to ${INSTALL_DIR}."
else
  info "Need administrator access to install to /Applications..."
  sudo cp -R "$APP_SOURCE" "$INSTALL_DIR/" || fail "Failed to copy ${APP_NAME} to ${INSTALL_DIR}."
fi

ok "Installed to ${INSTALL_DIR}/${APP_NAME}"

# ─── Unmount DMG ─────────────────────────────────────────────────────────────

hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
MOUNT_POINT=""

# ─── Remove quarantine attribute ─────────────────────────────────────────────

xattr -dr com.apple.quarantine "${INSTALL_DIR}/${APP_NAME}" 2>/dev/null || true

# ─── Done ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}  Edgebric ${RELEASE_TAG} installed successfully!${NC}"
echo ""
echo -e "  ${BOLD}To launch:${NC}"
echo -e "    Open ${BOLD}Edgebric${NC} from Applications, or run:"
echo -e "    open /Applications/Edgebric.app"
echo ""
echo -e "  Edgebric runs in your ${BOLD}menu bar${NC} (top-right of your screen)."
echo -e "  Click the tray icon to open the web UI, manage models, and more."
echo ""
echo -e "  ${BOLD}To update later:${NC}"
echo -e "    Just run this installer again — it will replace the existing app."
echo ""
echo -e "  ${BOLD}Like Edgebric?${NC} Star us on GitHub: https://github.com/${GITHUB_REPO}"
echo ""
