import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestApp, teardownTestApp, adminAgent, memberAgent, createAgent, getDefaultOrgId } from "./helpers.js";
import { getDb } from "../db/index.js";
import { telegramLinks, telegramLinkCodes } from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  generateLinkCode,
  verifyLinkCode,
  getLinkedUserId,
  getTelegramLink,
  unlinkTelegram,
} from "../services/telegramLinking.js";
import { parseCommand, isTelegramEnabled } from "../services/telegramBot.js";
import type { TelegramMessage } from "../services/telegramBot.js";
import { setIntegrationConfig, getIntegrationConfig } from "../services/integrationConfigStore.js";
import { upsertUser } from "../services/userStore.js";

describe("Telegram Integration", () => {
  let orgId: string;
  let testUserId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();

    // Create a test user for linking
    const user = upsertUser({
      email: "telegram-test@test.com",
      name: "Telegram Test User",
      role: "member",
      orgId,
    });
    testUserId = user.id;
  });

  afterAll(() => {
    teardownTestApp();
  });

  beforeEach(() => {
    // Clean up telegram tables
    const db = getDb();
    try { db.delete(telegramLinks).run(); } catch { /* empty */ }
    try { db.delete(telegramLinkCodes).run(); } catch { /* empty */ }
    // Reset integration config
    setIntegrationConfig({});
  });

  // ─── parseCommand ─────────────────────────────────────────────────────────

  describe("parseCommand", () => {
    it("parses a simple bot command", () => {
      const msg: TelegramMessage = {
        message_id: 1,
        chat: { id: 123, type: "private" },
        date: Date.now(),
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      };
      const result = parseCommand(msg);
      expect(result).toEqual({ command: "start", args: "" });
    });

    it("parses a command with arguments", () => {
      const msg: TelegramMessage = {
        message_id: 1,
        chat: { id: 123, type: "private" },
        date: Date.now(),
        text: "/ask What is the policy on remote work?",
        entities: [{ type: "bot_command", offset: 0, length: 4 }],
      };
      const result = parseCommand(msg);
      expect(result).toEqual({ command: "ask", args: "What is the policy on remote work?" });
    });

    it("strips @botname suffix from commands", () => {
      const msg: TelegramMessage = {
        message_id: 1,
        chat: { id: 123, type: "private" },
        date: Date.now(),
        text: "/help@edgebric_bot",
        entities: [{ type: "bot_command", offset: 0, length: 18 }],
      };
      const result = parseCommand(msg);
      expect(result).toEqual({ command: "help", args: "" });
    });

    it("returns null for non-command text", () => {
      const msg: TelegramMessage = {
        message_id: 1,
        chat: { id: 123, type: "private" },
        date: Date.now(),
        text: "Just a regular message",
      };
      const result = parseCommand(msg);
      expect(result).toBeNull();
    });

    it("returns null for command not at start of message", () => {
      const msg: TelegramMessage = {
        message_id: 1,
        chat: { id: 123, type: "private" },
        date: Date.now(),
        text: "hey /start",
        entities: [{ type: "bot_command", offset: 4, length: 6 }],
      };
      const result = parseCommand(msg);
      expect(result).toBeNull();
    });
  });

  // ─── isTelegramEnabled ────────────────────────────────────────────────────

  describe("isTelegramEnabled", () => {
    it("returns false when not configured", () => {
      expect(isTelegramEnabled()).toBe(false);
    });

    it("returns false when enabled but no token", () => {
      setIntegrationConfig({ telegramEnabled: true });
      expect(isTelegramEnabled()).toBe(false);
    });

    it("returns true when enabled with token", () => {
      setIntegrationConfig({ telegramEnabled: true, telegramBotToken: "123:abc" });
      expect(isTelegramEnabled()).toBe(true);
    });

    it("returns false when disabled even with token", () => {
      setIntegrationConfig({ telegramEnabled: false, telegramBotToken: "123:abc" });
      expect(isTelegramEnabled()).toBe(false);
    });
  });

  // ─── Account Linking ──────────────────────────────────────────────────────

  describe("Account Linking", () => {
    describe("generateLinkCode", () => {
      it("generates a 6-digit code", () => {
        const code = generateLinkCode(testUserId);
        expect(code).toMatch(/^\d{6}$/);
      });

      it("replaces existing code for same user", () => {
        const code1 = generateLinkCode(testUserId);
        const code2 = generateLinkCode(testUserId);
        expect(code1).not.toBe(code2);

        // Old code should be gone
        const db = getDb();
        const old = db.select().from(telegramLinkCodes).where(eq(telegramLinkCodes.code, code1)).get();
        expect(old).toBeUndefined();
      });
    });

    describe("verifyLinkCode", () => {
      it("links Telegram user on valid code", () => {
        const code = generateLinkCode(testUserId);
        const result = verifyLinkCode("telegram-12345", code, "testuser");
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.userId).toBe(testUserId);
        }

        // Verify the link exists
        const linkedUserId = getLinkedUserId("telegram-12345");
        expect(linkedUserId).toBe(testUserId);
      });

      it("fails on invalid code", () => {
        const result = verifyLinkCode("telegram-12345", "000000");
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain("Invalid code");
        }
      });

      it("fails on expired code", () => {
        const code = generateLinkCode(testUserId);

        // Manually expire the code
        const db = getDb();
        db.update(telegramLinkCodes)
          .set({ expiresAt: new Date(Date.now() - 60_000).toISOString() })
          .where(eq(telegramLinkCodes.code, code))
          .run();

        const result = verifyLinkCode("telegram-12345", code);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain("expired");
        }
      });

      it("replaces existing link for same Telegram user", () => {
        // Link to first user
        const code1 = generateLinkCode(testUserId);
        verifyLinkCode("telegram-99999", code1, "user1");

        // Create another user and link the same Telegram account
        const user2 = upsertUser({
          email: "telegram-test2@test.com",
          name: "Test User 2",
          role: "member",
          orgId,
        });
        const code2 = generateLinkCode(user2.id);
        const result = verifyLinkCode("telegram-99999", code2, "user2");
        expect(result.success).toBe(true);

        // Should now point to user2
        const linkedUserId = getLinkedUserId("telegram-99999");
        expect(linkedUserId).toBe(user2.id);
      });

      it("deletes code after successful use", () => {
        const code = generateLinkCode(testUserId);
        verifyLinkCode("telegram-55555", code);

        // Code should be gone
        const db = getDb();
        const row = db.select().from(telegramLinkCodes).where(eq(telegramLinkCodes.code, code)).get();
        expect(row).toBeUndefined();
      });
    });

    describe("getTelegramLink", () => {
      it("returns null when not linked", () => {
        const link = getTelegramLink(testUserId);
        expect(link).toBeNull();
      });

      it("returns link info when linked", () => {
        const code = generateLinkCode(testUserId);
        verifyLinkCode("telegram-44444", code, "myusername");

        const link = getTelegramLink(testUserId);
        expect(link).not.toBeNull();
        expect(link!.telegramUserId).toBe("telegram-44444");
        expect(link!.telegramUsername).toBe("myusername");
      });
    });

    describe("unlinkTelegram", () => {
      it("removes an existing link", () => {
        const code = generateLinkCode(testUserId);
        verifyLinkCode("telegram-77777", code);

        const result = unlinkTelegram(testUserId);
        expect(result).toBe(true);

        const link = getTelegramLink(testUserId);
        expect(link).toBeNull();
      });

      it("returns false when no link exists", () => {
        const result = unlinkTelegram("nonexistent-user-id");
        expect(result).toBe(false);
      });
    });
  });

  // ─── Webhook Route ────────────────────────────────────────────────────────

  describe("Webhook Route", () => {
    it("POST /api/telegram/webhook returns 200 even when disabled", async () => {
      const agent = createAgent({
        queryToken: undefined,
        email: undefined,
      } as Record<string, unknown>);

      const res = await agent
        .post("/api/telegram/webhook")
        .send({ update_id: 1, message: { message_id: 1, chat: { id: 1, type: "private" }, date: 1, text: "hi" } });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("rejects webhook with wrong secret when configured", async () => {
      setIntegrationConfig({
        telegramEnabled: true,
        telegramBotToken: "123:abc",
        telegramWebhookSecret: "correct-secret",
      });

      const agent = createAgent({
        queryToken: undefined,
        email: undefined,
      } as Record<string, unknown>);

      // Still returns 200 (we don't want to leak info to attackers)
      // but the handler should not process the update
      const res = await agent
        .post("/api/telegram/webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", "wrong-secret")
        .send({ update_id: 1, message: { message_id: 1, chat: { id: 1, type: "private" }, date: 1, text: "/status" } });

      expect(res.status).toBe(200);
    });
  });

  // ─── Admin API ────────────────────────────────────────────────────────────

  describe("Admin API", () => {
    describe("GET /api/telegram/admin/status", () => {
      it("returns status for admin", async () => {
        const res = await adminAgent(orgId).get("/api/telegram/admin/status");
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty("enabled");
        expect(res.body).toHaveProperty("hasToken");
        expect(res.body).toHaveProperty("webhookRegistered");
      });

      it("rejects non-admin", async () => {
        const res = await memberAgent(orgId).get("/api/telegram/admin/status");
        expect(res.status).toBe(403);
      });
    });

    describe("PUT /api/telegram/admin/config", () => {
      it("enables Telegram with a token", async () => {
        const res = await adminAgent(orgId)
          .put("/api/telegram/admin/config")
          .send({ botToken: "123:test-token", enabled: true });
        expect(res.status).toBe(200);
        expect(res.body.enabled).toBe(true);
        expect(res.body.hasToken).toBe(true);

        // Verify the config was saved
        const config = getIntegrationConfig();
        expect(config.telegramEnabled).toBe(true);
        expect(config.telegramBotToken).toBe("123:test-token");
        // Webhook secret should be auto-generated
        expect(config.telegramWebhookSecret).toBeTruthy();
      });

      it("disables Telegram", async () => {
        // Enable first
        setIntegrationConfig({ telegramEnabled: true, telegramBotToken: "123:abc" });

        const res = await adminAgent(orgId)
          .put("/api/telegram/admin/config")
          .send({ enabled: false });
        expect(res.status).toBe(200);
        expect(res.body.enabled).toBe(false);
      });

      it("rejects non-admin", async () => {
        const res = await memberAgent(orgId)
          .put("/api/telegram/admin/config")
          .send({ enabled: true });
        expect(res.status).toBe(403);
      });

      it("rejects invalid fields", async () => {
        const res = await adminAgent(orgId)
          .put("/api/telegram/admin/config")
          .send({ unknownField: "bad" });
        expect(res.status).toBe(400);
      });
    });
  });

  // ─── User API (account linking endpoints) ─────────────────────────────────

  describe("User API", () => {
    it("POST /api/telegram/link-code generates a code when enabled", async () => {
      setIntegrationConfig({ telegramEnabled: true, telegramBotToken: "123:abc" });

      // Need a member agent with the test user's email
      const agent = memberAgent(orgId, "telegram-test@test.com");
      const res = await agent.post("/api/telegram/link-code");
      expect(res.status).toBe(200);
      expect(res.body.code).toMatch(/^\d{6}$/);
      expect(res.body.expiresInMinutes).toBe(10);
    });

    it("POST /api/telegram/link-code fails when disabled", async () => {
      setIntegrationConfig({ telegramEnabled: false });

      const agent = memberAgent(orgId, "telegram-test@test.com");
      const res = await agent.post("/api/telegram/link-code");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("not enabled");
    });

    it("GET /api/telegram/link-status returns unlinked when not linked", async () => {
      setIntegrationConfig({ telegramEnabled: true, telegramBotToken: "123:abc" });

      const agent = memberAgent(orgId, "telegram-test@test.com");
      const res = await agent.get("/api/telegram/link-status");
      expect(res.status).toBe(200);
      expect(res.body.linked).toBe(false);
    });

    it("GET /api/telegram/link-status returns linked info", async () => {
      setIntegrationConfig({ telegramEnabled: true, telegramBotToken: "123:abc" });

      // Link the user first
      const code = generateLinkCode(testUserId);
      verifyLinkCode("telegram-88888", code, "testbot");

      const agent = memberAgent(orgId, "telegram-test@test.com");
      const res = await agent.get("/api/telegram/link-status");
      expect(res.status).toBe(200);
      expect(res.body.linked).toBe(true);
      expect(res.body.telegramUsername).toBe("testbot");
    });

    it("DELETE /api/telegram/unlink removes the link", async () => {
      // Link first
      const code = generateLinkCode(testUserId);
      verifyLinkCode("telegram-66666", code);

      const agent = memberAgent(orgId, "telegram-test@test.com");
      const res = await agent.delete("/api/telegram/unlink");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.wasLinked).toBe(true);

      // Verify unlinked
      const link = getTelegramLink(testUserId);
      expect(link).toBeNull();
    });
  });
});
