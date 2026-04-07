/**
 * Telegram Account Linking Service.
 *
 * Manages the pairing of Telegram user IDs to Edgebric user accounts.
 * In org mode, users generate a 6-digit link code from the Edgebric UI,
 * then send /link <code> to the bot.
 * In solo mode, linking is skipped — all messages go to the single user.
 */
import { randomInt } from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { telegramLinks, telegramLinkCodes } from "../db/schema.js";
import { config } from "../config.js";

const LINK_CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// ─── Link Code Management ──────────────────────────────────────────────────

/**
 * Generate a 6-digit link code for a user. Replaces any existing code for this user.
 * Returns the code string.
 */
export function generateLinkCode(userId: string): string {
  const db = getDb();
  const code = String(randomInt(100_000, 999_999)); // 6-digit code
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LINK_CODE_EXPIRY_MS);

  // Delete any existing codes for this user
  db.delete(telegramLinkCodes)
    .where(eq(telegramLinkCodes.userId, userId))
    .run();

  // Insert new code
  db.insert(telegramLinkCodes)
    .values({
      code,
      userId,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })
    .run();

  return code;
}

/**
 * Verify a link code and link the Telegram user to the Edgebric user.
 * Returns the Edgebric user ID on success, or an error message on failure.
 */
export function verifyLinkCode(
  telegramUserId: string,
  code: string,
  telegramUsername?: string,
): { success: true; userId: string } | { success: false; error: string } {
  const db = getDb();

  // Look up the code
  const row = db.select()
    .from(telegramLinkCodes)
    .where(eq(telegramLinkCodes.code, code.trim()))
    .get();

  if (!row) {
    return { success: false, error: "Invalid code. Please check the code and try again." };
  }

  // Check expiry
  if (new Date(row.expiresAt) < new Date()) {
    // Clean up expired code
    db.delete(telegramLinkCodes).where(eq(telegramLinkCodes.code, code)).run();
    return { success: false, error: "This code has expired. Please generate a new one from the Edgebric app." };
  }

  // Check if this Telegram user is already linked
  const existing = db.select()
    .from(telegramLinks)
    .where(eq(telegramLinks.telegramUserId, telegramUserId))
    .get();

  if (existing) {
    // Unlink the old account first
    db.delete(telegramLinks)
      .where(eq(telegramLinks.telegramUserId, telegramUserId))
      .run();
  }

  // Create the link
  db.insert(telegramLinks)
    .values({
      telegramUserId,
      edgebricUserId: row.userId,
      telegramUsername: telegramUsername ?? null,
      linkedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: telegramLinks.telegramUserId,
      set: {
        edgebricUserId: row.userId,
        telegramUsername: telegramUsername ?? null,
        linkedAt: new Date().toISOString(),
      },
    })
    .run();

  // Delete the used code
  db.delete(telegramLinkCodes).where(eq(telegramLinkCodes.code, code)).run();

  return { success: true, userId: row.userId };
}

// ─── Link Management ───────────────────────────────────────────────────────

/**
 * Get the Edgebric user ID linked to a Telegram user.
 */
export function getLinkedUserId(telegramUserId: string): string | null {
  const db = getDb();
  const row = db.select()
    .from(telegramLinks)
    .where(eq(telegramLinks.telegramUserId, telegramUserId))
    .get();
  return row?.edgebricUserId ?? null;
}

/**
 * Get the Telegram link info for an Edgebric user.
 */
export function getTelegramLink(edgebricUserId: string): {
  telegramUserId: string;
  telegramUsername: string | null;
  linkedAt: string;
} | null {
  const db = getDb();
  const row = db.select()
    .from(telegramLinks)
    .where(eq(telegramLinks.edgebricUserId, edgebricUserId))
    .get();
  if (!row) return null;
  return {
    telegramUserId: row.telegramUserId,
    telegramUsername: row.telegramUsername,
    linkedAt: row.linkedAt,
  };
}

/**
 * Unlink a Telegram account from an Edgebric user.
 */
export function unlinkTelegram(edgebricUserId: string): boolean {
  const db = getDb();
  const result = db.delete(telegramLinks)
    .where(eq(telegramLinks.edgebricUserId, edgebricUserId))
    .run();
  return result.changes > 0;
}

/**
 * Check if a Telegram user needs to be linked (only in org mode).
 * In solo mode, no linking is needed.
 */
export function requiresLinking(): boolean {
  return config.authMode !== "none";
}

/**
 * Clean up expired link codes. Called periodically.
 */
export function cleanupExpiredCodes(): void {
  const db = getDb();
  const now = new Date().toISOString();
  try {
    // Use raw SQL for < comparison since Drizzle's eq won't do it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).$client.prepare("DELETE FROM telegram_link_codes WHERE expires_at < ?").run(now);
  } catch {
    // Fallback — expired codes will be caught on verification
  }
}
