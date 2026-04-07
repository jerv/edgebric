/**
 * Telegram Webhook Route — receives updates from Telegram Bot API.
 *
 * POST /api/telegram/webhook — called by Telegram when a user sends a message.
 * Validates the webhook secret, extracts message info, routes to handlers.
 *
 * This route skips session/CSRF middleware (it's called by Telegram, not a browser).
 */
import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { getIntegrationConfig, setIntegrationConfig } from "../services/integrationConfigStore.js";
import { isTelegramEnabled, parseCommand, setWebhook, deleteWebhook, getWebhookInfo } from "../services/telegramBot.js";
import type { TelegramUpdate } from "../services/telegramBot.js";
import { handleCommand, handleTextQuery, handleDocument } from "../services/telegramHandlers.js";
import { generateLinkCode, getTelegramLink, unlinkTelegram } from "../services/telegramLinking.js";
import { recordAuditEvent } from "../services/auditLog.js";
import { requireAdmin, requireOrg } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { getUserInOrg } from "../services/userStore.js";
import { randomBytes } from "crypto";

export const telegramRouter: IRouter = Router();

// ─── Webhook endpoint (called by Telegram — no session/CSRF) ─────────────

telegramRouter.post("/webhook", async (req, res) => {
  // Quick 200 response — Telegram expects fast responses
  res.status(200).json({ ok: true });

  // Check if Telegram is enabled
  if (!isTelegramEnabled()) {
    return;
  }

  // Validate webhook secret via X-Telegram-Bot-Api-Secret-Token header
  const config = getIntegrationConfig();
  const expectedSecret = config.telegramWebhookSecret;
  const receivedSecret = req.headers["x-telegram-bot-api-secret-token"];

  if (expectedSecret && receivedSecret !== expectedSecret) {
    logger.warn("Telegram webhook called with invalid secret");
    return;
  }

  // Parse the update
  const update = req.body as TelegramUpdate;
  if (!update?.message) return;

  const message = update.message;

  try {
    // Route based on message type
    if (message.document) {
      await handleDocument(message);
    } else if (message.text) {
      const parsed = parseCommand(message);
      if (parsed) {
        await handleCommand(message, parsed.command, parsed.args);
      } else {
        // Plain text — treat as a query
        await handleTextQuery(message.chat.id, message.text, message.from?.id);
      }
    }
  } catch (err) {
    logger.error({ err, updateId: update.update_id }, "Telegram webhook handler error");
  }
});

// ─── Admin API endpoints (require session + admin) ────────────────────────

/** GET /api/telegram/admin/status — get Telegram integration status */
telegramRouter.get("/admin/status", requireAdmin, async (_req, res) => {
  const config = getIntegrationConfig();
  const enabled = !!(config.telegramEnabled && config.telegramBotToken);

  let webhookInfo: { url: string; pending_update_count: number } | null = null;
  if (enabled) {
    webhookInfo = await getWebhookInfo();
  }

  res.json({
    enabled: config.telegramEnabled ?? false,
    hasToken: !!config.telegramBotToken,
    webhookRegistered: !!(webhookInfo?.url),
    webhookUrl: webhookInfo?.url ?? null,
    pendingUpdates: webhookInfo?.pending_update_count ?? 0,
  });
});

const updateConfigSchema = z.object({
  enabled: z.boolean().optional(),
  botToken: z.string().optional(),
}).strict();

/** PUT /api/telegram/admin/config — update Telegram config */
telegramRouter.put("/admin/config", requireAdmin, validateBody(updateConfigSchema), async (req, res) => {
  const { enabled, botToken } = req.body as z.infer<typeof updateConfigSchema>;
  const current = getIntegrationConfig();

  const updates: Record<string, unknown> = {};

  if (enabled !== undefined) {
    updates.telegramEnabled = enabled;
  }

  if (botToken !== undefined) {
    updates.telegramBotToken = botToken || undefined;
    // Generate webhook secret if not set
    if (botToken && !current.telegramWebhookSecret) {
      updates.telegramWebhookSecret = randomBytes(32).toString("hex");
    }
  }

  // If disabling, also delete the webhook
  if (enabled === false && current.telegramBotToken) {
    try {
      await deleteWebhook(current.telegramBotToken);
    } catch (err) {
      logger.warn({ err }, "Failed to delete Telegram webhook on disable");
    }
    updates.telegramWebhookRegistered = false;
  }

  const merged = { ...current, ...updates };
  setIntegrationConfig(merged);

  recordAuditEvent({
    eventType: "admin.settings_change",
    actorEmail: req.session.email,
    details: { setting: "telegram", enabled: merged.telegramEnabled },
  });

  res.json({
    enabled: merged.telegramEnabled ?? false,
    hasToken: !!merged.telegramBotToken,
  });
});

