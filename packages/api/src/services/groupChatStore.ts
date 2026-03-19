import { randomUUID } from "crypto";
import { eq, and, desc, asc, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import {
  groupChats,
  groupChatMembers,
  groupChatSharedKBs,
  groupChatMessages,
  knowledgeBases,
  users,
} from "../db/schema.js";
import type {
  GroupChat,
  GroupChatMember,
  GroupChatSharedKB,
  GroupChatMessage,
  GroupChatExpiration,
  Citation,
} from "@edgebric/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function expirationToDate(expiration: GroupChatExpiration): string | null {
  const now = Date.now();
  switch (expiration) {
    case "24h": return new Date(now + 24 * 60 * 60 * 1000).toISOString();
    case "1w": return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    case "1m": return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
    case "never": return null;
  }
}

function rowToMember(row: typeof groupChatMembers.$inferSelect): GroupChatMember {
  const member: GroupChatMember = {
    userEmail: row.userEmail,
    role: row.role as GroupChatMember["role"],
    joinedAt: new Date(row.joinedAt),
  };
  if (row.userName != null) member.userName = row.userName;
  return member;
}

function rowToSharedKB(
  row: typeof groupChatSharedKBs.$inferSelect,
  kbName?: string,
  sharerName?: string,
): GroupChatSharedKB {
  const kb: GroupChatSharedKB = {
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    knowledgeBaseName: kbName ?? "Unknown KB",
    sharedByEmail: row.sharedByEmail,
    allowSourceViewing: !!row.allowSourceViewing,
    sharedAt: new Date(row.sharedAt),
  };
  if (sharerName) kb.sharedByName = sharerName;
  return kb;
}

function rowToMessage(row: typeof groupChatMessages.$inferSelect): GroupChatMessage {
  const msg: GroupChatMessage = {
    id: row.id,
    groupChatId: row.groupChatId,
    role: row.role as GroupChatMessage["role"],
    content: row.content,
    createdAt: new Date(row.createdAt),
  };
  if (row.threadParentId) msg.threadParentId = row.threadParentId;
  if (row.authorEmail) msg.authorEmail = row.authorEmail;
  if (row.authorName) msg.authorName = row.authorName;
  if (row.citations) msg.citations = JSON.parse(row.citations) as Citation[];
  if (row.hasConfidentAnswer != null) msg.hasConfidentAnswer = !!row.hasConfidentAnswer;
  return msg;
}

// ─── Group Chat CRUD ─────────────────────────────────────────────────────────

