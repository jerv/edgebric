import type { Conversation, PersistedMessage, Citation, AnswerType } from "@edgebric/types";
import { getDb } from "../db/index.js";
import { conversations, messages } from "../db/schema.js";
import { eq, desc, asc, isNull, isNotNull, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { encryptText, decryptText } from "../lib/crypto.js";

function decryptContentSafe(content: string): string {
  try {
    return decryptText(content);
  } catch {
    return content; // legacy plaintext
  }
}

function rowToConversation(row: typeof conversations.$inferSelect): Conversation {
  const conv: Conversation = {
    id: row.id,
    userEmail: row.userEmail,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
  if (row.userName != null) conv.userName = row.userName;
  if (row.orgId != null) conv.orgId = row.orgId;
  if (row.archivedAt != null) conv.archivedAt = new Date(row.archivedAt);
  return conv;
}

function rowToMessage(row: typeof messages.$inferSelect): PersistedMessage {
  const msg: PersistedMessage = {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as "user" | "assistant",
    content: decryptContentSafe(row.content),
    createdAt: new Date(row.createdAt),
  };
  if (row.citations != null) msg.citations = JSON.parse(row.citations) as Citation[];
  if (row.hasConfidentAnswer != null) msg.hasConfidentAnswer = Boolean(row.hasConfidentAnswer);
  if (row.answerType != null) msg.answerType = row.answerType as AnswerType;
  if (row.source != null) msg.source = row.source as "ai" | "admin" | "system";
  return msg;
}

export function createConversation(userEmail: string, userName?: string, orgId?: string): Conversation {
  const db = getDb();
  const now = new Date().toISOString();
  const conv: Conversation = {
    id: randomUUID(),
    userEmail,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
  if (userName) conv.userName = userName;
  db.insert(conversations)
    .values({
      id: conv.id,
      userEmail,
      userName: userName ?? null,
      orgId: orgId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return conv;
}

export function getConversation(id: string): Conversation | undefined {
  const db = getDb();
  const row = db.select().from(conversations).where(eq(conversations.id, id)).get();
  return row ? rowToConversation(row) : undefined;
}

export function getConversationsByUser(email: string, orgId?: string): Conversation[] {
  const db = getDb();
  const conditions = [eq(conversations.userEmail, email)];
  if (orgId) conditions.push(eq(conversations.orgId, orgId));
  const rows = db
    .select()
    .from(conversations)
    .where(and(...conditions))
    .orderBy(desc(conversations.updatedAt))
    .all();
  return rows.map(rowToConversation);
}

export function addMessage(msg: PersistedMessage): void {
  const db = getDb();
  db.insert(messages)
    .values({
      id: msg.id,
      conversationId: msg.conversationId,
      role: msg.role,
      content: encryptText(msg.content),
      citations: msg.citations ? JSON.stringify(msg.citations) : null,
      hasConfidentAnswer: msg.hasConfidentAnswer != null ? (msg.hasConfidentAnswer ? 1 : 0) : null,
      answerType: msg.answerType ?? null,
      source: msg.source ?? null,
      createdAt: msg.createdAt.toISOString(),
    })
    .run();
}

export function getMessages(conversationId: string): PersistedMessage[] {
  const db = getDb();
  const rows = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .all();
  return rows.map(rowToMessage);
}

export function getMessage(id: string): PersistedMessage | undefined {
  const db = getDb();
  const row = db.select().from(messages).where(eq(messages.id, id)).get();
  return row ? rowToMessage(row) : undefined;
}

/** Get conversations for a user with a preview of the first user message. */
export function getConversationPreviews(
  email: string,
  orgId?: string,
): Array<Conversation & { preview?: string }> {
  const db = getDb();
  const conditions = [eq(conversations.userEmail, email), isNull(conversations.archivedAt)];
  if (orgId) conditions.push(eq(conversations.orgId, orgId));
  const convs = db
    .select()
    .from(conversations)
    .where(and(...conditions))
    .orderBy(desc(conversations.updatedAt))
    .all();

  return convs.map((row) => {
    const conv = rowToConversation(row);
    // Get the first user message as preview
    const firstMsg = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, row.id))
      .orderBy(asc(messages.createdAt))
      .limit(1)
      .get();
    const result: Conversation & { preview?: string } = { ...conv };
    const previewText = firstMsg?.content ? decryptContentSafe(firstMsg.content).slice(0, 100) : undefined;
    if (previewText && previewText.length > 0) result.preview = previewText;
    return result;
  });
}

/** Soft-delete: hides from sidebar but preserves data. Can be restored. */
export function archiveConversation(id: string): void {
  const db = getDb();
  db.update(conversations)
    .set({ archivedAt: new Date().toISOString() })
    .where(eq(conversations.id, id))
    .run();
}

/** Hard delete: removes conversation and all its messages permanently. */
export function deleteConversation(id: string): void {
  const db = getDb();
  db.delete(messages).where(eq(messages.conversationId, id)).run();
  db.delete(conversations).where(eq(conversations.id, id)).run();
}

/** Archive all conversations for a user in a specific org. Returns count. */
export function archiveAllConversations(email: string, orgId?: string): number {
  const db = getDb();
  const now = new Date().toISOString();
  const conditions = [eq(conversations.userEmail, email), isNull(conversations.archivedAt)];
  if (orgId) conditions.push(eq(conversations.orgId, orgId));
  const result = db
    .update(conversations)
    .set({ archivedAt: now })
    .where(and(...conditions))
    .run();
  return result.changes;
}

/** Hard delete all conversations (and their messages) for a user in a specific org. Returns count. */
export function deleteAllConversations(email: string, orgId?: string): number {
  const db = getDb();
  const conditions = [eq(conversations.userEmail, email)];
  if (orgId) conditions.push(eq(conversations.orgId, orgId));
  const userConvs = db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(...conditions))
    .all();
  for (const conv of userConvs) {
    db.delete(messages).where(eq(messages.conversationId, conv.id)).run();
  }
  let deleted = 0;
  for (const conv of userConvs) {
    db.delete(conversations).where(eq(conversations.id, conv.id)).run();
    deleted++;
  }
  return deleted;
}

/** Restore a previously archived conversation. */
export function unarchiveConversation(id: string): void {
  const db = getDb();
  db.update(conversations)
    .set({ archivedAt: null })
    .where(eq(conversations.id, id))
    .run();
}

/** Get archived conversations for a user with a preview of the first user message. */
export function getArchivedConversationPreviews(
  email: string,
  orgId?: string,
): Array<Conversation & { preview?: string }> {
  const db = getDb();
  const conditions = [eq(conversations.userEmail, email), isNotNull(conversations.archivedAt)];
  if (orgId) conditions.push(eq(conversations.orgId, orgId));
  const convs = db
    .select()
    .from(conversations)
    .where(and(...conditions))
    .orderBy(desc(conversations.updatedAt))
    .all();

  return convs.map((row) => {
    const conv = rowToConversation(row);
    const firstMsg = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, row.id))
      .orderBy(asc(messages.createdAt))
      .limit(1)
      .get();
    const result: Conversation & { preview?: string } = { ...conv };
    const previewText = firstMsg?.content ? decryptContentSafe(firstMsg.content).slice(0, 100) : undefined;
    if (previewText && previewText.length > 0) result.preview = previewText;
    return result;
  });
}

export function updateConversationTimestamp(id: string): void {
  const db = getDb();
  db.update(conversations)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(conversations.id, id))
    .run();
}
