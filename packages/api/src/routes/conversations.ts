import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { requireOrg } from "../middleware/auth.js";
import { validateQuery, validateBody } from "../middleware/validate.js";
import {
  getConversation,
  getMessages,
  getConversationPreviews,
  getConversationsByUser,
  archiveConversation,
  deleteConversation,
  archiveAllConversations,
} from "../services/conversationStore.js";
import { convertSoloToGroup, shareKB } from "../services/groupChatStore.js";
import { getUserInOrg } from "../services/userStore.js";
import { getUnreadConversationIds } from "../services/notificationStore.js";

const deleteQuerySchema = z.object({
  mode: z.enum(["archive", "delete"], { message: "mode must be 'archive' or 'delete'" }),
});

const convertToGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  inviteEmails: z.array(z.string().email()).min(1, "Invite at least one person"),
  expiration: z.enum(["24h", "1w", "1m", "never", "custom"]),
  expiresInMs: z.number().int().positive().optional(),
  shareKBIds: z.array(z.string().uuid()).optional(),
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

// POST /api/conversations/:id/convert-to-group — convert solo chat to group chat
conversationsRouter.post("/:id/convert-to-group", validateBody(convertToGroupSchema), (req, res) => {
  const email = req.session.email;
  const orgId = req.session.orgId;
  if (!email || !orgId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const conv = getConversation(req.params["id"] as string);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  if (email !== conv.userEmail) {
    res.status(403).json({ error: "Only the conversation owner can convert it" });
    return;
  }

  const body = req.body as z.infer<typeof convertToGroupSchema>;

  // Validate all invitees exist in org
  for (const invEmail of body.inviteEmails) {
    const invUser = getUserInOrg(invEmail, orgId);
    if (!invUser) {
      res.status(400).json({ error: `User ${invEmail} not found in organization` });
      return;
    }
  }

  // Use provided name or derive from first message
  let chatName = body.name?.trim();
  if (!chatName) {
    const msgs = getMessages(conv.id);
    const firstUserMsg = msgs.find((m) => m.role === "user");
    chatName = firstUserMsg ? firstUserMsg.content.slice(0, 80) : "Group Chat";
  }

  const convertData: Parameters<typeof convertSoloToGroup>[0] = {
    conversationId: conv.id,
    name: chatName,
    creatorEmail: email,
    orgId,
    expiration: body.expiration,
    inviteEmails: body.inviteEmails,
  };
  if (req.session.name) convertData.creatorName = req.session.name;
  if (body.expiresInMs) convertData.expiresInMs = body.expiresInMs;

  const groupChat = convertSoloToGroup(convertData);

  // Share KBs if requested
  if (body.shareKBIds?.length) {
    for (const kbId of body.shareKBIds) {
      try {
        shareKB({ groupChatId: groupChat.id, knowledgeBaseId: kbId, sharedByEmail: email, allowSourceViewing: true });
      } catch { /* best effort */ }
    }
  }

  res.json({ groupChatId: groupChat.id });
});
