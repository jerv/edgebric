import fs from "fs";
import { loadConfig, pidPath } from "../lib/paths.js";

export async function statusCommand() {
  const config = loadConfig();
  if (!config) {
    console.log("  Edgebric is not configured. Run 'edgebric setup' first.");
    return;
  }

  const pidFile = pidPath(config.dataDir);
  let running = false;
  let pid: number | null = null;

  if (fs.existsSync(pidFile)) {
    pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0);
        running = true;
      } catch {
        // Stale PID file
        pid = null;
      }
    }
  }

  console.log();
  console.log(`  Status:    ${running ? "Running" : "Stopped"}`);
  if (running && pid) {
    console.log(`  PID:       ${pid}`);
  }
  console.log(`  Port:      ${config.port}`);
  console.log(`  Data dir:  ${config.dataDir}`);
  console.log(`  Admin(s):  ${config.adminEmails.join(", ")}`);

  if (running) {
    console.log(`  URL:       http://localhost:${config.port}`);

    // Try to fetch health
    try {
      const resp = await fetch(`http://localhost:${config.port}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      const data = await resp.json() as { status: string };
      console.log(`  Health:    ${data.status}`);
    } catch {
      console.log("  Health:    unreachable");
    }
  }

  console.log();
}
