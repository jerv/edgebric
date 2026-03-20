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
  addGlobalClient,
  removeGlobalClient,
  markGroupChatRead,
  getUnreadGroupChatIds,
  getGroupChatNotifLevel,
  setGroupChatNotifLevel,
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

// ─── Global SSE Stream ──────────────────────────────────────────────────────

// GET /api/notifications/stream — global per-user SSE for real-time events
notificationsRouter.get("/stream", (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("\n");

  addGlobalClient(email, res);

  // Heartbeat
  const heartbeat = setInterval(() => {
    try { res.write(":ping\n\n"); } catch { /* ignore */ }
  }, 30_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeGlobalClient(email, res);
  });
});

// ─── Group Chat Unread ──────────────────────────────────────────────────────

// POST /api/notifications/mark-read-group-chat
const markGroupChatReadSchema = z.object({
  groupChatId: z.string().min(1),
});

notificationsRouter.post("/mark-read-group-chat", validateBody(markGroupChatReadSchema), (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  markGroupChatRead(req.body.groupChatId, email);
  res.json({ ok: true });
});

// GET /api/notifications/unread-group-chats
notificationsRouter.get("/unread-group-chats", (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.json({ ids: [] });
    return;
  }
  const ids = getUnreadGroupChatIds(email);
  res.json({ ids: Array.from(ids) });
});

// ─── Notification Preferences ───────────────────────────────────────────────

const notifPrefSchema = z.object({
  groupChatId: z.string().min(1),
  level: z.enum(["all", "mentions", "none"]),
});

// GET /api/notifications/group-chat-pref/:groupChatId
notificationsRouter.get("/group-chat-pref/:groupChatId", (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const level = getGroupChatNotifLevel(req.params.groupChatId!, email);
  res.json({ level });
});

// PUT /api/notifications/group-chat-pref
notificationsRouter.put("/group-chat-pref", validateBody(notifPrefSchema), (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  setGroupChatNotifLevel(req.body.groupChatId, email, req.body.level);
  res.json({ ok: true });
});
