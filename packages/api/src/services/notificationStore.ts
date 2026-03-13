import type { Notification } from "@edgebric/types";
import { getDb } from "../db/index.js";
import { notifications } from "../db/schema.js";
import { eq, and, desc, isNull, count, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

function rowToNotification(row: typeof notifications.$inferSelect): Notification {
  const n: Notification = {
    id: row.id,
    userEmail: row.userEmail,
    type: row.type as Notification["type"],
    conversationId: row.conversationId,
    title: row.title,
    createdAt: new Date(row.createdAt),
  };
  if (row.escalationId != null) n.escalationId = row.escalationId;
  if (row.messageId != null) n.messageId = row.messageId;
  if (row.body != null) n.body = row.body;
  if (row.readAt != null) n.readAt = new Date(row.readAt);
  return n;
}

/** Build org filter condition: notification's conversation must belong to the given org. */
function orgCondition(orgId: string) {
  return sql`${notifications.conversationId} IN (SELECT id FROM conversations WHERE org_id = ${orgId})`;
}

export function createNotification(opts: {
  userEmail: string;
  type: Notification["type"];
  conversationId: string;
  escalationId?: string;
  messageId?: string;
  title: string;
  body?: string;
}): Notification {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(notifications)
    .values({
      id,
      userEmail: opts.userEmail,
      type: opts.type,
      conversationId: opts.conversationId,
      escalationId: opts.escalationId ?? null,
      messageId: opts.messageId ?? null,
      title: opts.title,
      body: opts.body ?? null,
      readAt: null,
      createdAt: now,
    })
    .run();
  return rowToNotification(
    db.select().from(notifications).where(eq(notifications.id, id)).get()!,
  );
}

export function getNotificationsForUser(email: string, limit = 50, orgId?: string): Notification[] {
  const db = getDb();
  const conditions = [eq(notifications.userEmail, email)];
  if (orgId) conditions.push(orgCondition(orgId));

  const rows = db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .all();
  return rows.map(rowToNotification);
}

export function getUnreadCountForUser(email: string, orgId?: string): number {
  const db = getDb();
  const conditions = [eq(notifications.userEmail, email), isNull(notifications.readAt)];
  if (orgId) conditions.push(orgCondition(orgId));

  const result = db
    .select({ value: count() })
    .from(notifications)
    .where(and(...conditions))
    .get();
  return result?.value ?? 0;
}

export function markRead(id: string): void {
  const db = getDb();
  db.update(notifications)
    .set({ readAt: new Date().toISOString() })
    .where(eq(notifications.id, id))
    .run();
}

/** Mark a notification as read, but only if it belongs to the given user. */
export function markReadForUser(id: string, email: string): void {
  const db = getDb();
  db.update(notifications)
    .set({ readAt: new Date().toISOString() })
    .where(and(eq(notifications.id, id), eq(notifications.userEmail, email)))
    .run();
}

export function markReadForConversation(email: string, conversationId: string): void {
  const db = getDb();
  db.update(notifications)
    .set({ readAt: new Date().toISOString() })
    .where(
      and(
        eq(notifications.userEmail, email),
        eq(notifications.conversationId, conversationId),
        isNull(notifications.readAt),
      ),
    )
    .run();
}

export function getUnreadConversationIds(email: string, orgId?: string): Set<string> {
  const db = getDb();
  const conditions = [eq(notifications.userEmail, email), isNull(notifications.readAt)];
  if (orgId) conditions.push(orgCondition(orgId));

  const rows = db
    .select({ conversationId: notifications.conversationId })
    .from(notifications)
    .where(and(...conditions))
    .all();
  return new Set(rows.map((r) => r.conversationId));
}
