#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# release.sh — Cut a release following the dev → PR → main → tag flow
#
# Usage:
#   ./scripts/release.sh 1.0.0
#
# What it does:
#   1. Validates version string and checks prerequisites
#   2. Syncs dev with origin, bumps version in package.json files
#   3. Commits the version bump to dev, pushes
#   4. Creates a PR from dev → main
#   5. Waits for required CI checks to pass
#   6. Merges the PR (via API to avoid non-required check issues)
#   7. Tags main, pushes the tag (triggers release.yml workflow)
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

# Ensure we're in the repo root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ── Prerequisites ──────────────────────────────────────────────────────────

# Must be on dev
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "dev" ]; then
  echo "Error: Must be on 'dev' branch (currently on '$BRANCH')."
  echo "Run: git checkout dev"
  exit 1
fi

# Clean working tree
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: Working tree is not clean. Commit or stash your changes first."
  exit 1
fi

# Tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag $TAG already exists."
  exit 1
fi

# gh CLI available
if ! command -v gh &>/dev/null; then
  echo "Error: GitHub CLI (gh) is required. Install: https://cli.github.com"
  exit 1
fi

echo "==> Releasing Edgebric $TAG"
echo ""

# ── Step 1: Sync ──────────────────────────────────────────────────────────

echo "==> Syncing dev with origin..."
git pull origin dev --ff-only

echo "==> Syncing main with origin..."
git fetch origin main

# ── Step 2: Bump version ─────────────────────────────────────────────────

echo "==> Bumping version → $VERSION"
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" package.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" packages/desktop/package.json

git add package.json packages/desktop/package.json
git commit -m "release: $TAG"

# ── Step 3: Push dev ─────────────────────────────────────────────────────

echo "==> Pushing dev..."
git push origin dev

# ── Step 4: Create PR ────────────────────────────────────────────────────

echo "==> Creating PR: dev → main"
PR_URL=$(gh pr create --base main --head dev \
  --title "Release $TAG" \
  --body "Version bump and release for $TAG.")

PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$')
echo "    PR #$PR_NUMBER: $PR_URL"

# ── Step 5: Wait for required checks ────────────────────────────────────

echo "==> Waiting for CI checks..."
echo "    (Required: 'Lint + Typecheck + Test' and 'Build')"

# Poll until required checks pass (timeout after 10 minutes)
TIMEOUT=600
ELAPSED=0
INTERVAL=15

while [ $ELAPSED -lt $TIMEOUT ]; do
  CHECK_OUTPUT=$(gh pr checks "$PR_NUMBER" 2>&1 || true)

  LINT_PASS=$(echo "$CHECK_OUTPUT" | grep "Lint + Typecheck + Test" | grep -c "pass" || true)
  BUILD_PASS=$(echo "$CHECK_OUTPUT" | grep "^Build" | grep -c "pass" || true)

  if [ "$LINT_PASS" -ge 1 ] && [ "$BUILD_PASS" -ge 1 ]; then
    echo "    All required checks passed!"
    break
  fi

  # Fail fast on required check failures
  LINT_FAIL=$(echo "$CHECK_OUTPUT" | grep "Lint + Typecheck + Test" | grep -c "fail" || true)
  BUILD_FAIL=$(echo "$CHECK_OUTPUT" | grep "^Build" | grep -c "fail" || true)

  if [ "$LINT_FAIL" -gt 0 ] || [ "$BUILD_FAIL" -gt 0 ]; then
    echo "Error: Required CI check failed. Check: $PR_URL"
    echo "$CHECK_OUTPUT"
    exit 1
  fi

  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
  echo "    Waiting... (${ELAPSED}s / ${TIMEOUT}s)"
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  echo "Error: Timed out waiting for CI checks after ${TIMEOUT}s."
  echo "Check manually: $PR_URL"
  exit 1
fi

# ── Step 6: Merge PR ─────────────────────────────────────────────────────

echo "==> Merging PR #$PR_NUMBER..."
# Use the API directly — `gh pr merge` treats non-required check failures
# (like CLA on owner PRs) as blocking. The API respects the actual ruleset.
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
MERGE_RESULT=$(gh api "repos/$REPO/pulls/$PR_NUMBER/merge" \
  -X PUT -f merge_method=merge 2>&1)

if echo "$MERGE_RESULT" | grep -q '"merged":true'; then
  echo "    PR merged successfully."
else
  echo "Error: Failed to merge PR."
  echo "$MERGE_RESULT"
  exit 1
fi

# ── Step 7: Tag and push ─────────────────────────────────────────────────

echo "==> Tagging main as $TAG..."
git checkout main
git pull origin main --ff-only
git tag "$TAG"
git push origin "$TAG"

# Switch back to dev
git checkout dev

echo ""
echo "==> Done! Release $TAG is live."
echo "    Watch the build: https://github.com/jerv/edgebric/actions"
echo "    Release page:    https://github.com/jerv/edgebric/releases/tag/$TAG"
