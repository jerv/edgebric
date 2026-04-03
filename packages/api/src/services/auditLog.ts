/**
 * Immutable Audit Trail System
 *
 * Append-only, hash-chained audit log for regulated industries.
 * Each entry includes a SHA-256 hash of the previous entry, creating
 * a tamper-evident chain. If any entry is modified or deleted, the
 * chain breaks and verification fails.
 *
 * Tracked events:
 *   auth.login, auth.logout
 *   document.upload, document.delete, document.view, document.pii_approve, document.pii_reject
 *   query.execute
 *   data_source.create, data_source.archive, data_source.update, data_source.access_change
 *   user.invite, user.remove, user.permission_change
 *   group_chat.create, group_chat.archive, group_chat.member_add, group_chat.member_remove
 *   group_chat.data_source_share, group_chat.data_source_unshare
 *   admin.settings_change
 *   export.audit_log
 *
 * Export: CSV or JSON, filterable by date range, event type, and actor.
 */
import crypto from "crypto";
import { getDb } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { desc, and, gte, lte, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export type AuditEventType =
  | "auth.login"
  | "auth.logout"
  | "document.upload"
  | "document.delete"
  | "document.view"
  | "document.pii_approve"
  | "document.pii_reject"
  | "query.execute"
  | "data_source.create"
  | "data_source.archive"
  | "data_source.update"
  | "data_source.access_change"
  | "user.invite"
  | "user.remove"
  | "user.permission_change"
  | "group_chat.create"
  | "group_chat.archive"
  | "group_chat.member_add"
  | "group_chat.member_remove"
  | "group_chat.data_source_share"
  | "group_chat.data_source_unshare"
  | "admin.settings_change"
  | "export.audit_log"
  | "mesh.init"
  | "cloud_connection.create"
  | "cloud_connection.delete"
  | "cloud_connection.sync"
  | "cloud_connection.error"
  | "mesh.update"
  | "mesh.leave"
  | "mesh.token_regenerated"
  | "mesh.node_registered"
  | "mesh.node_updated"
  | "mesh.node_removed"
  | "mesh.group_created"
  | "mesh.group_updated"
  | "mesh.group_deleted"
  | "api.search"
  | "api.query"
  | "api.upload"
  | "api.delete"
  | "api.source_create"
  | "api.source_delete"
  | "api.key_created"
  | "api.key_revoked"
  | "api.auth_failure";

interface AuditEntry {
  id: string;
  timestamp: string;
  eventType: AuditEventType;
  actorEmail: string | null;
  actorIp: string | null;
  resourceType: string | null;
  resourceId: string | null;
  details: string | null;
  prevHash: string;
  hash: string;
}

/**
 * Compute the SHA-256 hash for an audit entry.
 * Includes all fields except the hash itself.
 */
function computeHash(entry: Omit<AuditEntry, "hash">): string {
  const payload = [
    entry.id,
    entry.timestamp,
    entry.eventType,
    entry.actorEmail ?? "",
    entry.actorIp ?? "",
    entry.resourceType ?? "",
    entry.resourceId ?? "",
    entry.details ?? "",
    entry.prevHash,
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * Get the hash of the most recent audit entry (for chaining).
 */
function getLastHash(): string {
  const db = getDb();
  const last = db
    .select({ hash: auditLog.hash })
    .from(auditLog)
    .orderBy(desc(auditLog.seq))
    .limit(1)
    .get();
  // Genesis hash — first entry in the chain
  return last?.hash ?? "0000000000000000000000000000000000000000000000000000000000000000";
}

/**
 * Record an audit event. Append-only — this function only inserts, never updates.
 */
export function recordAuditEvent(params: {
  eventType: AuditEventType;
  actorEmail?: string | undefined;
  actorIp?: string | undefined;
  resourceType?: string | undefined;
  resourceId?: string | undefined;
  details?: Record<string, unknown> | undefined;
}): void {
  try {
    const db = getDb();
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const prevHash = getLastHash();
    const detailsStr = params.details ? JSON.stringify(params.details) : null;

    const entry: Omit<AuditEntry, "hash"> = {
      id,
      timestamp,
      eventType: params.eventType,
      actorEmail: params.actorEmail ?? null,
      actorIp: params.actorIp ?? null,
      resourceType: params.resourceType ?? null,
      resourceId: params.resourceId ?? null,
      details: detailsStr,
      prevHash,
    };

    const hash = computeHash(entry);

    db.insert(auditLog)
      .values({
        id,
        timestamp,
        eventType: params.eventType,
        actorEmail: params.actorEmail ?? null,
        actorIp: params.actorIp ?? null,
        resourceType: params.resourceType ?? null,
        resourceId: params.resourceId ?? null,
        details: detailsStr,
        prevHash,
        hash,
      })
      .run();
  } catch (err) {
    // Audit logging should never crash the app
    logger.error({ err }, "Failed to record audit event");
  }
}

/**
 * Verify the integrity of the audit chain.
 * Returns { valid: true } if all hashes check out, or
 * { valid: false, brokenAt: seq } indicating where the chain breaks.
 */
export function verifyAuditChain(): { valid: boolean; brokenAt?: number; totalEntries: number } {
  const db = getDb();
  const rows = db
    .select()
    .from(auditLog)
    .orderBy(auditLog.seq)
    .all();

  if (rows.length === 0) return { valid: true, totalEntries: 0 };

  const genesisHash = "0000000000000000000000000000000000000000000000000000000000000000";

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const expectedPrevHash = i === 0 ? genesisHash : rows[i - 1]!.hash;

    // Check chain linkage
    if (row.prevHash !== expectedPrevHash) {
      return { valid: false, brokenAt: row.seq, totalEntries: rows.length };
    }

    // Recompute hash and verify
    const recomputed = computeHash({
      id: row.id,
      timestamp: row.timestamp,
      eventType: row.eventType as AuditEventType,
      actorEmail: row.actorEmail,
      actorIp: row.actorIp,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      details: row.details,
      prevHash: row.prevHash,
    });

    if (recomputed !== row.hash) {
      return { valid: false, brokenAt: row.seq, totalEntries: rows.length };
    }
  }

  return { valid: true, totalEntries: rows.length };
}

/**
 * Query audit log entries with optional filters.
 */
export function queryAuditLog(filters?: {
  startDate?: string | undefined;
  endDate?: string | undefined;
  eventType?: AuditEventType | undefined;
  actorEmail?: string | undefined;
  resourceType?: string | undefined;
  resourceId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}): { entries: AuditEntry[]; total: number } {
  const db = getDb();
  const conditions = [];

  if (filters?.startDate) conditions.push(gte(auditLog.timestamp, filters.startDate));
  if (filters?.endDate) conditions.push(lte(auditLog.timestamp, filters.endDate));
  if (filters?.eventType) conditions.push(eq(auditLog.eventType, filters.eventType));
  if (filters?.actorEmail) conditions.push(eq(auditLog.actorEmail, filters.actorEmail));
  if (filters?.resourceType) conditions.push(eq(auditLog.resourceType, filters.resourceType));
  if (filters?.resourceId) conditions.push(eq(auditLog.resourceId, filters.resourceId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const totalRow = db
    .select({ value: sql<number>`COUNT(*)` })
    .from(auditLog)
    .where(whereClause)
    .get();
  const total = totalRow?.value ?? 0;

  const limit = filters?.limit ?? 100;
  const offset = filters?.offset ?? 0;

  let query = db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.seq))
    .limit(limit)
    .offset(offset);

  if (whereClause) {
    query = query.where(whereClause) as typeof query;
  }

  const rows = query.all();

  return {
    entries: rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      eventType: row.eventType as AuditEventType,
      actorEmail: row.actorEmail,
      actorIp: row.actorIp,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      details: row.details,
      prevHash: row.prevHash,
      hash: row.hash,
    })),
    total,
  };
}

