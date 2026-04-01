/**
 * Persists the last loaded chat model tag so it can be auto-reloaded on restart.
 */
import path from "path";
import fs from "fs";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

const filePath = () => path.join(config.dataDir, "last-model.json");

export function saveLastModel(tag: string): void {
  try {
    fs.writeFileSync(filePath(), JSON.stringify({ tag }), "utf-8");
  } catch (err) {
    logger.warn({ err, tag }, "Failed to persist last model");
  }
}

export function getLastModel(): string | null {
  try {
    const raw = fs.readFileSync(filePath(), "utf-8");
    const data = JSON.parse(raw) as { tag?: string };
    return data.tag ?? null;
  } catch {
    return null;
  }
}

export function clearLastModel(): void {
  try {
    fs.unlinkSync(filePath());
  } catch {
    // File may not exist — that's fine
  }
}
