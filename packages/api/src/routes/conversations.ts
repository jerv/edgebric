import { Router } from "express";
import type { Router as IRouter } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  getConversation,
  getMessages,
  getConversationPreviews,
  archiveConversation,
  deleteConversation,
} from "../services/conversationStore.js";
import { getEscalationsByConversation } from "../services/escalationStore.js";
import { getUnreadConversationIds } from "../services/notificationStore.js";

export const conversationsRouter: IRouter = Router();
conversationsRouter.use(requireAuth);

// GET /api/conversations — list current user's conversations (with preview)
conversationsRouter.get("/", (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.json([]);
    return;
  }
  const convs = getConversationPreviews(email);
  const unreadIds = getUnreadConversationIds(email);
  res.json(convs.map((c) => ({ ...c, hasUnreadNotification: unreadIds.has(c.id) })));
});

// GET /api/conversations/:id — get conversation + messages
// Admin can view any conversation; employee can only view their own.
conversationsRouter.get("/:id", (req, res) => {
  const conv = getConversation(req.params.id!);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  // Access control: admin can view any, employee can only view own
  if (!req.session.isAdmin && req.session.email !== conv.userEmail) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const msgs = getMessages(conv.id);
  const escalationsList = getEscalationsByConversation(conv.id);
  res.json({ conversation: conv, messages: msgs, escalations: escalationsList });
});

// DELETE /api/conversations/:id?mode=archive|delete
conversationsRouter.delete("/:id", (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const mode = req.query["mode"] as string | undefined;
  if (mode !== "archive" && mode !== "delete") {
    res.status(400).json({ error: "mode query param must be 'archive' or 'delete'" });
    return;
  }

  const conv = getConversation(req.params.id!);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  if (!req.session.isAdmin && email !== conv.userEmail) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  if (mode === "archive") {
    archiveConversation(conv.id);
  } else {
    deleteConversation(conv.id);
  }

  res.json({ ok: true, mode });
});
