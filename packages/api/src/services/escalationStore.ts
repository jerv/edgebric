import type { Escalation } from "@edgebric/types";
import { getDb } from "../db/index.js";
import { escalations } from "../db/schema.js";
import { eq, desc, isNull, count, and } from "drizzle-orm";

/** Convert a DB row to an Escalation. */
function rowToEscalation(row: typeof escalations.$inferSelect): Escalation {
  const esc: Escalation = {
    id: row.id,
    createdAt: new Date(row.createdAt),
    question: row.question,
    aiAnswer: row.aiAnswer,
    sourceCitations: JSON.parse(row.sourceCitations),
    status: row.status as Escalation["status"],
    conversationId: row.conversationId ?? "",
    messageId: row.messageId ?? "",
    targetId: row.targetId ?? "",
    method: (row.method as Escalation["method"]) ?? "slack",
    readAt: row.readAt ? new Date(row.readAt) : null,
  };
  if (row.notifiedVia != null) esc.notifiedVia = row.notifiedVia as "slack" | "email";
  if (row.targetName != null) esc.targetName = row.targetName;
  if (row.readBy != null) esc.readBy = row.readBy;
  if (row.adminReply != null) esc.adminReply = row.adminReply;
  if (row.repliedAt != null) esc.repliedAt = new Date(row.repliedAt);
  if (row.repliedBy != null) esc.repliedBy = row.repliedBy;
  if (row.resolvedAt != null) esc.resolvedAt = new Date(row.resolvedAt);
  if (row.resolvedBy != null) esc.resolvedBy = row.resolvedBy;
  if (row.replyMessageId != null) esc.replyMessageId = row.replyMessageId;
  return esc;
}

export function addEscalation(esc: Escalation, orgId?: string): void {
  const db = getDb();
  db.insert(escalations)
    .values({
      id: esc.id,
      createdAt: esc.createdAt.toISOString(),
      question: esc.question,
      aiAnswer: esc.aiAnswer,
      sourceCitations: JSON.stringify(esc.sourceCitations),
      status: esc.status,
      notifiedVia: esc.notifiedVia ?? null,
      conversationId: esc.conversationId || null,
      messageId: esc.messageId || null,
      targetId: esc.targetId || null,
      targetName: esc.targetName ?? null,
      method: esc.method || null,
      orgId: orgId ?? null,
      readAt: null,
      readBy: null,
      adminReply: null,
      repliedAt: null,
      repliedBy: null,
      resolvedAt: null,
      resolvedBy: null,
      replyMessageId: null,
    })
    .run();
}

export function getEscalation(id: string): Escalation | undefined {
  const db = getDb();
  const row = db.select().from(escalations).where(eq(escalations.id, id)).get();
  return row ? rowToEscalation(row) : undefined;
}

export function listEscalations(orgId?: string): Escalation[] {
  const db = getDb();
  const conditions = orgId ? [eq(escalations.orgId, orgId)] : [];
  const query = conditions.length > 0
    ? db.select().from(escalations).where(and(...conditions))
    : db.select().from(escalations);
  const rows = query.orderBy(desc(escalations.createdAt)).all();
  return rows.map(rowToEscalation);
}

export function markRead(escalationId: string, adminEmail: string): Escalation | undefined {
  const db = getDb();
  const existing = db.select().from(escalations).where(eq(escalations.id, escalationId)).get();
  if (!existing) return undefined;

  db.update(escalations)
    .set({
      readAt: new Date().toISOString(),
      readBy: adminEmail,
    })
    .where(eq(escalations.id, escalationId))
    .run();

  return getEscalation(escalationId);
}

export function getUnreadCount(orgId?: string): number {
  const db = getDb();
  const conditions = [isNull(escalations.readAt)];
  if (orgId) conditions.push(eq(escalations.orgId, orgId));
  const result = db
    .select({ value: count() })
    .from(escalations)
    .where(and(...conditions))
    .get();
  return result?.value ?? 0;
}

export function replyToEscalation(
  id: string,
  adminEmail: string,
  replyText: string,
  replyMessageId: string,
): Escalation | undefined {
  const db = getDb();
  const now = new Date().toISOString();
  db.update(escalations)
    .set({
      adminReply: replyText,
      repliedAt: now,
      repliedBy: adminEmail,
      resolvedAt: now,
      resolvedBy: adminEmail,
      replyMessageId,
      status: "replied",
    })
    .where(eq(escalations.id, id))
    .run();
  return getEscalation(id);
}

export function resolveEscalation(
  id: string,
  adminEmail: string,
): Escalation | undefined {
  const db = getDb();
  db.update(escalations)
    .set({
      resolvedAt: new Date().toISOString(),
      resolvedBy: adminEmail,
      status: "resolved",
    })
    .where(eq(escalations.id, id))
    .run();
  return getEscalation(id);
}

export function unresolveEscalation(id: string): Escalation | undefined {
  const db = getDb();
  const existing = db.select().from(escalations).where(eq(escalations.id, id)).get();
  if (!existing) return undefined;

  // Revert to the delivery status (sent/failed/logged), unless it was replied
  const revertStatus = existing.adminReply ? "replied" : (existing.notifiedVia ? "sent" : "logged");
  db.update(escalations)
    .set({
      resolvedAt: null,
      resolvedBy: null,
      status: revertStatus,
    })
    .where(eq(escalations.id, id))
    .run();
  return getEscalation(id);
}

/** Check if a conversation has any escalations. */
export function conversationHasEscalations(conversationId: string): boolean {
  const db = getDb();
  const row = db
    .select({ value: count() })
    .from(escalations)
    .where(eq(escalations.conversationId, conversationId))
    .get();
  return (row?.value ?? 0) > 0;
}

/** Get conversation IDs that have escalations from a list of IDs. */
export function getConversationIdsWithEscalations(conversationIds: string[]): Set<string> {
  if (conversationIds.length === 0) return new Set();
  const db = getDb();
  const rows = db
    .select({ conversationId: escalations.conversationId })
    .from(escalations)
    .all();
  const allEscalated = new Set(rows.map((r) => r.conversationId).filter(Boolean) as string[]);
  return new Set(conversationIds.filter((id) => allEscalated.has(id)));
}

export function getEscalationsByConversation(conversationId: string): Escalation[] {
  const db = getDb();
  const rows = db
    .select()
    .from(escalations)
    .where(eq(escalations.conversationId, conversationId))
    .orderBy(desc(escalations.createdAt))
    .all();
  return rows.map(rowToEscalation);
}
