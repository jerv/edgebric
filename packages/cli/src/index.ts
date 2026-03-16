#!/usr/bin/env node
import { Command } from "commander";
import { setupCommand } from "./commands/setup.js";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { statusCommand } from "./commands/status.js";
import { logsCommand } from "./commands/logs.js";

const program = new Command();

program
  .name("edgebric")
  .description("Edgebric — Private AI knowledge platform")
  .version("0.0.1");

program
  .command("setup")
  .description("First-time setup wizard — configure OIDC, admin email, data directory")
  .action(setupCommand);

program
  .command("start")
  .description("Start the Edgebric server (backgrounded)")
  .option("-f, --foreground", "Run in the foreground (don't daemonize)")
  .action(startCommand);

program
  .command("stop")
  .description("Stop the running Edgebric server")
  .action(stopCommand);

program
  .command("status")
  .description("Show server status, port, and uptime")
  .action(statusCommand);

program
  .command("logs")
  .description("Tail the server logs")
  .option("-n, --lines <number>", "Number of lines to show", "50")
  .action(logsCommand);

program.parse();
