#!/usr/bin/env node
/**
 * Install native dependencies for the bundled API server.
 *
 * The bundled server.js has all JS code inlined, but native modules
 * (better-sqlite3, sharp, sqlite-vec) need real node_modules with
 * compiled .node binaries.
 *
 * Native modules are compiled for Electron's Node.js runtime (not the
 * system Node) since the server runs via ELECTRON_RUN_AS_NODE=1.
 *
 * Usage: node scripts/install-server-deps.mjs
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverDir = path.resolve(root, "packages/desktop/resources/server");

// Read Electron version from desktop package.json
const desktopPkg = JSON.parse(
  fs.readFileSync(path.join(root, "packages/desktop/package.json"), "utf8")
);
const electronVersion = desktopPkg.devDependencies.electron.replace(/[^0-9.]/g, "");
console.log(`Electron version: ${electronVersion}`);

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
execSync("npm install --omit=dev --no-package-lock", {
  cwd: serverDir,
  stdio: "inherit",
});

// Rebuild native modules for Electron's Node.js runtime
console.log(`\nRebuilding native modules for Electron ${electronVersion}...`);
execSync(
  `npx @electron/rebuild --module-dir "${serverDir}" --electron-version ${electronVersion} --force`,
  {
    cwd: root,
    stdio: "inherit",
  }
);

console.log("✓ Native dependencies installed and rebuilt for Electron");
