import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { requireOrg } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  getNotificationsForUser,
  getUnreadCountForUser,
  markReadForUser,
  markReadForConversation,
} from "../services/notificationStore.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
});

const markReadSchema = z.object({
  conversationId: z.string().min(1, "conversationId is required"),
});

export const notificationsRouter: IRouter = Router();
notificationsRouter.use(requireOrg);

// GET /api/notifications — list for current user, scoped to current org
notificationsRouter.get("/", validateQuery(listQuerySchema), (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.json([]);
    return;
  }
  const limit = Number(req.query["limit"]) || 50;
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
notificationsRouter.post("/mark-read-for-conversation", validateBody(markReadSchema), (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { conversationId } = req.body as z.infer<typeof markReadSchema>;
  markReadForConversation(email, conversationId);
  res.json({ ok: true });
});
