import type { Notification } from "@edgebric/types";
import { getDb } from "../db/index.js";
import { notifications } from "../db/schema.js";
import { eq, and, desc, isNull, count } from "drizzle-orm";
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

export function getNotificationsForUser(email: string, limit = 50): Notification[] {
  const db = getDb();
  const rows = db
    .select()
    .from(notifications)
    .where(eq(notifications.userEmail, email))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .all();
  return rows.map(rowToNotification);
}

export function getUnreadCountForUser(email: string): number {
  const db = getDb();
  const result = db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userEmail, email), isNull(notifications.readAt)))
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

export function getUnreadConversationIds(email: string): Set<string> {
  const db = getDb();
  const rows = db
    .select({ conversationId: notifications.conversationId })
    .from(notifications)
    .where(and(eq(notifications.userEmail, email), isNull(notifications.readAt)))
    .all();
  return new Set(rows.map((r) => r.conversationId));
}
