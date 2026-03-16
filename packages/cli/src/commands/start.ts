import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { loadConfig, pidPath, logPath, DEFAULT_DATA_DIR } from "../lib/paths.js";

export async function startCommand(opts: { foreground?: boolean }) {
  const config = loadConfig();
  if (!config) {
    console.log("  No configuration found. Run 'edgebric setup' first.");
    process.exit(1);
  }

  // Check if already running
  const pid = readPid(config.dataDir);
  if (pid && isProcessRunning(pid)) {
    console.log(`  Edgebric is already running (PID ${pid}).`);
    console.log(`  http://localhost:${config.port}`);
    return;
  }

  const envFile = path.join(config.dataDir, ".env");
  if (!fs.existsSync(envFile)) {
    console.log("  Environment file not found. Run 'edgebric setup' first.");
    process.exit(1);
  }

  // Find the API server entry point
  const serverPath = findServerPath();
  if (!serverPath) {
    console.log("  Could not find the Edgebric API server.");
    console.log("  Make sure you're running from the Edgebric installation directory,");
    console.log("  or that the @edgebric/api package is installed.");
    process.exit(1);
  }

  const logFile = logPath(config.dataDir);

  if (opts.foreground) {
    console.log(`  Starting Edgebric on http://localhost:${config.port} (foreground)...`);
    console.log();

    const child = spawn("node", ["--import=tsx/esm", serverPath], {
      stdio: "inherit",
      env: { ...process.env, DOTENV_CONFIG_PATH: envFile },
    });

    child.on("exit", (code) => {
      process.exit(code ?? 1);
    });
    return;
  }

  // Daemonize: spawn detached, redirect output to log file
  console.log(`  Starting Edgebric on http://localhost:${config.port}...`);

  const logFd = fs.openSync(logFile, "a");
  const child = spawn("node", ["--import=tsx/esm", serverPath], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, DOTENV_CONFIG_PATH: envFile },
  });

  child.unref();
  fs.closeSync(logFd);

  // Write PID file
  const pidFile = pidPath(config.dataDir);
  fs.writeFileSync(pidFile, String(child.pid), "utf8");

  console.log(`  Server started (PID ${child.pid}).`);
  console.log(`  Logs: ${logFile}`);
  console.log(`  Open http://localhost:${config.port} in your browser.`);
}

function findServerPath(): string | null {
  // Try common locations relative to CLI package
  const candidates = [
    // Monorepo development
    path.resolve(import.meta.dirname, "..", "..", "..", "api", "src", "server.ts"),
    // Installed via npm/Homebrew
    path.resolve(import.meta.dirname, "..", "..", "api", "dist", "server.js"),
    path.resolve(import.meta.dirname, "..", "api", "dist", "server.js"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readPid(dataDir: string): number | null {
  const p = pidPath(dataDir);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8").trim();
  const pid = parseInt(raw, 10);
  return isNaN(pid) ? null : pid;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