/** POST /api/telegram/admin/register-webhook — register the webhook with Telegram */
telegramRouter.post("/admin/register-webhook", requireAdmin, async (req, res) => {
  const config = getIntegrationConfig();

  if (!config.telegramBotToken) {
    res.status(400).json({ error: "Bot token not configured" });
    return;
  }

  if (!config.telegramWebhookSecret) {
    // Generate one now
    config.telegramWebhookSecret = randomBytes(32).toString("hex");
    setIntegrationConfig(config);
  }

  // Build webhook URL from the request's host
  const proto = req.headers["x-forwarded-proto"] ?? (req.secure ? "https" : "http");
  const host = req.headers["x-forwarded-host"] ?? req.headers["host"];

  if (!host) {
    res.status(400).json({ error: "Could not determine server URL. Set up a public URL first." });
    return;
  }

  const webhookUrl = `${proto}://${host}/api/telegram/webhook`;

  try {
    const result = await setWebhook(webhookUrl, config.telegramWebhookSecret, config.telegramBotToken);

    if (result.ok) {
      config.telegramWebhookRegistered = true;
      setIntegrationConfig(config);
      res.json({ ok: true, webhookUrl });
    } else {
      res.status(400).json({ error: result.description ?? "Failed to register webhook" });
    }
  } catch (err) {
    logger.error({ err }, "Failed to register Telegram webhook");
    res.status(500).json({ error: "Failed to register webhook" });
  }
});

/** DELETE /api/telegram/admin/webhook — unregister the webhook */
telegramRouter.delete("/admin/webhook", requireAdmin, async (_req, res) => {
  const config = getIntegrationConfig();

  if (!config.telegramBotToken) {
    res.status(400).json({ error: "Bot token not configured" });
    return;
  }

  try {
    await deleteWebhook(config.telegramBotToken);
    config.telegramWebhookRegistered = false;
    setIntegrationConfig(config);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete Telegram webhook");
    res.status(500).json({ error: "Failed to unregister webhook" });
  }
});

// ─── User API endpoints (account linking) ─────────────────────────────────

/** POST /api/telegram/link-code — generate a link code for the current user */
telegramRouter.post("/link-code", requireOrg, (req, res) => {
  const config = getIntegrationConfig();
  if (!config.telegramEnabled) {
    res.status(400).json({ error: "Telegram integration is not enabled" });
    return;
  }

  // Get the user's DB ID (not just email)
  const email = req.session.email;
  if (!email) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = getUserInOrg(email, req.session.orgId ?? "");
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const code = generateLinkCode(user.id);
  res.json({ code, expiresInMinutes: 10 });
});

/** GET /api/telegram/link-status — check if the current user has a linked Telegram */
telegramRouter.get("/link-status", requireOrg, (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = getUserInOrg(email, req.session.orgId ?? "");
  if (!user) {
    res.json({ linked: false });
    return;
  }

  const link = getTelegramLink(user.id);
  if (link) {
    res.json({
      linked: true,
      telegramUsername: link.telegramUsername,
      linkedAt: link.linkedAt,
    });
  } else {
    res.json({ linked: false });
  }
});

/** DELETE /api/telegram/unlink — unlink the current user's Telegram account */
telegramRouter.delete("/unlink", requireOrg, (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = getUserInOrg(email, req.session.orgId ?? "");
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const unlinked = unlinkTelegram(user.id);

  if (unlinked) {
    recordAuditEvent({
      eventType: "telegram.unlink",
      actorEmail: email,
    });
  }

  res.json({ ok: true, wasLinked: unlinked });
});
