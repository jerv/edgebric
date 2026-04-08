#!/usr/bin/env node
/**
 * Install native dependencies for the bundled API server.
 *
 * The bundled server.js has all JS code inlined, but native modules
 * (better-sqlite3, sharp, sqlite-vec) need real node_modules with
 * compiled .node binaries.
 *
 * This creates a minimal package.json in resources/server/ and runs
 * npm install to get just the native deps compiled for the system Node.
 *
 * Usage: node scripts/install-server-deps.mjs
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, "..", "packages/desktop/resources/server");

// Modules that can't be bundled — native addons + pino ecosystem
const nativeDeps = {
  "better-sqlite3": "^12.6.2",
  "sharp": "^0.34.5",
  "sqlite-vec": "^0.1.8",
  "pino": "^10.3.1",
  "pino-http": "^11.0.0",
  "pino-pretty": "^13.1.3",
};

// Create a minimal package.json for native deps
const pkg = {
  name: "edgebric-server-runtime",
  private: true,
  type: "module",
  dependencies: nativeDeps,
};

fs.writeFileSync(
  path.join(serverDir, "package.json"),
  JSON.stringify(pkg, null, 2) + "\n"
);

// Install with npm (not pnpm — we want a flat node_modules, no symlinks)
console.log("Installing native dependencies for bundled server...");
execSync("npm install --production --no-package-lock", {
  cwd: serverDir,
  stdio: "inherit",
});

console.log("✓ Native dependencies installed in resources/server/node_modules/");
