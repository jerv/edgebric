import { randomUUID } from "crypto";
import { eq, and, desc, asc, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { encryptText, decryptText } from "../lib/crypto.js";
import {
  groupChats,
  groupChatMembers,
  groupChatSharedDataSources,
  groupChatMessages,
  dataSources,
  users,
  conversations,
  messages,
} from "../db/schema.js";
import type {
  GroupChat,
  GroupChatMember,
  GroupChatSharedDataSource,
  GroupChatMessage,
  GroupChatExpiration,
  Citation,
} from "@edgebric/types";

function decryptContentSafe(content: string): string {
  try {
    return decryptText(content);
  } catch {
    return content; // legacy plaintext
  }
}

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

function rowToSharedDataSource(
  row: typeof groupChatSharedDataSources.$inferSelect,
  dsName?: string,
  sharerName?: string,
): GroupChatSharedDataSource {
  const shared: GroupChatSharedDataSource = {
    id: row.id,
    dataSourceId: row.dataSourceId,
    dataSourceName: dsName ?? "Unknown data source",
    sharedByEmail: row.sharedByEmail,
    allowSourceViewing: !!row.allowSourceViewing,
    sharedAt: new Date(row.sharedAt),
  };
  if (sharerName) shared.sharedByName = sharerName;
  if (row.expiresAt) shared.expiresAt = row.expiresAt;
  return shared;
}

/** Check if a shared data source row is expired (has expiresAt in the past). */
function isShareExpired(row: { expiresAt: string | null }): boolean {
  return !!row.expiresAt && new Date(row.expiresAt).getTime() < Date.now();
}

function rowToMessage(row: typeof groupChatMessages.$inferSelect): GroupChatMessage {
  const msg: GroupChatMessage = {
    id: row.id,
    groupChatId: row.groupChatId,
    role: row.role as GroupChatMessage["role"],
    content: decryptContentSafe(row.content),
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

// ─── Shared Data Sources ────────────────────────────────────────────────────

export function shareDataSource(data: {
  groupChatId: string;
  dataSourceId: string;
  sharedByEmail: string;
  sharedByName?: string;
  allowSourceViewing: boolean;
  expiresAt?: string; // ISO string
}): GroupChatSharedDataSource {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.insert(groupChatSharedDataSources).values({
    id,
    groupChatId: data.groupChatId,
    dataSourceId: data.dataSourceId,
    sharedByEmail: data.sharedByEmail,
    allowSourceViewing: data.allowSourceViewing ? 1 : 0,
    expiresAt: data.expiresAt ?? null,
    sharedAt: now,
  }).run();

  // Get data source name for system message
  const ds = db.select().from(dataSources).where(eq(dataSources.id, data.dataSourceId)).get();
  const dsName = ds?.name ?? "a data source";

  if (data.expiresAt) {
    const duration = formatDuration(new Date(data.expiresAt).getTime() - Date.now());
    addSystemMessage(data.groupChatId, `${data.sharedByName ?? data.sharedByEmail} shared "${dsName}" with the group (expires in ${duration}).`);
  } else {
    addSystemMessage(data.groupChatId, `${data.sharedByName ?? data.sharedByEmail} shared "${dsName}" with the group.`);
  }

  db.update(groupChats)
    .set({ updatedAt: now })
    .where(eq(groupChats.id, data.groupChatId))
    .run();

  const result: GroupChatSharedDataSource = {
    id,
    dataSourceId: data.dataSourceId,
    dataSourceName: dsName,
    sharedByEmail: data.sharedByEmail,
    allowSourceViewing: data.allowSourceViewing,
    sharedAt: new Date(now),
  };
  if (data.sharedByName) result.sharedByName = data.sharedByName;
  if (data.expiresAt) result.expiresAt = data.expiresAt;
  return result;
}

export function unshareDataSource(shareId: string, groupChatId: string, revokedByName?: string): GroupChatMessage | undefined {
  const db = getDb();
  const share = db.select().from(groupChatSharedDataSources).where(eq(groupChatSharedDataSources.id, shareId)).get();
  if (!share) return undefined;

  db.delete(groupChatSharedDataSources).where(eq(groupChatSharedDataSources.id, shareId)).run();

  const ds = db.select().from(dataSources).where(eq(dataSources.id, share.dataSourceId)).get();
  const who = revokedByName ?? "Someone";
  return addSystemMessage(groupChatId, `${who} removed "${ds?.name ?? "a data source"}" from the group.`);
}

/**
 * Revoke all shares of a specific data source across all group chats.
 * Called when a data source is deleted or switched to restricted access.
 * Posts a system message in each affected group chat.
 */
export function revokeSharesForDataSource(dataSourceId: string, reason: string): void {
  const db = getDb();
  const shares = db.select().from(groupChatSharedDataSources)
    .where(eq(groupChatSharedDataSources.dataSourceId, dataSourceId))
    .all();

  if (shares.length === 0) return;

  const ds = db.select().from(dataSources).where(eq(dataSources.id, dataSourceId)).get();
  const dsName = ds?.name ?? "a data source";

  for (const share of shares) {
    db.delete(groupChatSharedDataSources).where(eq(groupChatSharedDataSources.id, share.id)).run();
    addSystemMessage(share.groupChatId, `"${dsName}" was removed from this group — ${reason}.`);
  }
}

/**
 * Revoke shares of a data source in group chats where the sharer no longer has access.
 * Called when a data source's access list changes (restricted mode).
 */
export function revokeSharesForRemovedUsers(dataSourceId: string, allowedEmails: Set<string>): void {
  const db = getDb();
  const shares = db.select().from(groupChatSharedDataSources)
    .where(eq(groupChatSharedDataSources.dataSourceId, dataSourceId))
    .all();

  if (shares.length === 0) return;

  const ds = db.select().from(dataSources).where(eq(dataSources.id, dataSourceId)).get();
  const dsName = ds?.name ?? "a data source";

  for (const share of shares) {
    if (!allowedEmails.has(share.sharedByEmail.toLowerCase())) {
      db.delete(groupChatSharedDataSources).where(eq(groupChatSharedDataSources.id, share.id)).run();
      addSystemMessage(share.groupChatId, `"${dsName}" was removed from this group — the sharer no longer has access.`);
    }
  }
}

export function getSharedDataSources(groupChatId: string): GroupChatSharedDataSource[] {
  const db = getDb();
  const rows = db.select().from(groupChatSharedDataSources)
    .where(eq(groupChatSharedDataSources.groupChatId, groupChatId))
    .all()
    .filter((row) => !isShareExpired(row));

  return rows.map((row) => {
    const ds = db.select().from(dataSources).where(eq(dataSources.id, row.dataSourceId)).get();
    const sharer = db.select().from(users).where(eq(users.email, row.sharedByEmail)).get();
    return rowToSharedDataSource(row, ds?.name, sharer?.name ?? undefined);
  });
}

/** Get dataset names for all data sources queryable in a group chat (shared + org-wide). */
export function getSharedDatasetNames(groupChatId: string): string[] {
  const db = getDb();

  // Get the org for this group chat
  const chat = db.select().from(groupChats).where(eq(groupChats.id, groupChatId)).get();
  if (!chat) return [];

  const seen = new Set<string>();
  const datasetNames: string[] = [];

  // 1. Explicitly shared data sources (skip archived/deleted and expired)
  const shares = db.select().from(groupChatSharedDataSources)
    .where(eq(groupChatSharedDataSources.groupChatId, groupChatId))
    .all()
    .filter((row) => !isShareExpired(row));
  for (const share of shares) {
    const ds = db.select().from(dataSources)
      .where(and(eq(dataSources.id, share.dataSourceId), eq(dataSources.status, "active")))
      .get();
    if (ds?.datasetName && !seen.has(ds.datasetName)) {
      seen.add(ds.datasetName);
      datasetNames.push(ds.datasetName);
    }
  }

  // 2. Org-wide data sources (accessMode: "all", active) — always queryable
  const orgDataSources = db.select().from(dataSources)
    .where(and(
      eq(dataSources.orgId, chat.orgId),
      eq(dataSources.type, "organization"),
      eq(dataSources.accessMode, "all"),
      eq(dataSources.status, "active"),
    ))
    .all();
  for (const ds of orgDataSources) {
    if (ds.datasetName && !seen.has(ds.datasetName)) {
      seen.add(ds.datasetName);
      datasetNames.push(ds.datasetName);
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

  const encryptedContent = encryptText(data.content);
  db.insert(groupChatMessages).values({
    id,
    groupChatId: data.groupChatId,
    threadParentId: data.threadParentId ?? null,
    authorEmail: data.authorEmail ?? null,
    authorName: data.authorName ?? null,
    role: data.role,
    content: encryptedContent,
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

/** Expire stale shared data source entries. Called periodically by server timer. */
export function expireStaleShares(): number {
  const db = getDb();
  const now = new Date().toISOString();

  const stale = db.select().from(groupChatSharedDataSources)
    .where(sql`${groupChatSharedDataSources.expiresAt} IS NOT NULL AND ${groupChatSharedDataSources.expiresAt} < ${now}`)
    .all();

  for (const share of stale) {
    db.delete(groupChatSharedDataSources).where(eq(groupChatSharedDataSources.id, share.id)).run();
    const ds = db.select().from(dataSources).where(eq(dataSources.id, share.dataSourceId)).get();
    const dsName = ds?.name ?? "a data source";
    addSystemMessage(share.groupChatId, `"${dsName}" is no longer shared (expired).`);
  }

  return stale.length;
}

/** Extend the expiration of a share. Returns updated share or undefined if not found. */
export function extendShare(shareId: string, newExpiresAt: string): GroupChatSharedDataSource | undefined {
  const db = getDb();
  const row = db.select().from(groupChatSharedDataSources).where(eq(groupChatSharedDataSources.id, shareId)).get();
  if (!row) return undefined;

  db.update(groupChatSharedDataSources)
    .set({ expiresAt: newExpiresAt })
    .where(eq(groupChatSharedDataSources.id, shareId))
    .run();

  const ds = db.select().from(dataSources).where(eq(dataSources.id, row.dataSourceId)).get();
  const dsName = ds?.name ?? "a data source";
  const sharer = db.select().from(users).where(eq(users.email, row.sharedByEmail)).get();
  const sharerName = sharer?.name ?? row.sharedByEmail;
  const duration = formatDuration(new Date(newExpiresAt).getTime() - Date.now());
  addSystemMessage(row.groupChatId, `${sharerName} extended sharing of "${dsName}" (expires in ${duration}).`);

  db.update(groupChats)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(groupChats.id, row.groupChatId))
    .run();

  const updated = db.select().from(groupChatSharedDataSources).where(eq(groupChatSharedDataSources.id, shareId)).get();
  if (!updated) return undefined;
  return rowToSharedDataSource(updated, ds?.name, sharer?.name ?? undefined);
}

/** Format a millisecond duration into a human-readable string. */
function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return "less than 1 hour";
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days !== 1 ? "s" : ""}`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks !== 1 ? "s" : ""}`;
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

  const sharedRows = db.select().from(groupChatSharedDataSources)
    .where(eq(groupChatSharedDataSources.groupChatId, row.id)).all()
    .filter((s) => !isShareExpired(s));

  const sharedDataSourcesEnriched = sharedRows.map((s) => {
    const ds = db.select().from(dataSources).where(eq(dataSources.id, s.dataSourceId)).get();
    const sharer = db.select().from(users).where(eq(users.email, s.sharedByEmail)).get();
    return rowToSharedDataSource(s, ds?.name, sharer?.name ?? undefined);
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
    sharedDataSources: sharedDataSourcesEnriched,
    messageCount: msgCount?.count ?? 0,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
  if (row.expiresAt) chat.expiresAt = new Date(row.expiresAt);
  return chat;
}
