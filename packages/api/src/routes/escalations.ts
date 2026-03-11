import { Router, type IRouter } from "express";
import crypto from "crypto";
import type { Escalation, EscalateRequest, IntegrationConfig } from "@edgebric/types";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import {
  addEscalation,
  listEscalations,
  markRead,
  getUnreadCount,
  getEscalation,
  replyToEscalation,
  resolveEscalation,
  unresolveEscalation,
} from "../services/escalationStore.js";
import { getConversation, addMessage, updateConversationTimestamp } from "../services/conversationStore.js";
import { createNotification } from "../services/notificationStore.js";
import {
  getIntegrationConfig,
  setIntegrationConfig,
} from "../services/integrationConfigStore.js";
import { createTarget, getTarget, listTargets, updateTarget, deleteTarget } from "../services/escalationTargetStore.js";
import { sendSlackDM, testSlackBot } from "../services/slack.js";
import { sendEscalationEmail, testEmailConfig } from "../services/email.js";
import { config } from "../config.js";

// ─── Employee escalation ─────────────────────────────────────────────────────

export const escalateRouter: IRouter = Router();
escalateRouter.use(requireAuth);

escalateRouter.post("/", async (req, res) => {
  const body = req.body as EscalateRequest;

  if (!body.question?.trim() || !body.aiAnswer?.trim()) {
    res.status(400).json({ error: "question and aiAnswer are required" });
    return;
  }
  if (!body.conversationId || !body.messageId || !body.targetId || !body.method) {
    res.status(400).json({ error: "conversationId, messageId, targetId, and method are required" });
    return;
  }

  const target = getTarget(body.targetId);
  if (!target) {
    res.status(404).json({ error: "Escalation target not found" });
    return;
  }

  const escalation: Escalation = {
    id: crypto.randomUUID(),
    createdAt: new Date(),
    question: body.question.trim(),
    aiAnswer: body.aiAnswer.trim(),
    sourceCitations: body.citations ?? [],
    status: "logged",
    conversationId: body.conversationId,
    messageId: body.messageId,
    targetId: body.targetId,
    targetName: target.name,
    method: body.method,
    readAt: null,
  };

  // Build conversation deep link
  const conversationUrl = `${config.frontendUrl}/conversations/${body.conversationId}?esc=${escalation.id}`;

  // Dispatch via selected method
  const cfg = getIntegrationConfig();
  if (body.method === "slack") {
    if (cfg.slack?.enabled && cfg.slack.botToken && target.slackUserId) {
      const result = await sendSlackDM(cfg.slack.botToken, target.slackUserId, escalation, conversationUrl);
      if (result.ok) {
        escalation.status = "sent";
        escalation.notifiedVia = "slack";
      } else {
        escalation.status = "failed";
        console.error("Slack DM failed:", result.error);
      }
    }
  } else if (body.method === "email") {
    if (cfg.email?.enabled && target.email) {
      const result = await sendEscalationEmail(cfg.email, target.email, escalation, conversationUrl);
      if (result.ok) {
        escalation.status = "sent";
        escalation.notifiedVia = "email";
      } else {
        escalation.status = "failed";
        console.error("Email delivery failed:", result.error);
      }
    }
  }

  addEscalation(escalation);

  res.json({
    id: escalation.id,
    status: escalation.status,
    message:
      escalation.status === "sent"
        ? `Your request has been sent to ${target.name}.`
        : "Your request has been logged. An administrator will follow up.",
  });
});

// ─── Employee: available targets ─────────────────────────────────────────────

export const targetsRouter: IRouter = Router();
targetsRouter.use(requireAuth);

targetsRouter.get("/", (_req, res) => {
  const targets = listTargets();
  const cfg = getIntegrationConfig();
  const slackEnabled = !!(cfg.slack?.enabled && cfg.slack.botToken);
  const emailEnabled = !!cfg.email?.enabled;

  const available = targets
    .map((t) => {
      const methods: ("slack" | "email")[] = [];
      if (slackEnabled && t.slackUserId) methods.push("slack");
      if (emailEnabled && t.email) methods.push("email");
      return { id: t.id, name: t.name, role: t.role, methods };
    })
    .filter((t) => t.methods.length > 0);

  res.json(available);
});

// ─── Admin: escalation log ───────────────────────────────────────────────────

export const adminEscalationsRouter: IRouter = Router();
adminEscalationsRouter.use(requireAdmin);

adminEscalationsRouter.get("/", (_req, res) => {
  res.json(listEscalations());
});