/**
 * Export audit log as CSV string.
 */
export function exportAuditLogCSV(filters?: {
  startDate?: string | undefined;
  endDate?: string | undefined;
  eventType?: AuditEventType | undefined;
  actorEmail?: string | undefined;
}): string {
  const { entries } = queryAuditLog({ ...filters, limit: 1_000_000 });

  const header = "timestamp,event_type,actor_email,actor_ip,resource_type,resource_id,details,hash";
  const rows = entries.map((e) => {
    const details = e.details ? `"${e.details.replace(/"/g, '""')}"` : "";
    return [
      e.timestamp,
      e.eventType,
      e.actorEmail ?? "",
      e.actorIp ?? "",
      e.resourceType ?? "",
      e.resourceId ?? "",
      details,
      e.hash,
    ].join(",");
  });

  return [header, ...rows].join("\n");
}

/**
 * Get audit log summary stats.
 */
export function getAuditStats(since?: string): Record<string, number> {
  const db = getDb();
  const condition = since ? gte(auditLog.timestamp, since) : undefined;

  const rows = db
    .select({
      eventType: auditLog.eventType,
      count: sql<number>`COUNT(*)`,
    })
    .from(auditLog)
    .where(condition)
    .groupBy(auditLog.eventType)
    .all();

  const stats: Record<string, number> = {};
  for (const row of rows) {
    stats[row.eventType] = row.count;
  }
  return stats;
}
