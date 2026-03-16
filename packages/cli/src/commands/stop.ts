import fs from "fs";
import { loadConfig, pidPath } from "../lib/paths.js";

export async function stopCommand() {
  const config = loadConfig();
  if (!config) {
    console.log("  No configuration found. Run 'edgebric setup' first.");
    process.exit(1);
  }

  const pidFile = pidPath(config.dataDir);
  if (!fs.existsSync(pidFile)) {
    console.log("  Edgebric is not running (no PID file found).");
    return;
  }

  const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
  if (isNaN(pid)) {
    console.log("  Invalid PID file. Cleaning up.");
    fs.unlinkSync(pidFile);
    return;
  }

  try {
    process.kill(pid, 0); // Check if running
  } catch {
    console.log("  Edgebric is not running (stale PID file). Cleaning up.");
    fs.unlinkSync(pidFile);
    return;
  }

  console.log(`  Stopping Edgebric (PID ${pid})...`);
  process.kill(pid, "SIGTERM");

  // Wait for graceful shutdown (up to 10s)
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    try {
      process.kill(pid, 0);
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      // Process exited
      break;
    }
  }

  // Clean up PID file
  try { fs.unlinkSync(pidFile); } catch { /* already gone */ }

  console.log("  Edgebric stopped.");
}
