import { Router, type IRouter } from "express";
import crypto from "crypto";
import { z } from "zod";
import type { Escalation, EscalateRequest, IntegrationConfig } from "@edgebric/types";
import { requireOrg, requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { logger } from "../lib/logger.js";

const escalateSchema = z.object({
  question: z.string().min(1, "Question is required").max(4000),
  aiAnswer: z.string().min(1, "AI answer is required").max(8000),
  citations: z.array(z.object({
    documentId: z.string().default(""),
    documentName: z.string(),
    sectionPath: z.array(z.string()),
    pageNumber: z.number(),
    excerpt: z.string(),
  })).optional(),
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  targetId: z.string().min(1),
  method: z.enum(["slack", "email"]),
});

const replySchema = z.object({
  reply: z.string().min(1, "Reply cannot be empty").max(8000),
});

const resolveSchema = z.object({
  note: z.string().max(2000).optional(),
});

const targetSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  role: z.string().max(200).optional(),
  slackUserId: z.string().max(50).optional(),
  email: z.string().email().optional(),
  slackNotify: z.boolean().optional(),
  emailNotify: z.boolean().optional(),
}).refine(
  (data) => data.slackUserId || data.email,
  { message: "At least one contact method (Slack User ID or email) is required" },
);
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
escalateRouter.use(requireOrg);

escalateRouter.post("/", validateBody(escalateSchema), async (req, res) => {
  const body = req.body as z.infer<typeof escalateSchema>;

  const target = getTarget(body.targetId);
  if (!target || (req.session.orgId && target.orgId !== req.session.orgId)) {
    res.status(404).json({ error: "Escalation target not found" });
    return;
  }

  // Verify the conversation belongs to the caller's org
  const conv = getConversation(body.conversationId);
  if (!conv || (req.session.orgId && conv.orgId !== req.session.orgId)) {
    res.status(404).json({ error: "Conversation not found" });
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
        logger.error({ error: result.error }, "Slack DM failed");
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
        logger.error({ error: result.error }, "Email delivery failed");
      }
    }
  }

  addEscalation(escalation, req.session.orgId);

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
targetsRouter.use(requireOrg);

targetsRouter.get("/", (req, res) => {
  const targets = listTargets(req.session.orgId);
  const cfg = getIntegrationConfig();
  const slackEnabled = !!(cfg.slack?.enabled && cfg.slack.botToken);
  const emailEnabled = !!cfg.email?.enabled;

  const available = targets
    .map((t) => {
      const methods: ("slack" | "email")[] = [];
      if (slackEnabled && t.slackUserId && t.slackNotify !== false) methods.push("slack");
      if (emailEnabled && t.email && t.emailNotify !== false) methods.push("email");
      return { id: t.id, name: t.name, role: t.role, methods };
    })
    .filter((t) => t.methods.length > 0);

  res.json(available);
});

// ─── Admin: escalation log ───────────────────────────────────────────────────

export const adminEscalationsRouter: IRouter = Router();
adminEscalationsRouter.use(requireAdmin);

adminEscalationsRouter.get("/", (req, res) => {
  res.json(listEscalations(req.session.orgId));
});

adminEscalationsRouter.get("/unread-count", (req, res) => {
  res.json({ count: getUnreadCount(req.session.orgId) });
});

adminEscalationsRouter.patch("/:id/read", (req, res) => {
  const esc = getEscalation(req.params["id"] as string, req.session.orgId);
  if (!esc) {
    res.status(404).json({ error: "Escalation not found" });
    return;
  }
  const adminEmail = req.session.email ?? "unknown";
  const updated = markRead(req.params["id"] as string, adminEmail);
  if (!updated) {
    res.status(404).json({ error: "Escalation not found" });
    return;
  }
  res.json(updated);
});

