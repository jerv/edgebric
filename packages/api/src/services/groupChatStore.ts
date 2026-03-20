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
  conversations,
  messages,
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

function expirationToDate(expiration: GroupChatExpiration, customMs?: number): string | null {
  const now = Date.now();
  switch (expiration) {
    case "24h": return new Date(now + 24 * 60 * 60 * 1000).toISOString();
    case "1w": return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    case "1m": return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
    case "custom": return customMs ? new Date(now + customMs).toISOString() : null;
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
    knowledgeBaseName: kbName ?? "Unknown data source",
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
  expiresInMs?: number;
}): GroupChat {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const expiresAt = expirationToDate(data.expiration, data.expiresInMs);

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
  const kbName = kb?.name ?? "a data source";
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

export function unshareKB(shareId: string, groupChatId: string, revokedByName?: string): GroupChatMessage | undefined {
  const db = getDb();
  const share = db.select().from(groupChatSharedKBs).where(eq(groupChatSharedKBs.id, shareId)).get();
  if (!share) return undefined;

  db.delete(groupChatSharedKBs).where(eq(groupChatSharedKBs.id, shareId)).run();

  const kb = db.select().from(knowledgeBases).where(eq(knowledgeBases.id, share.knowledgeBaseId)).get();
  const who = revokedByName ?? "Someone";
  return addSystemMessage(groupChatId, `${who} removed "${kb?.name ?? "a data source"}" from the group.`);
}

/**
 * Revoke all shares of a specific KB across all group chats.
 * Called when a KB is deleted or switched to restricted access.
 * Posts a system message in each affected group chat.
 */
export function revokeSharesForKB(kbId: string, reason: string): void {
  const db = getDb();
  const shares = db.select().from(groupChatSharedKBs)
    .where(eq(groupChatSharedKBs.knowledgeBaseId, kbId))
    .all();

  if (shares.length === 0) return;

  const kb = db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId)).get();
  const kbName = kb?.name ?? "a data source";

  for (const share of shares) {
    db.delete(groupChatSharedKBs).where(eq(groupChatSharedKBs.id, share.id)).run();
    addSystemMessage(share.groupChatId, `"${kbName}" was removed from this group — ${reason}.`);
  }
}

/**
 * Revoke shares of a KB in group chats where the sharer no longer has access.
 * Called when a KB's access list changes (restricted mode).
 */
export function revokeSharesForRemovedUsers(kbId: string, allowedEmails: Set<string>): void {
  const db = getDb();
  const shares = db.select().from(groupChatSharedKBs)
    .where(eq(groupChatSharedKBs.knowledgeBaseId, kbId))
    .all();

  if (shares.length === 0) return;

  const kb = db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId)).get();
  const kbName = kb?.name ?? "a data source";

  for (const share of shares) {
    if (!allowedEmails.has(share.sharedByEmail.toLowerCase())) {
      db.delete(groupChatSharedKBs).where(eq(groupChatSharedKBs.id, share.id)).run();
      addSystemMessage(share.groupChatId, `"${kbName}" was removed from this group — the sharer no longer has access.`);
    }
  }
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

