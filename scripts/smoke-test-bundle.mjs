#!/usr/bin/env node
/**
 * Smoke test for the bundled API server.
 *
 * Run AFTER bundle-server.mjs + install-server-deps.mjs to verify
 * the packaged server actually starts and responds.
 *
 * This catches:
 * - Missing modules (native or JS)
 * - Native module version mismatches
 * - Config/env loading failures
 * - Web frontend missing
 * - Import/require errors
 *
 * Usage: node scripts/smoke-test-bundle.mjs
 * Exit code: 0 = pass, 1 = fail
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverDir = path.join(root, "packages/desktop/resources/server");
const serverJs = path.join(serverDir, "server.js");
const webDist = path.join(root, "packages/desktop/resources/web/dist");

// ── Pre-flight checks ───────────────────────────────────────────────────────

const checks = [
  ["server.js exists", () => fs.existsSync(serverJs)],
  ["server/node_modules exists", () => fs.existsSync(path.join(serverDir, "node_modules"))],
  ["better-sqlite3 installed", () => fs.existsSync(path.join(serverDir, "node_modules/better-sqlite3"))],
  ["sharp installed", () => fs.existsSync(path.join(serverDir, "node_modules/sharp"))],
  ["sqlite-vec installed", () => fs.existsSync(path.join(serverDir, "node_modules/sqlite-vec"))],
  ["pino installed", () => fs.existsSync(path.join(serverDir, "node_modules/pino"))],
  ["pino-pretty installed", () => fs.existsSync(path.join(serverDir, "node_modules/pino-pretty"))],
  ["web/dist/index.html exists", () => fs.existsSync(path.join(webDist, "index.html"))],
  ["web/dist/assets exists", () => fs.existsSync(path.join(webDist, "assets"))],
];

console.log("=== Pre-flight checks ===\n");
let allPassed = true;
for (const [name, check] of checks) {
  const ok = check();
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) allPassed = false;
}

if (!allPassed) {
  console.error("\n✗ Pre-flight checks failed. Run bundle-server.mjs and install-server-deps.mjs first.");
  process.exit(1);
}

// ── Runtime test ────────────────────────────────────────────────────────────

console.log("\n=== Runtime test ===\n");

// Create a temporary data dir with a minimal .env
const tmpDir = path.join("/tmp", `edgebric-smoke-${crypto.randomBytes(4).toString("hex")}`);
fs.mkdirSync(tmpDir, { recursive: true });

const port = 19876; // Use a random high port to avoid conflicts
const envContent = [
  `DATA_DIR=${tmpDir}`,
  `PORT=${port}`,
  `SESSION_SECRET=${crypto.randomBytes(32).toString("hex")}`,
  `AUTH_MODE=none`,
  `LISTEN_HOST=127.0.0.1`,
  `FRONTEND_URL=http://localhost:${port}`,
  "",
].join("\n");

const envFile = path.join(tmpDir, ".env");
fs.writeFileSync(envFile, envContent);

// Use Electron as Node runtime so native modules (rebuilt for Electron) load correctly.
// Fall back to system node if electron binary isn't found (e.g. running outside the monorepo).
const electronBin = path.join(root, "packages/desktop/node_modules/.bin/electron");
const useElectron = fs.existsSync(electronBin);
const nodeBin = useElectron ? electronBin : "node";

if (useElectron) {
  console.log("  Using Electron as Node runtime for smoke test");
}

const server = spawn(nodeBin, [serverJs], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    ...(useElectron && { ELECTRON_RUN_AS_NODE: "1" }),
    DOTENV_CONFIG_PATH: envFile,
    SERVE_STATIC: "1",
    WEB_DIST_DIR: webDist,
  },
  cwd: serverDir,
});

let stdout = "";
let stderr = "";
server.stdout.on("data", (d) => { stdout += d.toString(); });
server.stderr.on("data", (d) => { stderr += d.toString(); });

// Wait for server to start, then test
const startTime = Date.now();
const timeout = 15000;
const pollInterval = 500;

async function waitForHealth() {
  while (Date.now() - startTime < timeout) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        const data = await resp.json();
        console.log(`  ✓ Health check passed: ${JSON.stringify(data)}`);
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }
  return false;
}

async function testFrontend() {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(2000),
    });
    if (resp.ok && resp.headers.get("content-type")?.includes("text/html")) {
      console.log("  ✓ Frontend serves HTML");
      return true;
    }
    console.error(`  ✗ Frontend returned ${resp.status}`);
    return false;
  } catch (err) {
    console.error(`  ✗ Frontend fetch failed: ${err.message}`);
    return false;
  }
}

server.on("exit", (code) => {
  if (code !== null && code !== 0 && Date.now() - startTime < timeout) {
    console.error(`  ✗ Server exited with code ${code}`);
    if (stderr) console.error(`  stderr: ${stderr.slice(0, 500)}`);
    if (stdout) console.error(`  stdout: ${stdout.slice(0, 500)}`);
    cleanup(1);
  }
});

function cleanup(exitCode) {
  server.kill("SIGTERM");
  setTimeout(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(exitCode);
  }, 1000);
}

const healthOk = await waitForHealth();
if (!healthOk) {
  console.error("  ✗ Server did not become healthy within 15s");
  if (stderr) console.error(`  stderr: ${stderr.slice(0, 1000)}`);
  if (stdout) console.error(`  stdout: ${stdout.slice(0, 1000)}`);
  cleanup(1);
} else {
  const frontendOk = await testFrontend();
  if (frontendOk) {
    console.log("\n✓ All smoke tests passed\n");
    cleanup(0);
  } else {
    cleanup(1);
  }
}