adminEscalationsRouter.get("/export", (req, res) => {
  const escalationList = listEscalations(req.session.orgId);

  const escape = (s: string) => {
    // Prefix formula-triggering characters to prevent CSV injection in Excel
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    if (safe.includes(",") || safe.includes('"') || safe.includes("\n")) {
      return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
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

adminEscalationsRouter.post("/:id/reply", validateBody(replySchema), (req, res) => {
  const adminEmail = req.session.email ?? "unknown";
  const { reply } = req.body as z.infer<typeof replySchema>;

  const esc = getEscalation(req.params["id"] as string, req.session.orgId);
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

  const updated = replyToEscalation(req.params["id"] as string, adminEmail, reply.trim(), messageId);
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

adminEscalationsRouter.post("/:id/resolve", validateBody(resolveSchema), (req, res) => {
  const adminEmail = req.session.email ?? "unknown";
  const { note } = req.body as z.infer<typeof resolveSchema>;

  const esc = getEscalation(req.params["id"] as string, req.session.orgId);
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

  const updated = resolveEscalation(req.params["id"] as string, adminEmail);
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
  const esc = getEscalation(req.params["id"] as string, req.session.orgId);
  if (!esc) {
    res.status(404).json({ error: "Escalation not found" });
    return;
  }
  const updated = unresolveEscalation(req.params["id"] as string);
  if (!updated) {
    res.status(404).json({ error: "Escalation not found" });
    return;
  }
  res.json({ escalation: updated });
});

// ─── Admin: escalation targets CRUD ──────────────────────────────────────────

export const adminTargetsRouter: IRouter = Router();
adminTargetsRouter.use(requireAdmin);

adminTargetsRouter.get("/", (req, res) => {
  res.json(listTargets(req.session.orgId));
});

adminTargetsRouter.post("/", validateBody(targetSchema), (req, res) => {
  const { name, role, slackUserId, email, slackNotify, emailNotify } = req.body as z.infer<typeof targetSchema>;

  const target = createTarget({
    name: name.trim(),
    ...(role?.trim() && { role: role.trim() }),
    ...(slackUserId?.trim() && { slackUserId: slackUserId.trim() }),
    ...(email?.trim() && { email: email.trim() }),
    ...(slackNotify !== undefined && { slackNotify }),
    ...(emailNotify !== undefined && { emailNotify }),
    ...(req.session.orgId && { orgId: req.session.orgId }),
  });
  res.status(201).json(target);
});

const updateTargetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  role: z.string().max(200).optional(),
  slackUserId: z.string().max(50).optional(),
  email: z.string().email().or(z.literal("")).optional(),
  slackNotify: z.boolean().optional(),
  emailNotify: z.boolean().optional(),
});

adminTargetsRouter.put("/:id", validateBody(updateTargetSchema), (req, res) => {
  const { name, role, slackUserId, email, slackNotify, emailNotify } = req.body as z.infer<typeof updateTargetSchema>;

  const target = getTarget(req.params["id"] as string);
  if (!target || (req.session.orgId && target.orgId !== req.session.orgId)) {
    res.status(404).json({ error: "Target not found" });
    return;
  }

  const data: { name?: string; role?: string; slackUserId?: string; email?: string; slackNotify?: boolean; emailNotify?: boolean } = {};
  if (name !== undefined) data.name = name;
  if (role !== undefined) data.role = role;
  if (slackUserId !== undefined) data.slackUserId = slackUserId;
  if (email !== undefined) data.email = email;
  if (slackNotify !== undefined) data.slackNotify = slackNotify;
  if (emailNotify !== undefined) data.emailNotify = emailNotify;

  const updated = updateTarget(req.params["id"] as string, data);
  if (!updated) {
    res.status(404).json({ error: "Target not found" });
    return;
  }
  res.json(updated);
});

adminTargetsRouter.delete("/:id", (req, res) => {
  const target = getTarget(req.params["id"] as string);
  if (!target || (req.session.orgId && target.orgId !== req.session.orgId)) {
    res.status(404).json({ error: "Target not found" });
    return;
  }
  deleteTarget(req.params["id"] as string);
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

const integrationConfigSchema = z.object({
  slack: z.object({
    botToken: z.string().max(200),
    enabled: z.boolean(),
  }).optional(),
  email: z.object({
    smtpHost: z.string().max(200),
    smtpPort: z.number().int().min(1).max(65535),
    smtpUser: z.string().max(200),
    smtpPass: z.string().max(200),
    fromAddress: z.string().max(200),
    useTls: z.boolean(),
    enabled: z.boolean(),
  }).optional(),
  privateModeEnabled: z.boolean().optional(),
  vaultModeEnabled: z.boolean().optional(),
  stalenessThresholdDays: z.number().int().min(1).max(3650).optional(),
}).strict();

adminIntegrationsRouter.put("/", validateBody(integrationConfigSchema), async (req, res) => {
  const body = req.body as IntegrationConfig;

  if (body.slack?.botToken && body.slack.botToken !== "xoxb-****" && !body.slack.botToken.startsWith("xoxb-")) {
    res.status(400).json({ error: "Slack Bot Token must start with xoxb-" });
    return;
  }

  // Merge with existing config so saving email doesn't wipe slack and vice versa
  const existing = getIntegrationConfig();
  const merged: IntegrationConfig = { ...existing };

  if (body.privateModeEnabled !== undefined) merged.privateModeEnabled = body.privateModeEnabled;
  if (body.vaultModeEnabled !== undefined) merged.vaultModeEnabled = body.vaultModeEnabled;

  if (body.slack) {
    merged.slack = { ...existing.slack, ...body.slack };
    if (merged.slack.botToken === "xoxb-****" && existing.slack?.botToken) {
      merged.slack.botToken = existing.slack.botToken;
    }
  }

  if (body.email) {
    merged.email = { ...existing.email, ...body.email };
    if (merged.email.smtpPass === "****" && existing.email?.smtpPass) {
      merged.email.smtpPass = existing.email.smtpPass;
    }
    // Sanitize SMTP host (strip trailing commas, whitespace)
    if (merged.email.smtpHost) {
      merged.email.smtpHost = merged.email.smtpHost.replace(/[,\s]+$/, "").trim();
    }
  }

  setIntegrationConfig(merged);
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

const testIntegrationSchema = z.object({
  type: z.enum(["slack", "email"]),
});

adminIntegrationsRouter.post("/test", validateBody(testIntegrationSchema), async (req, res) => {
  const { type } = req.body as z.infer<typeof testIntegrationSchema>;
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
  }
});
