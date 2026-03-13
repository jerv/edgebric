import { getDb } from "../db/index.js";
import { messages, conversations, escalations, questionResolutions } from "../db/schema.js";
import { sql, count, eq, and } from "drizzle-orm";

/** Daily query volume for the last N days, scoped to an org. */
export function getQueryVolume(days: number = 30, orgId?: string): Array<{ date: string; count: number }> {
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const orgFilter = orgId ? sql`AND m.conversation_id IN (SELECT id FROM conversations WHERE org_id = ${orgId})` : sql``;

  const rows = db.all(sql`
    SELECT
      DATE(m.created_at) as date,
      COUNT(*) as query_count
    FROM messages m
    WHERE m.role = 'user' AND DATE(m.created_at) >= ${since}
    ${orgFilter}
    GROUP BY DATE(m.created_at)
    ORDER BY date ASC
  `) as Array<{ date: string; query_count: number }>;

  return rows.map((r) => ({ date: r.date, count: r.query_count }));
}

/**
 * Unanswered questions: assistant messages where hasConfidentAnswer = 0
 * OR the answer text contains the "couldn't find" fallback phrase.
 * Scoped to an org via conversations.org_id.
 */
export function getUnansweredQuestions(limit: number = 50, orgId?: string): Array<{
  question: string;
  aiAnswer: string;
  createdAt: string;
  conversationId: string;
  messageId: string;
  feedback?: { rating: "up" | "down"; comment?: string | undefined } | undefined;
  resolvedAt?: string | undefined;
}> {
  const db = getDb();

  const orgFilter = orgId
    ? sql`AND m_asst.conversation_id IN (SELECT id FROM conversations WHERE org_id = ${orgId})`
    : sql``;

  const rows = db.all(sql`
    SELECT
      m_user.content as question,
      m_asst.content as ai_answer,
      m_asst.created_at as created_at,
      m_asst.conversation_id as conversation_id,
      m_asst.id as message_id,
      fb.rating as fb_rating,
      fb.comment as fb_comment,
      qr.resolved_at as resolved_at
    FROM messages m_asst
    JOIN messages m_user
      ON m_user.conversation_id = m_asst.conversation_id
      AND m_user.role = 'user'
      AND m_user.created_at = (
        SELECT MAX(m2.created_at)
        FROM messages m2
        WHERE m2.conversation_id = m_asst.conversation_id
          AND m2.role = 'user'
          AND m2.created_at < m_asst.created_at
      )
    LEFT JOIN feedback fb
      ON fb.message_id = m_asst.id
    LEFT JOIN question_resolutions qr
      ON qr.message_id = m_asst.id
    WHERE m_asst.role = 'assistant'
      AND (
        m_asst.has_confident_answer = 0
        OR LOWER(m_asst.content) LIKE '%couldn''t find a clear answer%'
        OR LOWER(m_asst.content) LIKE '%could not find%relevant%'
      )
      ${orgFilter}
    ORDER BY m_asst.created_at DESC
    LIMIT ${limit}
  `) as Array<{
    question: string;
    ai_answer: string;
    created_at: string;
    conversation_id: string;
    message_id: string;
    fb_rating: string | null;
    fb_comment: string | null;
    resolved_at: string | null;
  }>;

  return rows.map((r) => ({
    question: r.question,
    aiAnswer: r.ai_answer,
    createdAt: r.created_at,
    conversationId: r.conversation_id,
    messageId: r.message_id,
    feedback: r.fb_rating
      ? { rating: r.fb_rating as "up" | "down", comment: r.fb_comment ?? undefined }
      : undefined,
    resolvedAt: r.resolved_at ?? undefined,
  }));
}

/** Mark an unanswered question as resolved. */
export function resolveQuestion(messageId: string, resolvedBy?: string): void {
  const db = getDb();
  db.insert(questionResolutions)
    .values({
      messageId,
      resolvedAt: new Date().toISOString(),
      resolvedBy: resolvedBy ?? null,
    })
    .onConflictDoNothing()
    .run();
}

/** Remove resolved status from a question. */
export function unresolveQuestion(messageId: string): void {
  const db = getDb();
  db.delete(questionResolutions)
    .where(eq(questionResolutions.messageId, messageId))
    .run();
}

/** Escalation summary stats, scoped to an org. */
export function getEscalationStats(orgId?: string): {
  total: number;
  sent: number;
  failed: number;
  unread: number;
} {
  const db = getDb();

  const conditions = orgId ? [eq(escalations.orgId, orgId)] : [];
  const withStatus = (status: string) => orgId
    ? and(eq(escalations.status, status), eq(escalations.orgId, orgId))
    : eq(escalations.status, status);
  const unreadCond = orgId
    ? sql`read_at IS NULL AND org_id = ${orgId}`
    : sql`read_at IS NULL`;

  const total = conditions.length > 0
    ? (db.select({ value: count() }).from(escalations).where(and(...conditions)).get()?.value ?? 0)
    : (db.select({ value: count() }).from(escalations).get()?.value ?? 0);

  const sent = db
    .select({ value: count() })
    .from(escalations)
    .where(withStatus("sent"))
    .get()?.value ?? 0;

  const failed = db
    .select({ value: count() })
    .from(escalations)
    .where(withStatus("failed"))
    .get()?.value ?? 0;

  const unread = db
    .select({ value: count() })
    .from(escalations)
    .where(unreadCond)
    .get()?.value ?? 0;

  return { total, sent, failed, unread };
}

/** Total conversation and message counts, scoped to an org. */
export function getOverviewStats(orgId?: string): {
  totalConversations: number;
  totalMessages: number;
  uniqueUsers: number;
} {
  const db = getDb();

  if (orgId) {
    const rows = db.all(sql`
      SELECT
        (SELECT COUNT(*) FROM conversations WHERE org_id = ${orgId}) as total_conversations,
        (SELECT COUNT(*) FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE org_id = ${orgId})) as total_messages,
        (SELECT COUNT(DISTINCT user_email) FROM conversations WHERE org_id = ${orgId}) as unique_users
    `) as Array<{ total_conversations: number; total_messages: number; unique_users: number }>;

    const r = rows[0];
    return {
      totalConversations: r?.total_conversations ?? 0,
      totalMessages: r?.total_messages ?? 0,
      uniqueUsers: r?.unique_users ?? 0,
    };
  }

  const totalConversations = db
    .select({ value: count() })
    .from(conversations)
    .get()?.value ?? 0;

  const totalMessages = db
    .select({ value: count() })
    .from(messages)
    .get()?.value ?? 0;

  const uniqueUsersResult = db.all(sql`
    SELECT COUNT(DISTINCT user_email) as c FROM conversations
  `) as Array<{ c: number }>;

  return {
    totalConversations,
    totalMessages,
    uniqueUsers: uniqueUsersResult[0]?.c ?? 0,
  };
}
