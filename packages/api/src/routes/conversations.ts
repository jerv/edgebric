import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { requireOrg } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validate.js";
import {
  getConversation,
  getMessages,
  getConversationPreviews,
  getConversationsByUser,
  archiveConversation,
  deleteConversation,
  archiveAllConversations,
} from "../services/conversationStore.js";
import { getUnreadConversationIds } from "../services/notificationStore.js";

const deleteQuerySchema = z.object({
  mode: z.enum(["archive", "delete"], { message: "mode must be 'archive' or 'delete'" }),
});

export const conversationsRouter: IRouter = Router();
conversationsRouter.use(requireOrg);

// GET /api/conversations — list current user's conversations (with preview)
conversationsRouter.get("/", (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.json([]);
    return;
  }
  const convs = getConversationPreviews(email, req.session.orgId);
  const unreadIds = getUnreadConversationIds(email);
  res.json(convs.map((c) => ({ ...c, hasUnreadNotification: unreadIds.has(c.id) })));
});

// DELETE /api/conversations?mode=archive|delete — bulk remove all user's conversations
conversationsRouter.delete("/", validateQuery(deleteQuerySchema), (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const mode = req.query["mode"] as "archive" | "delete";

  const orgId = req.session.orgId;

  if (mode === "archive") {
    const count = archiveAllConversations(email, orgId);
    res.json({ ok: true, mode, count });
    return;
  }

  // mode === "delete": hard-delete all user conversations
  const userConvs = getConversationsByUser(email, orgId);
  let deleted = 0;
  for (const conv of userConvs) {
    deleteConversation(conv.id);
    deleted++;
  }

  res.json({ ok: true, mode, count: deleted });
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
  res.json({ conversation: conv, messages: msgs });
});

// DELETE /api/conversations/:id?mode=archive|delete
conversationsRouter.delete("/:id", validateQuery(deleteQuerySchema), (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const mode = req.query["mode"] as "archive" | "delete";

  const conv = getConversation(req.params["id"] as string);
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
