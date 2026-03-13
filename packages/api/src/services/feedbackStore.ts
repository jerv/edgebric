import type { Feedback } from "@edgebric/types";
import { getDb } from "../db/index.js";
import { feedback } from "../db/schema.js";
import { eq, desc, and, gte, sql, count } from "drizzle-orm";
import { randomUUID } from "crypto";

/** Convert a DB row to a Feedback object. */
function rowToFeedback(row: typeof feedback.$inferSelect): Feedback {
  return {
    id: row.id,
    conversationId: row.conversationId,
    messageId: row.messageId,
    rating: row.rating as "up" | "down",
    messageSnapshot: JSON.parse(row.messageSnapshot),
    topic: row.topic ?? undefined,
    comment: row.comment ?? undefined,
    createdAt: new Date(row.createdAt),
  };
}

/** Create a new feedback record. Returns the created feedback. */
export function addFeedback(params: {
  conversationId: string;
  messageId: string;
  rating: "up" | "down";
  messageSnapshot: Array<{ role: string; content: string }>;
  comment?: string | undefined;
  orgId?: string | undefined;
}): Feedback {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.insert(feedback)
    .values({
      id,
      conversationId: params.conversationId,
      messageId: params.messageId,
      rating: params.rating,
      messageSnapshot: JSON.stringify(params.messageSnapshot),
      topic: null,
      comment: params.comment ?? null,
      orgId: params.orgId ?? null,
      createdAt: now,
    })
    .run();

  return {
    id,
    conversationId: params.conversationId,
    messageId: params.messageId,
    rating: params.rating,
    messageSnapshot: params.messageSnapshot,
    comment: params.comment,
    createdAt: new Date(now),
  };
}

/** Check if a message has already been rated. */
export function getFeedbackByMessageId(messageId: string): Feedback | undefined {
  const db = getDb();
  const row = db.select().from(feedback).where(eq(feedback.messageId, messageId)).get();
  return row ? rowToFeedback(row) : undefined;
}

/** Update the topic label for a feedback entry (used after keyword extraction). */
export function updateFeedbackTopic(id: string, topic: string): void {
  const db = getDb();
  db.update(feedback)
    .set({ topic })
    .where(eq(feedback.id, id))
    .run();
}

/** Get aggregate feedback stats, optionally scoped to an org. */
export function getFeedbackStats(since?: string, orgId?: string): { up: number; down: number; total: number } {
  const db = getDb();
  const conditions = since ? [gte(feedback.createdAt, since)] : [];
  if (orgId) conditions.push(eq(feedback.orgId, orgId));

  const upCount = db
    .select({ value: count() })
    .from(feedback)
    .where(and(eq(feedback.rating, "up"), ...conditions))
    .get()?.value ?? 0;

  const downCount = db
    .select({ value: count() })
    .from(feedback)
    .where(and(eq(feedback.rating, "down"), ...conditions))
    .get()?.value ?? 0;

  return { up: upCount, down: downCount, total: upCount + downCount };
}

/** Get topic clusters with privacy threshold (min queries to surface). */
export function getTopicClusters(minCount: number = 5, orgId?: string): Array<{ topic: string; count: number; upRate: number }> {
  const db = getDb();
  const orgFilter = orgId ? sql`AND org_id = ${orgId}` : sql``;
  const rows = db.all(sql`
    SELECT
      topic,
      COUNT(*) as total,
      SUM(CASE WHEN rating = 'up' THEN 1 ELSE 0 END) as up_count
    FROM feedback
    WHERE topic IS NOT NULL ${orgFilter}
    GROUP BY topic
    HAVING COUNT(*) >= ${minCount}
    ORDER BY total DESC
  `) as Array<{ topic: string; total: number; up_count: number }>;

  return rows.map((r) => ({
    topic: r.topic,
    count: r.total,
    upRate: r.total > 0 ? r.up_count / r.total : 0,
  }));
}

/** Get all feedback entries (for admin detail view), newest first. */
export function listFeedback(limit: number = 100, orgId?: string): Feedback[] {
  const db = getDb();
  const conditions = orgId ? [eq(feedback.orgId, orgId)] : [];
  const query = conditions.length > 0
    ? db.select().from(feedback).where(and(...conditions))
    : db.select().from(feedback);
  const rows = query
    .orderBy(desc(feedback.createdAt))
    .limit(limit)
    .all();
  return rows.map(rowToFeedback);
}