/** Get dataset names for all KBs queryable in a group chat (shared + org-wide). */
export function getSharedDatasetNames(groupChatId: string): string[] {
  const db = getDb();

  // Get the org for this group chat
  const chat = db.select().from(groupChats).where(eq(groupChats.id, groupChatId)).get();
  if (!chat) return [];

  const seen = new Set<string>();
  const datasetNames: string[] = [];

  // 1. Explicitly shared KBs (skip archived/deleted)
  const shares = db.select().from(groupChatSharedKBs)
    .where(eq(groupChatSharedKBs.groupChatId, groupChatId))
    .all();
  for (const share of shares) {
    const kb = db.select().from(knowledgeBases)
      .where(and(eq(knowledgeBases.id, share.knowledgeBaseId), eq(knowledgeBases.status, "active")))
      .get();
    if (kb?.datasetName && !seen.has(kb.datasetName)) {
      seen.add(kb.datasetName);
      datasetNames.push(kb.datasetName);
    }
  }

  // 2. Org-wide KBs (accessMode: "all", active) — always queryable
  const orgKBs = db.select().from(knowledgeBases)
    .where(and(
      eq(knowledgeBases.orgId, chat.orgId),
      eq(knowledgeBases.type, "organization"),
      eq(knowledgeBases.accessMode, "all"),
      eq(knowledgeBases.status, "active"),
    ))
    .all();
  for (const kb of orgKBs) {
    if (kb.datasetName && !seen.has(kb.datasetName)) {
      seen.add(kb.datasetName);
      datasetNames.push(kb.datasetName);
    }
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

  // Enrich with thread reply counts and participants
  return filtered.reverse().map((row) => {
    const msg = rowToMessage(row);
    const countResult = db.select({ count: sql<number>`count(*)` })
      .from(groupChatMessages)
      .where(eq(groupChatMessages.threadParentId, row.id))
      .get();
    msg.threadReplyCount = countResult?.count ?? 0;

    if (msg.threadReplyCount > 0) {
      const replies = db.select({
        authorEmail: groupChatMessages.authorEmail,
        authorName: groupChatMessages.authorName,
      })
        .from(groupChatMessages)
        .where(and(
          eq(groupChatMessages.threadParentId, row.id),
          sql`${groupChatMessages.authorEmail} IS NOT NULL`,
        ))
        .all();

      const seen = new Set<string>();
      const participants: { email: string; name?: string; picture?: string }[] = [];
      for (const r of replies) {
        if (!r.authorEmail || seen.has(r.authorEmail)) continue;
        seen.add(r.authorEmail);
        const userRow = db.select().from(users).where(eq(users.email, r.authorEmail)).get();
        const p: { email: string; name?: string; picture?: string } = { email: r.authorEmail };
        if (r.authorName) p.name = r.authorName;
        if (userRow?.picture) p.picture = userRow.picture;
        participants.push(p);
      }
      msg.threadParticipants = participants;
    }

    return msg;
  });
}

/** Get thread messages for a parent message. */
export function getThreadMessages(parentId: string): GroupChatMessage[] {
  const db = getDb();

  // Include the parent message first so the bot has full thread context
  const parentRow = db.select().from(groupChatMessages)
    .where(eq(groupChatMessages.id, parentId))
    .get();

  const rows = db.select().from(groupChatMessages)
    .where(eq(groupChatMessages.threadParentId, parentId))
    .orderBy(asc(groupChatMessages.createdAt))
    .all();

  const result: GroupChatMessage[] = [];
  if (parentRow) result.push(rowToMessage(parentRow));
  result.push(...rows.map(rowToMessage));
  return result;
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
    addSystemMessage(chat.id, "This group chat has expired. Shared data sources are no longer queryable.");
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

// ─── Solo → Group Conversion ─────────────────────────────────────────────────

export function convertSoloToGroup(data: {
  conversationId: string;
  name: string;
  creatorEmail: string;
  creatorName?: string;
  orgId: string;
  expiration: GroupChatExpiration;
  expiresInMs?: number;
  inviteEmails: string[];
}): GroupChat {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const expiresAt = expirationToDate(data.expiration, data.expiresInMs);

  // 1. Create group chat
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

  // 2. Add creator as member
  db.insert(groupChatMembers).values({
    groupChatId: id,
    userEmail: data.creatorEmail,
    userName: data.creatorName ?? null,
    role: "creator",
    joinedAt: now,
  }).run();

  // 3. Migrate solo conversation messages → group chat messages
  const soloMsgs = db.select().from(messages)
    .where(eq(messages.conversationId, data.conversationId))
    .orderBy(asc(messages.createdAt))
    .all();

  for (const msg of soloMsgs) {
    db.insert(groupChatMessages).values({
      id: randomUUID(),
      groupChatId: id,
      threadParentId: null,
      authorEmail: msg.role === "user" ? data.creatorEmail : null,
      authorName: msg.role === "user" ? (data.creatorName ?? null) : null,
      role: msg.role as "user" | "assistant",
      content: msg.content,
      citations: msg.citations,
      hasConfidentAnswer: msg.hasConfidentAnswer,
      createdAt: msg.createdAt,
    }).run();
  }

  // 4. Archive the solo conversation
  db.update(conversations)
    .set({ archivedAt: now })
    .where(eq(conversations.id, data.conversationId))
    .run();

  // 5. Add invited members
  const memberNames: string[] = [];
  for (const email of data.inviteEmails) {
    const user = db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
    db.insert(groupChatMembers).values({
      groupChatId: id,
      userEmail: email.toLowerCase(),
      userName: user?.name ?? null,
      role: "member",
      joinedAt: now,
    }).run();
    memberNames.push(user?.name ?? email);
  }

  // 6. System message
  const memberList = memberNames.join(", ");
  addSystemMessage(id, `${data.creatorName ?? data.creatorEmail} converted a solo chat to a group and invited ${memberList}.`);

  return getGroupChat(id)!;
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
    members: memberRows.map((mr) => {
      const member = rowToMember(mr);
      const userRow = db.select().from(users).where(eq(users.email, mr.userEmail)).get();
      if (userRow?.picture) member.picture = userRow.picture;
      return member;
    }),
    sharedKBs: sharedKBsEnriched,
    messageCount: msgCount?.count ?? 0,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
  if (row.expiresAt) chat.expiresAt = new Date(row.expiresAt);
  return chat;
}
