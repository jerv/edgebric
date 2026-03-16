import { spawn } from "child_process";
import fs from "fs";
import { loadConfig, logPath } from "../lib/paths.js";

export async function logsCommand(opts: { lines?: string }) {
  const config = loadConfig();
  if (!config) {
    console.log("  No configuration found. Run 'edgebric setup' first.");
    process.exit(1);
  }

  const log = logPath(config.dataDir);
  if (!fs.existsSync(log)) {
    console.log("  No log file found. Start the server first with 'edgebric start'.");
    return;
  }

  const lines = opts.lines ?? "50";
  console.log(`  Tailing ${log} (last ${lines} lines, Ctrl+C to stop)\n`);

  const tail = spawn("tail", ["-n", lines, "-f", log], { stdio: "inherit" });
  tail.on("exit", (code) => process.exit(code ?? 0));
}