export function createGroupChat(data: {
  name: string;
  creatorEmail: string;
  creatorName?: string;
  orgId: string;
  expiration: GroupChatExpiration;
}): GroupChat {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const expiresAt = expirationToDate(data.expiration);

  db.insert(groupChats).values({
    id,
    name: data.name,
    creatorEmail: data.creatorEmail,
    orgId: data.orgId,
    expiresAt,
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();

  // Creator is automatically a member
  db.insert(groupChatMembers).values({
    groupChatId: id,
    userEmail: data.creatorEmail,
    userName: data.creatorName ?? null,
    role: "creator",
    joinedAt: now,
  }).run();

  // System message
  addSystemMessage(id, `${data.creatorName ?? data.creatorEmail} created this group chat.`);

  return getGroupChat(id)!;
}

export function getGroupChat(id: string): GroupChat | undefined {
  const db = getDb();
  const row = db.select().from(groupChats).where(eq(groupChats.id, id)).get();
  if (!row) return undefined;
  return enrichGroupChat(row);
}

export function listGroupChatsForUser(email: string, orgId: string): GroupChat[] {
  const db = getDb();

  // Get all group chat IDs where user is a member
  const memberRows = db.select({ groupChatId: groupChatMembers.groupChatId })
    .from(groupChatMembers)
    .where(eq(groupChatMembers.userEmail, email.toLowerCase()))
    .all();

  const chatIds = memberRows.map((r) => r.groupChatId);
  if (chatIds.length === 0) return [];

  // Fetch the chats, filter by org, order by updatedAt desc
  const rows = db.select().from(groupChats)
    .where(eq(groupChats.orgId, orgId))
    .orderBy(desc(groupChats.updatedAt))
    .all()
    .filter((r) => chatIds.includes(r.id));

  return rows.map((r) => enrichGroupChat(r));
}

export function updateGroupChat(
  id: string,
  updates: { name?: string; expiration?: GroupChatExpiration },
): GroupChat | undefined {
  const db = getDb();
  const existing = db.select().from(groupChats).where(eq(groupChats.id, id)).get();
  if (!existing) return undefined;

  const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (updates.name) set.name = updates.name;
  if (updates.expiration) {
    const newExpiry = expirationToDate(updates.expiration);
    // Can only shorten expiration, never extend
    if (existing.expiresAt && newExpiry) {
      if (new Date(newExpiry) < new Date(existing.expiresAt)) {
        set.expiresAt = newExpiry;
      }
    } else if (existing.expiresAt === null) {
      // Currently "never" — can set any expiration
      set.expiresAt = newExpiry;
    }
  }

  db.update(groupChats).set(set).where(eq(groupChats.id, id)).run();
  return getGroupChat(id);
}

export function archiveGroupChat(id: string): void {
  const db = getDb();
  db.update(groupChats)
    .set({ status: "archived", updatedAt: new Date().toISOString() })
    .where(eq(groupChats.id, id))
    .run();
  addSystemMessage(id, "This group chat has been archived.");
}

// ─── Members ─────────────────────────────────────────────────────────────────

export function addMember(groupChatId: string, email: string, name?: string): GroupChatMember {
  const db = getDb();
  const now = new Date().toISOString();

  db.insert(groupChatMembers).values({
    groupChatId,
    userEmail: email.toLowerCase(),
    userName: name ?? null,
    role: "member",
    joinedAt: now,
  }).run();

  // Update chat timestamp
  db.update(groupChats)
    .set({ updatedAt: now })
    .where(eq(groupChats.id, groupChatId))
    .run();

  addSystemMessage(groupChatId, `${name ?? email} joined the group chat.`);

  const member: GroupChatMember = { userEmail: email.toLowerCase(), role: "member", joinedAt: new Date(now) };
  if (name) member.userName = name;
  return member;
}

export function removeMember(groupChatId: string, email: string): void {
  const db = getDb();

  // Get name for system message before deleting
  const member = db.select().from(groupChatMembers)
    .where(and(eq(groupChatMembers.groupChatId, groupChatId), eq(groupChatMembers.userEmail, email.toLowerCase())))
    .get();

  db.delete(groupChatMembers)
    .where(and(eq(groupChatMembers.groupChatId, groupChatId), eq(groupChatMembers.userEmail, email.toLowerCase())))
    .run();

  const displayName = member?.userName ?? email;
  addSystemMessage(groupChatId, `${displayName} left the group chat.`);

  db.update(groupChats)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(groupChats.id, groupChatId))
    .run();
}

export function isMember(groupChatId: string, email: string): boolean {
  const db = getDb();
  const row = db.select().from(groupChatMembers)
    .where(and(eq(groupChatMembers.groupChatId, groupChatId), eq(groupChatMembers.userEmail, email.toLowerCase())))
    .get();
  return !!row;
}

export function isCreator(groupChatId: string, email: string): boolean {
  const db = getDb();
  const row = db.select().from(groupChatMembers)
    .where(and(
      eq(groupChatMembers.groupChatId, groupChatId),
      eq(groupChatMembers.userEmail, email.toLowerCase()),
      eq(groupChatMembers.role, "creator"),
    ))
    .get();
  return !!row;
}

export function getMembers(groupChatId: string): GroupChatMember[] {
  const db = getDb();
  const rows = db.select().from(groupChatMembers)
    .where(eq(groupChatMembers.groupChatId, groupChatId))
    .all();
  return rows.map(rowToMember);
}

// ─── Shared KBs ─────────────────────────────────────────────────────────────

export function shareKB(data: {
  groupChatId: string;
  knowledgeBaseId: string;
  sharedByEmail: string;
  sharedByName?: string;
  allowSourceViewing: boolean;
}): GroupChatSharedKB {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.insert(groupChatSharedKBs).values({
    id,
    groupChatId: data.groupChatId,
    knowledgeBaseId: data.knowledgeBaseId,
    sharedByEmail: data.sharedByEmail,
    allowSourceViewing: data.allowSourceViewing ? 1 : 0,
    sharedAt: now,
  }).run();

  // Get KB name for system message
  const kb = db.select().from(knowledgeBases).where(eq(knowledgeBases.id, data.knowledgeBaseId)).get();
  const kbName = kb?.name ?? "a source";
  addSystemMessage(data.groupChatId, `${data.sharedByName ?? data.sharedByEmail} shared "${kbName}" with the group.`);

  db.update(groupChats)
    .set({ updatedAt: now })
    .where(eq(groupChats.id, data.groupChatId))
    .run();

  const result: GroupChatSharedKB = {
    id,
    knowledgeBaseId: data.knowledgeBaseId,
    knowledgeBaseName: kbName,
    sharedByEmail: data.sharedByEmail,
    allowSourceViewing: data.allowSourceViewing,
    sharedAt: new Date(now),
  };
  if (data.sharedByName) result.sharedByName = data.sharedByName;
  return result;
}

export function unshareKB(shareId: string, groupChatId: string): void {
  const db = getDb();
  const share = db.select().from(groupChatSharedKBs).where(eq(groupChatSharedKBs.id, shareId)).get();
  if (!share) return;

  db.delete(groupChatSharedKBs).where(eq(groupChatSharedKBs.id, shareId)).run();

  const kb = db.select().from(knowledgeBases).where(eq(knowledgeBases.id, share.knowledgeBaseId)).get();
  addSystemMessage(groupChatId, `"${kb?.name ?? "A source"}" was removed from the group.`);
}

export function getSharedKBs(groupChatId: string): GroupChatSharedKB[] {
  const db = getDb();
  const rows = db.select().from(groupChatSharedKBs)
    .where(eq(groupChatSharedKBs.groupChatId, groupChatId))
    .all();

  return rows.map((row) => {
    const kb = db.select().from(knowledgeBases).where(eq(knowledgeBases.id, row.knowledgeBaseId)).get();
    const sharer = db.select().from(users).where(eq(users.email, row.sharedByEmail)).get();
    return rowToSharedKB(row, kb?.name, sharer?.name ?? undefined);
  });
}

/** Get dataset names for all shared KBs in a group chat. */
export function getSharedDatasetNames(groupChatId: string): string[] {
  const db = getDb();
  const shares = db.select().from(groupChatSharedKBs)
    .where(eq(groupChatSharedKBs.groupChatId, groupChatId))
    .all();

  const datasetNames: string[] = [];
  for (const share of shares) {
    const kb = db.select().from(knowledgeBases).where(eq(knowledgeBases.id, share.knowledgeBaseId)).get();
    if (kb?.datasetName) datasetNames.push(kb.datasetName);
  }
  return datasetNames;
}

// ─── Messages ────────────────────────────────────────────────────────────────

export function addMessage(data: {
  groupChatId: string;
  threadParentId?: string;
  authorEmail?: string;
  authorName?: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: Citation[];
  hasConfidentAnswer?: boolean;
}): GroupChatMessage {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.insert(groupChatMessages).values({
    id,
    groupChatId: data.groupChatId,
    threadParentId: data.threadParentId ?? null,
    authorEmail: data.authorEmail ?? null,
    authorName: data.authorName ?? null,
    role: data.role,
    content: data.content,
    citations: data.citations ? JSON.stringify(data.citations) : null,
    hasConfidentAnswer: data.hasConfidentAnswer != null ? (data.hasConfidentAnswer ? 1 : 0) : null,
    createdAt: now,
  }).run();

  db.update(groupChats)
    .set({ updatedAt: now })
    .where(eq(groupChats.id, data.groupChatId))
    .run();

  const msg: GroupChatMessage = {
    id,
    groupChatId: data.groupChatId,
    role: data.role,
    content: data.content,
    createdAt: new Date(now),
  };
  if (data.threadParentId) msg.threadParentId = data.threadParentId;
  if (data.authorEmail) msg.authorEmail = data.authorEmail;
  if (data.authorName) msg.authorName = data.authorName;
  if (data.citations) msg.citations = data.citations;
  if (data.hasConfidentAnswer != null) msg.hasConfidentAnswer = data.hasConfidentAnswer;
  return msg;
}

function addSystemMessage(groupChatId: string, content: string): GroupChatMessage {
  return addMessage({ groupChatId, role: "system", content });
}

/** Get main chat messages (excluding thread replies). Paginated. */
export function getMainMessages(
  groupChatId: string,
  limit = 50,
  before?: string,
): GroupChatMessage[] {
  const db = getDb();

  let query = db.select().from(groupChatMessages)
    .where(and(
      eq(groupChatMessages.groupChatId, groupChatId),
      isNull(groupChatMessages.threadParentId),
    ))
    .orderBy(desc(groupChatMessages.createdAt))
    .limit(limit);

  const rows = query.all();

  // If cursor provided, filter
  const filtered = before
    ? rows.filter((r) => r.createdAt < before)
    : rows;

  // Enrich with thread reply counts
  return filtered.reverse().map((row) => {
    const msg = rowToMessage(row);
    const countResult = db.select({ count: sql<number>`count(*)` })
      .from(groupChatMessages)
      .where(eq(groupChatMessages.threadParentId, row.id))
      .get();
    msg.threadReplyCount = countResult?.count ?? 0;
    return msg;
  });
}

/** Get thread messages for a parent message. */
export function getThreadMessages(parentId: string): GroupChatMessage[] {
  const db = getDb();
  const rows = db.select().from(groupChatMessages)
    .where(eq(groupChatMessages.threadParentId, parentId))
    .orderBy(asc(groupChatMessages.createdAt))
    .all();
  return rows.map(rowToMessage);
}

/** Get recent messages for context building (main chat only, no thread replies). */
export function getRecentMainMessages(groupChatId: string, limit = 20): GroupChatMessage[] {
  const db = getDb();
  const rows = db.select().from(groupChatMessages)
    .where(and(
      eq(groupChatMessages.groupChatId, groupChatId),
      isNull(groupChatMessages.threadParentId),
    ))
    .orderBy(desc(groupChatMessages.createdAt))
    .limit(limit)
    .all();
  return rows.reverse().map(rowToMessage);
}

// ─── Expiration ──────────────────────────────────────────────────────────────

/** Mark all expired group chats. Called periodically by server timer. */
export function expireStaleChats(): number {
  const db = getDb();
  const now = new Date().toISOString();

  const stale = db.select().from(groupChats)
    .where(and(
      eq(groupChats.status, "active"),
      sql`${groupChats.expiresAt} IS NOT NULL AND ${groupChats.expiresAt} < ${now}`,
    ))
    .all();

  for (const chat of stale) {
    db.update(groupChats)
      .set({ status: "expired", updatedAt: now })
      .where(eq(groupChats.id, chat.id))
      .run();
    addSystemMessage(chat.id, "This group chat has expired. Shared sources are no longer queryable.");
  }

  return stale.length;
}

// ─── Context Summary Cache ───────────────────────────────────────────────────

export function getContextSummary(groupChatId: string): { summary: string; upTo: string } | undefined {
  const db = getDb();
  const row = db.select().from(groupChats).where(eq(groupChats.id, groupChatId)).get();
  if (!row?.contextSummary || !row?.contextSummaryUpTo) return undefined;
  return { summary: row.contextSummary, upTo: row.contextSummaryUpTo };
}

export function setContextSummary(groupChatId: string, summary: string, upToMessageId: string): void {
  const db = getDb();
  db.update(groupChats)
    .set({ contextSummary: summary, contextSummaryUpTo: upToMessageId })
    .where(eq(groupChats.id, groupChatId))
    .run();
}

// ─── Internal enrichment ─────────────────────────────────────────────────────

function enrichGroupChat(row: typeof groupChats.$inferSelect): GroupChat {
  const db = getDb();

  const memberRows = db.select().from(groupChatMembers)
    .where(eq(groupChatMembers.groupChatId, row.id)).all();

  const sharedKBRows = db.select().from(groupChatSharedKBs)
    .where(eq(groupChatSharedKBs.groupChatId, row.id)).all();

  const sharedKBsEnriched = sharedKBRows.map((s) => {
    const kb = db.select().from(knowledgeBases).where(eq(knowledgeBases.id, s.knowledgeBaseId)).get();
    const sharer = db.select().from(users).where(eq(users.email, s.sharedByEmail)).get();
    return rowToSharedKB(s, kb?.name, sharer?.name ?? undefined);
  });

  // Message count (main messages only)
  const msgCount = db.select({ count: sql<number>`count(*)` })
    .from(groupChatMessages)
    .where(and(
      eq(groupChatMessages.groupChatId, row.id),
      isNull(groupChatMessages.threadParentId),
    ))
    .get();

  const chat: GroupChat = {
    id: row.id,
    name: row.name,
    creatorEmail: row.creatorEmail,
    orgId: row.orgId,
    status: row.status as GroupChat["status"],
    members: memberRows.map(rowToMember),
    sharedKBs: sharedKBsEnriched,
    messageCount: msgCount?.count ?? 0,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
  if (row.expiresAt) chat.expiresAt = new Date(row.expiresAt);
  return chat;
}
