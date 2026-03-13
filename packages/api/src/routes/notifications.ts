import { Router } from "express";
import type { Router as IRouter } from "express";
import { requireOrg } from "../middleware/auth.js";
import {
  getNotificationsForUser,
  getUnreadCountForUser,
  markReadForUser,
  markReadForConversation,
} from "../services/notificationStore.js";

export const notificationsRouter: IRouter = Router();
notificationsRouter.use(requireOrg);

// GET /api/notifications — list for current user, scoped to current org
notificationsRouter.get("/", (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.json([]);
    return;
  }
  const limit = parseInt(req.query["limit"] as string) || 50;
  res.json(getNotificationsForUser(email, limit, req.session.orgId));
});

// GET /api/notifications/unread-count
notificationsRouter.get("/unread-count", (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.json({ count: 0 });
    return;
  }
  res.json({ count: getUnreadCountForUser(email, req.session.orgId) });
});

// PATCH /api/notifications/:id/read
notificationsRouter.patch("/:id/read", (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  markReadForUser(req.params.id!, email);
  res.json({ ok: true });
});

// POST /api/notifications/mark-read-for-conversation
notificationsRouter.post("/mark-read-for-conversation", (req, res) => {
  const email = req.session.email;
  const { conversationId } = req.body as { conversationId?: string };
  if (!email || !conversationId) {
    res.status(400).json({ error: "conversationId is required" });
    return;
  }
  markReadForConversation(email, conversationId);
  res.json({ ok: true });
});
