import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { requireOrg } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  createGroupChat,
  getGroupChat,
  listGroupChatsForUser,
  updateGroupChat,
  archiveGroupChat,
  addMember,
  removeMember,
  isMember,
  isCreator,
  shareKB,
  unshareKB,
  getMainMessages,
  getThreadMessages,
} from "../services/groupChatStore.js";
import { getUserInOrg, listUsers } from "../services/userStore.js";
import { getKB, kbBelongsToOrg } from "../services/knowledgeBaseStore.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(1).max(100),
  expiration: z.enum(["24h", "1w", "1m", "never"]),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  expiration: z.enum(["24h", "1w", "1m", "never"]).optional(),
});

const addMemberSchema = z.object({
  email: z.string().email(),
});

const shareKBSchema = z.object({
  knowledgeBaseId: z.string().uuid(),
  allowSourceViewing: z.boolean(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireMembership(groupChatId: string, email: string, res: import("express").Response): boolean {
  if (!isMember(groupChatId, email)) {
    res.status(403).json({ error: "You are not a member of this group chat" });
    return false;
  }
  return true;
}

function requireActiveChat(groupChatId: string, res: import("express").Response): ReturnType<typeof getGroupChat> {
  const chat = getGroupChat(groupChatId);
  if (!chat) {
    res.status(404).json({ error: "Group chat not found" });
    return undefined;
  }
  return chat;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const groupChatsRouter: IRouter = Router();
groupChatsRouter.use(requireOrg);

// POST /api/group-chats — create a new group chat
groupChatsRouter.post("/", validateBody(createSchema), (req, res) => {
  const email = req.session.email!;
  const orgId = req.session.orgId!;

  // Check permission
  const user = getUserInOrg(email, orgId);
  if (!user) {
    res.status(403).json({ error: "User not found in organization" });
    return;
  }
  if (!req.session.isAdmin && !user.canCreateGroupChats) {
    res.status(403).json({ error: "You do not have permission to create group chats" });
    return;
  }

  const opts: Parameters<typeof createGroupChat>[0] = {
    name: req.body.name,
    creatorEmail: email,
    orgId,
    expiration: req.body.expiration,
  };
  if (req.session.name) opts.creatorName = req.session.name;
  const chat = createGroupChat(opts);

  res.status(201).json(chat);
});

// GET /api/group-chats — list user's group chats
groupChatsRouter.get("/", (req, res) => {
  const email = req.session.email!;
  const orgId = req.session.orgId!;
  const chats = listGroupChatsForUser(email, orgId);
  res.json(chats);
});

// GET /api/group-chats/members/search?q=... — search org members by name or email
groupChatsRouter.get("/members/search", (req, res) => {
  const orgId = req.session.orgId!;
  const q = (typeof req.query["q"] === "string" ? req.query["q"] : "").toLowerCase().trim();
  if (!q) {
    res.json([]);
    return;
  }

  const allUsers = listUsers(orgId);
  const matches = allUsers
    .filter((u) => {
      const email = u.email.toLowerCase();
      const name = (u.name ?? "").toLowerCase();
      return email.includes(q) || name.includes(q);
    })
    .slice(0, 10)
    .map((u) => ({ email: u.email, name: u.name ?? null, picture: u.picture ?? null }));

  res.json(matches);
});

// GET /api/group-chats/:id — get group chat detail
groupChatsRouter.get("/:id", (req, res) => {
  const email = req.session.email!;
  const chat = requireActiveChat(req.params["id"] as string, res);
  if (!chat) return;
  if (!requireMembership(chat.id, email, res)) return;
  res.json(chat);
});

// PATCH /api/group-chats/:id — update name or expiration (creator only)
groupChatsRouter.patch("/:id", validateBody(updateSchema), (req, res) => {
  const email = req.session.email!;
  const chatId = req.params["id"] as string;

  const chat = requireActiveChat(chatId, res);
  if (!chat) return;
  if (!isCreator(chatId, email)) {
    res.status(403).json({ error: "Only the creator can update this group chat" });
    return;
  }
  if (chat.status !== "active") {
    res.status(409).json({ error: "Cannot update an inactive group chat" });
    return;
  }

  const updated = updateGroupChat(chatId, req.body);
  res.json(updated);
});

// DELETE /api/group-chats/:id — archive (creator only)
groupChatsRouter.delete("/:id", (req, res) => {
  const email = req.session.email!;
  const chatId = req.params["id"] as string;

  const chat = requireActiveChat(chatId, res);
  if (!chat) return;
  if (!isCreator(chatId, email)) {
    res.status(403).json({ error: "Only the creator can archive this group chat" });
    return;
  }

  archiveGroupChat(chatId);
  res.json({ ok: true });
});

// ─── Members ──────────────────────────────────────────────────────────────────

// POST /api/group-chats/:id/members — invite a member (creator only)
groupChatsRouter.post("/:id/members", validateBody(addMemberSchema), (req, res) => {
  const email = req.session.email!;
  const chatId = req.params["id"] as string;
  const orgId = req.session.orgId!;

  const chat = requireActiveChat(chatId, res);
  if (!chat) return;
  if (!isCreator(chatId, email)) {
    res.status(403).json({ error: "Only the creator can invite members" });
    return;
  }
  if (chat.status !== "active") {
    res.status(409).json({ error: "Cannot add members to an inactive group chat" });
    return;
  }

  const inviteeEmail = req.body.email.toLowerCase();

  // Check if already a member
  if (isMember(chatId, inviteeEmail)) {
    res.status(409).json({ error: "User is already a member" });
    return;
  }

  // Look up the user in the org for display name
  const invitee = getUserInOrg(inviteeEmail, orgId);
  const member = addMember(chatId, inviteeEmail, invitee?.name ?? undefined);

  res.status(201).json(member);
});

// DELETE /api/group-chats/:id/members/:email — remove member (creator or self)
groupChatsRouter.delete("/:id/members/:email", (req, res) => {
  const email = req.session.email!;
  const chatId = req.params["id"] as string;
  const targetEmail = decodeURIComponent(req.params["email"] as string).toLowerCase();

  const chat = requireActiveChat(chatId, res);
  if (!chat) return;

  // Must be creator or self
  const isSelf = email.toLowerCase() === targetEmail;
  if (!isSelf && !isCreator(chatId, email)) {
    res.status(403).json({ error: "Only the creator can remove other members" });
    return;
  }

  // Creator can't remove themselves
  if (isSelf && isCreator(chatId, email)) {
    res.status(409).json({ error: "Creator cannot leave the group chat. Archive it instead." });
    return;
  }

  if (!isMember(chatId, targetEmail)) {
    res.status(404).json({ error: "User is not a member" });
    return;
  }

  removeMember(chatId, targetEmail);
  res.json({ ok: true });
});

// ─── Shared KBs ───────────────────────────────────────────────────────────────

// POST /api/group-chats/:id/shared-kbs — share a KB (any member)
groupChatsRouter.post("/:id/shared-kbs", validateBody(shareKBSchema), (req, res) => {
  const email = req.session.email!;
  const chatId = req.params["id"] as string;
  const orgId = req.session.orgId!;

  const chat = requireActiveChat(chatId, res);
  if (!chat) return;
  if (!requireMembership(chatId, email, res)) return;
  if (chat.status !== "active") {
    res.status(409).json({ error: "Cannot share KBs in an inactive group chat" });
    return;
  }

  // Verify KB exists and belongs to org
  const kb = getKB(req.body.knowledgeBaseId);
  if (!kb || !kbBelongsToOrg(req.body.knowledgeBaseId, orgId)) {
    res.status(404).json({ error: "Source not found" });
    return;
  }

  // Check if already shared
  const existing = chat.sharedKBs.find((s) => s.knowledgeBaseId === req.body.knowledgeBaseId);
  if (existing) {
    res.status(409).json({ error: "This source is already shared in this group chat" });
    return;
  }

  const shareOpts: Parameters<typeof shareKB>[0] = {
    groupChatId: chatId,
    knowledgeBaseId: req.body.knowledgeBaseId,
    sharedByEmail: email,
    allowSourceViewing: req.body.allowSourceViewing,
  };
  if (req.session.name) shareOpts.sharedByName = req.session.name;
  const shared = shareKB(shareOpts);

  res.status(201).json(shared);
});

// DELETE /api/group-chats/:id/shared-kbs/:shareId — unshare (sharer or creator)
groupChatsRouter.delete("/:id/shared-kbs/:shareId", (req, res) => {
  const email = req.session.email!;
  const chatId = req.params["id"] as string;
  const shareId = req.params["shareId"] as string;

  const chat = requireActiveChat(chatId, res);
  if (!chat) return;
  if (!requireMembership(chatId, email, res)) return;

  const share = chat.sharedKBs.find((s) => s.id === shareId);
  if (!share) {
    res.status(404).json({ error: "Shared source not found" });
    return;
  }

  // Only sharer or creator can unshare
  if (share.sharedByEmail !== email.toLowerCase() && !isCreator(chatId, email)) {
    res.status(403).json({ error: "Only the sharer or creator can remove a shared source" });
    return;
  }

  unshareKB(shareId, chatId);
  res.json({ ok: true });
});

// ─── Messages ─────────────────────────────────────────────────────────────────

// GET /api/group-chats/:id/messages — paginated main chat messages
groupChatsRouter.get("/:id/messages", (req, res) => {
  const email = req.session.email!;
  const chatId = req.params["id"] as string;

  const chat = requireActiveChat(chatId, res);
  if (!chat) return;
  if (!requireMembership(chatId, email, res)) return;

  const limit = Math.min(Number(req.query["limit"]) || 50, 100);
  const before = req.query["before"] as string | undefined;

  const messages = getMainMessages(chatId, limit, before);
  res.json(messages);
});

// GET /api/group-chats/:id/threads/:parentId — thread messages
groupChatsRouter.get("/:id/threads/:parentId", (req, res) => {
  const email = req.session.email!;
  const chatId = req.params["id"] as string;

  const chat = requireActiveChat(chatId, res);
  if (!chat) return;
  if (!requireMembership(chatId, email, res)) return;

  const messages = getThreadMessages(req.params["parentId"] as string);
  res.json(messages);
});
