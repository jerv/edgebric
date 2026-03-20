import type { Notification, GroupChatNotifLevel } from "@edgebric/types";
import { getDb } from "../db/index.js";
import { notifications, groupChatLastRead, groupChatNotifPrefs, users } from "../db/schema.js";
import { eq, and, desc, isNull, count, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { Response } from "express";

function rowToNotification(row: typeof notifications.$inferSelect): Notification {
  const n: Notification = {
    id: row.id,
    userEmail: row.userEmail,
    type: row.type as Notification["type"],
    conversationId: row.conversationId,
    title: row.title,
    createdAt: new Date(row.createdAt),
  };
  if (row.groupChatId != null) n.groupChatId = row.groupChatId;
  if (row.messageId != null) n.messageId = row.messageId;
  if (row.body != null) n.body = row.body;
  if (row.readAt != null) n.readAt = new Date(row.readAt);
  return n;
}

// ─── Global SSE (per-user notification stream) ──────────────────────────────

/** Map of userEmail → Set of connected SSE responses */
const globalClients = new Map<string, Set<Response>>();

export function addGlobalClient(email: string, res: Response): void {
  let set = globalClients.get(email);
  if (!set) {
    set = new Set();
    globalClients.set(email, set);
  }
  set.add(res);
}

export function removeGlobalClient(email: string, res: Response): void {
  const set = globalClients.get(email);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) globalClients.delete(email);
}

/** Send a real-time event to a specific user (all their connected tabs). */
export function broadcastToUser(email: string, event: string, data: unknown): void {
  const set = globalClients.get(email);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of set) {
    try {
      client.write(payload);
    } catch {
      set.delete(client);
    }
  }
}

/** Build org filter condition: notification's conversation or group chat must belong to the given org. */
function orgCondition(orgId: string) {
  return sql`(
    ${notifications.conversationId} IN (SELECT id FROM conversations WHERE org_id = ${orgId})
    OR ${notifications.groupChatId} IN (SELECT id FROM group_chats WHERE org_id = ${orgId})
  )`;
}

export function createNotification(opts: {
  userEmail: string;
  type: Notification["type"];
  conversationId: string;
  groupChatId?: string;
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
      groupChatId: opts.groupChatId ?? null,
      messageId: opts.messageId ?? null,
      title: opts.title,
      body: opts.body ?? null,
      readAt: null,
      createdAt: now,
    })
    .run();
  const notif = rowToNotification(
    db.select().from(notifications).where(eq(notifications.id, id)).get()!,
  );
  // Push to user in real time
  broadcastToUser(opts.userEmail, "notification", notif);
  return notif;
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

// ─── Group Chat Unread Tracking ─────────────────────────────────────────────

/** Update the last-read timestamp for a user in a group chat (called when they view it). */
export function markGroupChatRead(groupChatId: string, email: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.select().from(groupChatLastRead)
    .where(and(eq(groupChatLastRead.groupChatId, groupChatId), eq(groupChatLastRead.userEmail, email)))
    .get();
  if (existing) {
    db.update(groupChatLastRead)
      .set({ lastReadAt: now })
      .where(and(eq(groupChatLastRead.groupChatId, groupChatId), eq(groupChatLastRead.userEmail, email)))
      .run();
  } else {
    db.insert(groupChatLastRead).values({ groupChatId, userEmail: email, lastReadAt: now }).run();
  }
}

/** Get group chat IDs that have unread messages for a user. */
export function getUnreadGroupChatIds(email: string): Set<string> {
  const db = getDb();
  // Find group chats where the latest message is newer than the user's last read
  const rows = db.all(sql`
    SELECT DISTINCT gcm.group_chat_id
    FROM group_chat_messages gcm
    INNER JOIN group_chat_members mem ON mem.group_chat_id = gcm.group_chat_id AND mem.user_email = ${email}
    LEFT JOIN group_chat_last_read lr ON lr.group_chat_id = gcm.group_chat_id AND lr.user_email = ${email}
    WHERE gcm.role != 'system'
      AND gcm.thread_parent_id IS NULL
      AND (lr.last_read_at IS NULL OR gcm.created_at > lr.last_read_at)
      AND (gcm.author_email IS NULL OR gcm.author_email != ${email})
  `) as { group_chat_id: string }[];
  return new Set(rows.map((r) => r.group_chat_id));
}

// ─── Group Chat Notification Preferences ────────────────────────────────────

export function getGroupChatNotifLevel(groupChatId: string, email: string): GroupChatNotifLevel {
  const db = getDb();
  // Check per-chat preference first
  const row = db.select().from(groupChatNotifPrefs)
    .where(and(eq(groupChatNotifPrefs.groupChatId, groupChatId), eq(groupChatNotifPrefs.userEmail, email)))
    .get();
  if (row?.level) return row.level as GroupChatNotifLevel;

  // Fall back to user's default preference
  const userRow = db.select({ defaultLevel: users.defaultGroupChatNotifLevel })
    .from(users)
    .where(eq(users.email, email))
    .get();
  return (userRow?.defaultLevel as GroupChatNotifLevel) ?? "all";
}

export function setGroupChatNotifLevel(groupChatId: string, email: string, level: GroupChatNotifLevel): void {
  const db = getDb();
  const existing = db.select().from(groupChatNotifPrefs)
    .where(and(eq(groupChatNotifPrefs.groupChatId, groupChatId), eq(groupChatNotifPrefs.userEmail, email)))
    .get();
  if (existing) {
    db.update(groupChatNotifPrefs)
      .set({ level })
      .where(and(eq(groupChatNotifPrefs.groupChatId, groupChatId), eq(groupChatNotifPrefs.userEmail, email)))
      .run();
  } else {
    db.insert(groupChatNotifPrefs).values({ groupChatId, userEmail: email, level }).run();
  }
}

/** Get all notification preferences for a user's group chats. */
export function getAllGroupChatNotifLevels(email: string): Map<string, GroupChatNotifLevel> {
  const db = getDb();
  const rows = db.select().from(groupChatNotifPrefs)
    .where(eq(groupChatNotifPrefs.userEmail, email)).all();
  const map = new Map<string, GroupChatNotifLevel>();
  for (const r of rows) map.set(r.groupChatId, r.level as GroupChatNotifLevel);
  return map;
}
