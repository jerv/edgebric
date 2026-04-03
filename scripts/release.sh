#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# release.sh — Bump version, commit, tag, and push to trigger a release build
#
# Usage:
#   ./scripts/release.sh 1.0.0
#
# What it does:
#   1. Validates the version string (semver)
#   2. Updates version in package.json and packages/desktop/package.json
#   3. Creates a commit: "release: v1.0.0"
#   4. Tags it: v1.0.0
#   5. Pushes the commit and tag (triggers .github/workflows/release.yml)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 1.0.0"
  exit 1
fi

# Validate semver format (loose: major.minor.patch with optional pre-release)
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
  echo "Error: Invalid version format '$VERSION'. Expected semver (e.g. 1.0.0, 1.0.0-beta.1)"
  exit 1
fi

TAG="v$VERSION"

# Ensure we're in the repo root (where package.json lives)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Check for clean working tree
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: Working tree is not clean. Commit or stash your changes first."
  exit 1
fi

# Check tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag $TAG already exists."
  exit 1
fi

echo "Releasing Edgebric $TAG"
echo ""

# Bump root package.json
echo "Updating package.json → $VERSION"
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" package.json

# Bump desktop package.json
echo "Updating packages/desktop/package.json → $VERSION"
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" packages/desktop/package.json

# Stage, commit, tag
git add package.json packages/desktop/package.json
git commit -m "release: $TAG"
git tag "$TAG"

echo ""
echo "Created commit and tag $TAG"
echo ""

# Push
BRANCH=$(git branch --show-current)
echo "Pushing $BRANCH + $TAG to origin..."
git push origin "$BRANCH" --tags

echo ""
echo "Done! The release workflow will build and publish $TAG."
echo "Watch progress: https://github.com/jerv/edgebric/actions"
