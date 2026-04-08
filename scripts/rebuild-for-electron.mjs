#!/usr/bin/env node
/**
 * Rebuild native modules for Electron's Node.js runtime.
 *
 * Run AFTER install-server-deps.mjs and smoke-test-bundle.mjs.
 * The smoke test verifies the bundle works with system Node.
 * This step re-compiles native modules so they work with Electron's Node
 * when the server runs via ELECTRON_RUN_AS_NODE=1.
 *
 * Usage: node scripts/rebuild-for-electron.mjs
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverDir = path.resolve(root, "packages/desktop/resources/server");
const desktopDir = path.join(root, "packages/desktop");

// Read Electron version from desktop package.json
const desktopPkg = JSON.parse(
  fs.readFileSync(path.join(desktopDir, "package.json"), "utf8")
);
const electronVersion = desktopPkg.devDependencies.electron.replace(/[^0-9.]/g, "");

console.log(`Rebuilding native modules for Electron ${electronVersion}...`);

const rebuildBin = path.join(desktopDir, "node_modules", ".bin", "electron-rebuild");
if (!fs.existsSync(rebuildBin)) {
  console.error("electron-rebuild not found. Install @electron/rebuild as devDependency.");
  process.exit(1);
}

execSync(
  `"${rebuildBin}" --module-dir "${serverDir}" --electron-version ${electronVersion} --force`,
  {
    cwd: desktopDir,
    stdio: "inherit",
  }
);

console.log(`✓ Native modules rebuilt for Electron ${electronVersion}`);
