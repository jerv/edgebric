import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, teardownTestApp, memberAgent, getDefaultOrgId, createAgent } from "./helpers.js";
import { upsertUser, updateUserPermissions } from "../services/userStore.js";
import { createGroupChat, addMember, addMessage } from "../services/groupChatStore.js";

describe("Notifications API", () => {
  let orgId: string;
  let chatId: string;
  const userEmail = "notif-user@test.com";
  const otherEmail = "notif-other@test.com";

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();

    const user = upsertUser({ email: userEmail, name: "Notif User", role: "member", orgId });
    upsertUser({ email: otherEmail, name: "Other User", role: "member", orgId });
    updateUserPermissions(user.id, { canCreateGroupChats: true });

    // Create a group chat with a message
    const chat = createGroupChat({
      name: "Notif Test Chat",
      creatorEmail: userEmail,
      creatorName: "Notif User",
      orgId,
      expiration: "never",
    });
    chatId = chat.id;

    addMember(chatId, otherEmail, "Other User");

    // Add a message so there's something to be "unread"
    addMessage({
      groupChatId: chatId,
      authorEmail: userEmail,
      authorName: "Notif User",
      role: "user",
      content: "Hello group!",
    });
  });
  afterAll(() => { teardownTestApp(); });

  function userAgent() {
    return createAgent({
      email: userEmail,
      isAdmin: false,
      orgId,
      orgSlug: "test-org",
      name: "Notif User",
    });
  }

  function otherAgent() {
    return createAgent({
      email: otherEmail,
      isAdmin: false,
      orgId,
      orgSlug: "test-org",
      name: "Other User",
    });
  }

  // ─── Unread Tracking ───────────────────────────────────────────────────────

  describe("Unread group chats", () => {
    it("returns unread group chat IDs", async () => {
      const res = await otherAgent().get("/api/notifications/unread-group-chats");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("ids");
      expect(Array.isArray(res.body.ids)).toBe(true);
      // Other user hasn't read the chat yet — should be unread
      expect(res.body.ids).toContain(chatId);
    });

    it("mark-read clears unread status", async () => {
      await otherAgent()
        .post("/api/notifications/mark-read-group-chat")
        .send({ groupChatId: chatId });

      const res = await otherAgent().get("/api/notifications/unread-group-chats");
      expect(res.status).toBe(200);
      expect(res.body.ids).not.toContain(chatId);
    });

    it("rejects mark-read without groupChatId", async () => {
      const res = await otherAgent()
        .post("/api/notifications/mark-read-group-chat")
        .send({});
      expect(res.status).toBe(400);
    });
  });

  // ─── Notification Preferences ──────────────────────────────────────────────

  describe("Notification preferences", () => {
    it("returns default notification level", async () => {
      const res = await userAgent()
        .get(`/api/notifications/group-chat-pref/${chatId}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("level");
      expect(["all", "mentions", "none"]).toContain(res.body.level);
    });

    it("can update notification level", async () => {
      const res = await userAgent()
        .put("/api/notifications/group-chat-pref")
        .send({ groupChatId: chatId, level: "mentions" });
      expect(res.status).toBe(200);

      // Verify it persisted
      const getRes = await userAgent()
        .get(`/api/notifications/group-chat-pref/${chatId}`);
      expect(getRes.body.level).toBe("mentions");
    });

    it("can set to none", async () => {
      const res = await userAgent()
        .put("/api/notifications/group-chat-pref")
        .send({ groupChatId: chatId, level: "none" });
      expect(res.status).toBe(200);

      const getRes = await userAgent()
        .get(`/api/notifications/group-chat-pref/${chatId}`);
      expect(getRes.body.level).toBe("none");
    });

    it("rejects invalid level", async () => {
      const res = await userAgent()
        .put("/api/notifications/group-chat-pref")
        .send({ groupChatId: chatId, level: "invalid" });
      expect(res.status).toBe(400);
    });
  });

  // ─── General Notifications ────────────────────────────────────────────────

  describe("GET /api/notifications", () => {
    it("returns notification list", async () => {
      const res = await userAgent().get("/api/notifications");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("GET /api/notifications/unread-count", () => {
    it("returns unread count", async () => {
      const res = await userAgent().get("/api/notifications/unread-count");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("count");
      expect(typeof res.body.count).toBe("number");
    });
  });
});
