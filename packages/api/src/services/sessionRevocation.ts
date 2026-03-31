/**
 * Session revocation — invalidate all sessions for a given email.
 *
 * Sessions are stored as JSON files by session-file-store. To revoke,
 * we scan the session directory and delete files where the email matches.
 */
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

const sessionsDir = path.join(config.dataDir, "sessions");

/** Destroy all session files for a given email. Returns count of sessions destroyed. */
export function revokeSessionsByEmail(email: string): number {
  if (!fs.existsSync(sessionsDir)) return 0;

  const normalizedEmail = email.toLowerCase();
  let destroyed = 0;

  try {
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(sessionsDir, file), "utf8");
        const data = JSON.parse(content);
        if (data?.email?.toLowerCase() === normalizedEmail) {
          fs.unlinkSync(path.join(sessionsDir, file));
          destroyed++;
        }
      } catch {
        // Skip corrupted session files
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to scan sessions directory for revocation");
  }

  if (destroyed > 0) {
    logger.info({ email: normalizedEmail, destroyed }, "Revoked user sessions");
  }

  return destroyed;
}
