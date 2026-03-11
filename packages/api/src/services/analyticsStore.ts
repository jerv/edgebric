import { getDb } from "../db/index.js";
import { messages, conversations, escalations, questionResolutions } from "../db/schema.js";
import { sql, count, eq } from "drizzle-orm";

/** Daily query volume for the last N days. */
export function getQueryVolume(days: number = 30): Array<{ date: string; count: number }> {
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const rows = db.all(sql`
    SELECT
      DATE(created_at) as date,
      COUNT(*) as query_count
    FROM messages
    WHERE role = 'user' AND DATE(created_at) >= ${since}
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `) as Array<{ date: string; query_count: number }>;

  return rows.map((r) => ({ date: r.date, count: r.query_count }));
}

/**
 * Unanswered questions: assistant messages where hasConfidentAnswer = 0
 * OR the answer text contains the "couldn't find" fallback phrase.
 * Includes feedback (if user rated this response) and resolution status.
 */
export function getUnansweredQuestions(limit: number = 50): Array<{
  question: string;
  aiAnswer: string;
  createdAt: string;
  conversationId: string;
  messageId: string;
  feedback?: { rating: "up" | "down"; comment?: string | undefined } | undefined;
  resolvedAt?: string | undefined;
}> {
  const db = getDb();
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

/** Escalation summary stats. */
export function getEscalationStats(): {
  total: number;
  sent: number;
  failed: number;
  unread: number;
} {
  const db = getDb();

  const total = db
    .select({ value: count() })
    .from(escalations)
    .get()?.value ?? 0;

  const sent = db
    .select({ value: count() })
    .from(escalations)
    .where(eq(escalations.status, "sent"))
    .get()?.value ?? 0;

  const failed = db
    .select({ value: count() })
    .from(escalations)
    .where(eq(escalations.status, "failed"))
    .get()?.value ?? 0;

  const unread = db
    .select({ value: count() })
    .from(escalations)
    .where(sql`read_at IS NULL`)
    .get()?.value ?? 0;

  return { total, sent, failed, unread };
}

/** Total conversation and message counts. */
export function getOverviewStats(): {
  totalConversations: number;
  totalMessages: number;
  uniqueUsers: number;
} {
  const db = getDb();

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