adminEscalationsRouter.get("/unread-count", (_req, res) => {
  res.json({ count: getUnreadCount() });
});

adminEscalationsRouter.patch("/:id/read", (req, res) => {
  const adminEmail = req.session.email ?? "unknown";
  const updated = markRead(req.params.id!, adminEmail);
  if (!updated) {
    res.status(404).json({ error: "Escalation not found" });
    return;
  }
  res.json(updated);
});

adminEscalationsRouter.get("/export", (_req, res) => {
  const escalationList = listEscalations();

  const escape = (s: string) => {
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = "id,createdAt,question,aiAnswer,status,notifiedVia,target,method,readAt,citations";
  const rows = escalationList.map((e) => {
    const citations = e.sourceCitations
      .map((c) => `${c.documentName} p.${c.pageNumber}`)
      .join("; ");
    return [
      e.id,
      new Date(e.createdAt).toISOString(),
      escape(e.question),
      escape(e.aiAnswer),
      e.status,
      e.notifiedVia ?? "",
      e.targetName ?? "",
      e.method ?? "",
      e.readAt ? new Date(e.readAt).toISOString() : "",
      escape(citations),
    ].join(",");
  });

  const csv = [header, ...rows].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=escalations.csv");
  res.send(csv);
});

// ─── Admin: reply to escalation ──────────────────────────────────────────────

adminEscalationsRouter.post("/:id/reply", (req, res) => {
  const adminEmail = req.session.email ?? "unknown";
  const { reply } = req.body as { reply?: string };

  if (!reply?.trim()) {
    res.status(400).json({ error: "reply is required" });
    return;
  }

  const esc = getEscalation(req.params.id!);
  if (!esc) {
    res.status(404).json({ error: "Escalation not found" });
    return;
  }
  if (esc.adminReply) {
    res.status(400).json({ error: "Escalation already has a reply" });
    return;
  }

  const conv = getConversation(esc.conversationId);
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  // Insert admin reply as a message in the conversation
  const messageId = crypto.randomUUID();
  addMessage({
    id: messageId,
    conversationId: esc.conversationId,
    role: "assistant",
    content: reply.trim(),
    source: "admin",
    createdAt: new Date(),
  });

  const updated = replyToEscalation(req.params.id!, adminEmail, reply.trim(), messageId);
  updateConversationTimestamp(esc.conversationId);

  // Notify the employee
  createNotification({
    userEmail: conv.userEmail,
    type: "admin_reply",
    conversationId: esc.conversationId,
    escalationId: esc.id,
    messageId,
    title: "An admin replied to your question",
    body: reply.trim().slice(0, 200),
  });

  res.json({ escalation: updated, messageId });
});

// ─── Admin: resolve/unresolve escalation ────────────────────────────────────

adminEscalationsRouter.post("/:id/resolve", (req, res) => {
  const adminEmail = req.session.email ?? "unknown";
  const { note } = req.body as { note?: string };

  const esc = getEscalation(req.params.id!);
  if (!esc) {
    res.status(404).json({ error: "Escalation not found" });
    return;
  }

  // Insert a system note in the conversation
  const systemNote = note?.trim() || "This question has been reviewed and resolved by an administrator.";
  const messageId = crypto.randomUUID();
  addMessage({
    id: messageId,
    conversationId: esc.conversationId,
    role: "assistant",
    content: systemNote,
    source: "system",
    createdAt: new Date(),
  });

  const updated = resolveEscalation(req.params.id!, adminEmail);
  updateConversationTimestamp(esc.conversationId);

  const conv = getConversation(esc.conversationId);
  if (conv) {
    createNotification({
      userEmail: conv.userEmail,
      type: "escalation_resolved",
      conversationId: esc.conversationId,
      escalationId: esc.id,
      messageId,
      title: "Your escalated question has been resolved",
    });
  }

  res.json({ escalation: updated });
});

adminEscalationsRouter.delete("/:id/resolve", (req, res) => {
  const updated = unresolveEscalation(req.params.id!);
  if (!updated) {
    res.status(404).json({ error: "Escalation not found" });
    return;
  }
  res.json({ escalation: updated });
});

// ─── Admin: escalation targets CRUD ──────────────────────────────────────────

export const adminTargetsRouter: IRouter = Router();
adminTargetsRouter.use(requireAdmin);

adminTargetsRouter.get("/", (_req, res) => {
  res.json(listTargets());
});

adminTargetsRouter.post("/", (req, res) => {
  const { name, role, slackUserId, email } = req.body as {
    name?: string;
    role?: string;
    slackUserId?: string;
    email?: string;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!slackUserId?.trim() && !email?.trim()) {
    res.status(400).json({ error: "At least one contact method (Slack User ID or email) is required" });
    return;
  }

  const target = createTarget({
    name: name.trim(),
    ...(role?.trim() && { role: role.trim() }),
    ...(slackUserId?.trim() && { slackUserId: slackUserId.trim() }),
    ...(email?.trim() && { email: email.trim() }),
  });
  res.status(201).json(target);
});

adminTargetsRouter.put("/:id", (req, res) => {
  const { name, role, slackUserId, email } = req.body as {
    name?: string;
    role?: string;
    slackUserId?: string;
    email?: string;
  };

  const data: { name?: string; role?: string; slackUserId?: string; email?: string } = {};
  if (name !== undefined) data.name = name;
  if (role !== undefined) data.role = role;
  if (slackUserId !== undefined) data.slackUserId = slackUserId;
  if (email !== undefined) data.email = email;

  const updated = updateTarget(req.params.id!, data);
  if (!updated) {
    res.status(404).json({ error: "Target not found" });
    return;
  }
  res.json(updated);
});

adminTargetsRouter.delete("/:id", (req, res) => {
  deleteTarget(req.params.id!);
  res.json({ ok: true });
});

// ─── Admin: integration config ───────────────────────────────────────────────

export const adminIntegrationsRouter: IRouter = Router();
adminIntegrationsRouter.use(requireAdmin);

adminIntegrationsRouter.get("/", (_req, res) => {
  const cfg = getIntegrationConfig();
  // Mask sensitive fields, pass through non-secret flags
  const masked: IntegrationConfig = {
    ...(cfg.privateModeEnabled != null && { privateModeEnabled: cfg.privateModeEnabled }),
    ...(cfg.vaultModeEnabled != null && { vaultModeEnabled: cfg.vaultModeEnabled }),
  };
  if (cfg.slack) {
    masked.slack = { ...cfg.slack, botToken: cfg.slack.botToken ? "xoxb-****" : "" };
  }
  if (cfg.email) {
    masked.email = { ...cfg.email, smtpPass: cfg.email.smtpPass ? "****" : "" };
  }
  res.json(masked);
});

adminIntegrationsRouter.put("/", async (req, res) => {
  const body = req.body as IntegrationConfig;

  if (body.slack?.botToken && body.slack.botToken !== "xoxb-****" && !body.slack.botToken.startsWith("xoxb-")) {
    res.status(400).json({ error: "Slack Bot Token must start with xoxb-" });
    return;
  }

  // Preserve existing secrets if masked values are sent back
  const existing = getIntegrationConfig();
  if (body.slack?.botToken === "xoxb-****" && existing.slack?.botToken) {
    body.slack.botToken = existing.slack.botToken;
  }
  if (body.email?.smtpPass === "****" && existing.email?.smtpPass) {
    body.email.smtpPass = existing.email.smtpPass;
  }

  setIntegrationConfig(body);
  // Return masked version, pass through non-secret flags
  const saved = getIntegrationConfig();
  const masked: IntegrationConfig = {
    ...(saved.privateModeEnabled != null && { privateModeEnabled: saved.privateModeEnabled }),
    ...(saved.vaultModeEnabled != null && { vaultModeEnabled: saved.vaultModeEnabled }),
  };
  if (saved.slack) {
    masked.slack = { ...saved.slack, botToken: saved.slack.botToken ? "xoxb-****" : "" };
  }
  if (saved.email) {
    masked.email = { ...saved.email, smtpPass: saved.email.smtpPass ? "****" : "" };
  }
  res.json(masked);
});

adminIntegrationsRouter.post("/test", async (req, res) => {
  const { type } = req.body as { type?: "slack" | "email" };
  const cfg = getIntegrationConfig();

  if (type === "slack") {
    if (!cfg.slack?.botToken) {
      res.status(400).json({ ok: false, error: "No Slack Bot Token configured" });
      return;
    }
    const result = await testSlackBot(cfg.slack.botToken);
    res.json(result);
  } else if (type === "email") {
    if (!cfg.email?.smtpHost) {
      res.status(400).json({ ok: false, error: "No email SMTP configuration found" });
      return;
    }
    const result = await testEmailConfig(cfg.email);
    res.json(result);
  } else {
    res.status(400).json({ ok: false, error: "type must be 'slack' or 'email'" });
  }
});
