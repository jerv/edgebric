import { Router } from "express";
import type { Router as IRouter } from "express";
import { requireAdmin } from "../middleware/auth.js";
import { getFeedbackStats, getTopicClusters, listFeedback } from "../services/feedbackStore.js";
import { getQueryVolume, getUnansweredQuestions, getEscalationStats, getOverviewStats, resolveQuestion, unresolveQuestion } from "../services/analyticsStore.js";

export const analyticsRouter: IRouter = Router();
analyticsRouter.use(requireAdmin);

// GET /api/admin/analytics/summary — dashboard overview
analyticsRouter.get("/summary", (req, res) => {
  const orgId = req.session.orgId;
  const overview = getOverviewStats(orgId);
  const feedbackStats = getFeedbackStats(undefined, orgId);
  const escalationStats = getEscalationStats(orgId);

  res.json({
    overview,
    feedback: feedbackStats,
    escalations: escalationStats,
    satisfactionRate: feedbackStats.total > 0
      ? Math.round((feedbackStats.up / feedbackStats.total) * 100)
      : null,
  });
});

// GET /api/admin/analytics/volume?days=30 — query volume over time
analyticsRouter.get("/volume", (req, res) => {
  const days = parseInt(req.query["days"] as string) || 30;
  const volume = getQueryVolume(Math.min(days, 365), req.session.orgId);
  res.json(volume);
});

// GET /api/admin/analytics/topics?min=5 — topic clusters
analyticsRouter.get("/topics", (req, res) => {
  const min = parseInt(req.query["min"] as string) || 5;
  const topics = getTopicClusters(min, req.session.orgId);
  res.json(topics);
});

// GET /api/admin/analytics/unanswered?limit=50 — unanswered questions
analyticsRouter.get("/unanswered", (req, res) => {
  const limit = parseInt(req.query["limit"] as string) || 50;
  const questions = getUnansweredQuestions(Math.min(limit, 200), req.session.orgId);
  res.json(questions);
});

// GET /api/admin/analytics/unanswered/export — CSV export
analyticsRouter.get("/unanswered/export", (req, res) => {
  const questions = getUnansweredQuestions(500, req.session.orgId);

  const escape = (s: string) => {
    // Prefix formula-triggering characters to prevent CSV injection in Excel
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    if (safe.includes(",") || safe.includes('"') || safe.includes("\n")) {
      return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
  };

  const header = "question,aiAnswer,createdAt";
  const rows = questions.map((q) =>
    [escape(q.question), escape(q.aiAnswer), q.createdAt].join(","),
  );

  const csv = [header, ...rows].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=unanswered-questions.csv");
  res.send(csv);
});

// POST /api/admin/analytics/unanswered/:messageId/resolve — mark as resolved
analyticsRouter.post("/unanswered/:messageId/resolve", (req, res) => {
  const { messageId } = req.params;
  const adminEmail = req.session.email;
  resolveQuestion(messageId!, adminEmail);
  res.json({ resolved: true });
});

// DELETE /api/admin/analytics/unanswered/:messageId/resolve — unmark resolved
analyticsRouter.delete("/unanswered/:messageId/resolve", (req, res) => {
  unresolveQuestion(req.params["messageId"]!);
  res.json({ resolved: false });
});

// GET /api/admin/analytics/feedback — raw feedback list (meta only, no snapshot)
analyticsRouter.get("/feedback", (req, res) => {
  const limit = parseInt(req.query["limit"] as string) || 100;
  const items = listFeedback(Math.min(limit, 500), req.session.orgId);
  const summary = items.map((fb) => ({
    id: fb.id,
    rating: fb.rating,
    topic: fb.topic,
    comment: fb.comment,
    createdAt: fb.createdAt,
    conversationId: fb.conversationId,
    messageId: fb.messageId,
  }));
  res.json(summary);
});
