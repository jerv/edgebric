/**
 * Encrypted OAuth token storage for cloud connections.
 *
 * All access and refresh tokens are encrypted at rest using AES-256-GCM
 * (same master key as document encryption). Tokens are never stored in
 * plaintext and are only decrypted in-memory when needed for API calls.
 */
import { getDb } from "../db/index.js";
import { cloudOauthTokens } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { encryptText, decryptText } from "../lib/crypto.js";
import { getConnector } from "../connectors/registry.js";
import type { CloudProvider } from "@edgebric/types";
import { logger } from "../lib/logger.js";

interface StoredTokens {
  accessToken: string;
  refreshToken?: string | undefined;
  tokenType: string;
  expiresAt?: string | undefined;
  scopes?: string | undefined;
}

/** Save (or update) encrypted tokens for a connection. */
export function saveTokens(
  connectionId: string,
  tokens: {
    accessToken: string;
    refreshToken?: string | undefined;
    expiresAt?: string | undefined;
    scopes?: string | undefined;
  },
): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.insert(cloudOauthTokens)
    .values({
      connectionId,
      accessToken: encryptText(tokens.accessToken),
      refreshToken: tokens.refreshToken ? encryptText(tokens.refreshToken) : null,
      tokenType: "Bearer",
      expiresAt: tokens.expiresAt ?? null,
      scopes: tokens.scopes ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: cloudOauthTokens.connectionId,
      set: {
        accessToken: encryptText(tokens.accessToken),
        ...(tokens.refreshToken !== undefined && {
          refreshToken: tokens.refreshToken ? encryptText(tokens.refreshToken) : null,
        }),
        ...(tokens.expiresAt !== undefined && { expiresAt: tokens.expiresAt }),
        ...(tokens.scopes !== undefined && { scopes: tokens.scopes }),
        updatedAt: now,
      },
    })
    .run();
}

/** Get decrypted tokens for a connection. Returns undefined if not found. */
export function getTokens(connectionId: string): StoredTokens | undefined {
  const db = getDb();
  const row = db.select().from(cloudOauthTokens).where(eq(cloudOauthTokens.connectionId, connectionId)).get();
  if (!row) return undefined;

  return {
    accessToken: decryptText(row.accessToken),
    refreshToken: row.refreshToken ? decryptText(row.refreshToken) : undefined,
    tokenType: row.tokenType,
    expiresAt: row.expiresAt ?? undefined,
    scopes: row.scopes ?? undefined,
  };
}

/** Delete tokens for a connection. */
export function deleteTokens(connectionId: string): void {
  const db = getDb();
  db.delete(cloudOauthTokens).where(eq(cloudOauthTokens.connectionId, connectionId)).run();
}

/**
 * Get a valid access token for a connection, refreshing if expired.
 *
 * Returns the decrypted access token ready for API calls.
 * Throws if tokens are missing or refresh fails.
 */
export async function getValidAccessToken(connectionId: string, provider: CloudProvider): Promise<string> {
  const tokens = getTokens(connectionId);
  if (!tokens) throw new Error(`No OAuth tokens found for connection ${connectionId}`);

  // Check if token is still valid (with 5-minute buffer)
  if (tokens.expiresAt) {
    const expiresAt = new Date(tokens.expiresAt).getTime();
    const bufferMs = 5 * 60 * 1000;
    if (Date.now() < expiresAt - bufferMs) {
      return tokens.accessToken;
    }
  }

  // Token expired or no expiry info — try to refresh
  if (!tokens.refreshToken) {
    throw new Error(`Access token expired and no refresh token available for connection ${connectionId}`);
  }

  const connector = getConnector(provider);
  if (!connector) throw new Error(`No connector registered for provider: ${provider}`);

  logger.info({ connectionId, provider }, "Refreshing expired access token");
  const refreshed = await connector.refreshAccessToken(tokens.refreshToken);

  // Save the new tokens
  saveTokens(connectionId, {
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
  });

  return refreshed.accessToken;
}
