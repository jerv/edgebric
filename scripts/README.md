# Scripts

Helper scripts for development and releases.

## restart-desktop.sh
Rebuilds the web package and restarts the Electron desktop app. Run this after making UI changes.

## install.sh
One-line macOS installer. Downloads the latest DMG from GitHub Releases and installs Edgebric.app to /Applications. Supports `--version` flag for specific versions.

## release.sh
Version bumping and release automation. Updates version numbers across all packages and creates a tagged release commit.
