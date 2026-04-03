/**
 * API Key Store
 *
 * Manages API keys for agent/programmatic access.
 * Keys are stored as SHA-256 hashes — the raw key is shown once at creation, never stored.
 * Keys are prefixed with "eb_" for identification.
 */
import crypto from "crypto";
import { getDb } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

export interface ApiKey {
  id: string;
  name: string;
  orgId: string;
  permission: "read" | "read-write" | "admin";
  sourceScope: string; // "all" or JSON array of source IDs
  rateLimit: number;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

export interface ApiKeyWithRawKey extends ApiKey {
  rawKey: string;
}

function rowToApiKey(row: typeof apiKeys.$inferSelect): ApiKey {
  return {
    id: row.id,
    name: row.name,
    orgId: row.orgId,
    permission: row.permission as ApiKey["permission"],
    sourceScope: row.sourceScope,
    rateLimit: row.rateLimit,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revoked: row.revoked !== 0,
  };
}

/** Hash a raw API key with SHA-256. */
export function hashKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/** Generate a new raw API key: "eb_" + 32 random bytes base64url-encoded. */
function generateRawKey(): string {
  const bytes = crypto.randomBytes(32);
  return `eb_${bytes.toString("base64url")}`;
}

/** Create a new API key. Returns the key with the raw key (shown once). */
export function createApiKey(opts: {
  name: string;
  orgId: string;
  permission: "read" | "read-write" | "admin";
  sourceScope?: string;
  rateLimit?: number;
  createdBy: string;
}): ApiKeyWithRawKey {
  const db = getDb();
  const id = crypto.randomUUID();
  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const now = new Date().toISOString();

  db.insert(apiKeys)
    .values({
      id,
      name: opts.name,
      keyHash,
      orgId: opts.orgId,
      permission: opts.permission,
      sourceScope: opts.sourceScope ?? "all",
      rateLimit: opts.rateLimit ?? 300,
      createdBy: opts.createdBy,
      createdAt: now,
      revoked: 0,
    })
    .run();

  const key = getApiKey(id)!;
  return { ...key, rawKey };
}

/** Get a single API key by ID. */
export function getApiKey(id: string): ApiKey | undefined {
  const db = getDb();
  const row = db.select().from(apiKeys).where(eq(apiKeys.id, id)).get();
  return row ? rowToApiKey(row) : undefined;
}

/** Look up an API key by its hash. Returns undefined if not found or revoked. */
export function getApiKeyByHash(keyHash: string): ApiKey | undefined {
  const db = getDb();
  const row = db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.revoked, 0)))
    .get();
  return row ? rowToApiKey(row) : undefined;
}

/** List all API keys for an org (never returns hashes). */
export function listApiKeys(orgId: string): ApiKey[] {
  const db = getDb();
  const rows = db.select().from(apiKeys).where(eq(apiKeys.orgId, orgId)).all();
  return rows.map(rowToApiKey);
}

/** Revoke an API key (set revoked=1). */
export function revokeApiKey(id: string): boolean {
  const db = getDb();
  const result = db
    .update(apiKeys)
    .set({ revoked: 1 })
    .where(eq(apiKeys.id, id))
    .run();
  return result.changes > 0;
}

/** Update the lastUsedAt timestamp for a key. */
export function touchApiKey(id: string): void {
  const db = getDb();
  db.update(apiKeys)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(apiKeys.id, id))
    .run();
}

/** Get the parsed source scope as an array of IDs, or null for "all". */
export function parseScopeIds(sourceScope: string): string[] | null {
  if (sourceScope === "all") return null;
  try {
    const parsed = JSON.parse(sourceScope);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch { /* invalid JSON treated as "all" */ }
  return null;
}
