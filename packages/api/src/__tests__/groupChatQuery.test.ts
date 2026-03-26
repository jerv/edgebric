import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, teardownTestApp, memberAgent, getDefaultOrgId } from "./helpers.js";
import {
  createGroupChat,
  addMember,
} from "../services/groupChatStore.js";

describe("Group Chat Query API", () => {
  let orgId: string;
  let chatId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();

    // Create a group chat (creator is auto-added as member)
    const chat = createGroupChat({
      name: "Test Chat",
      creatorEmail: "admin@test.com",
      creatorName: "Admin User",
      orgId,
      expiration: "never",
    });
    chatId = chat.id;
    addMember(chatId, "member@test.com", "Test Member");
  });
  afterAll(() => { teardownTestApp(); });

  // ─── POST /api/group-chats/:id/send ─────────────────────────────────────────

  describe("POST /api/group-chats/:id/send (non-bot messages)", () => {
    it("sends a regular message", async () => {
      const res = await memberAgent(orgId, "member@test.com")
        .post(`/api/group-chats/${chatId}/send`)
        .send({ content: "Hello everyone!" });
      expect(res.status).toBe(200);
      expect(res.body.content).toBe("Hello everyone!");
      expect(res.body.role).toBe("user");
      expect(res.body.authorEmail).toBe("member@test.com");
      expect(typeof res.body.id).toBe("string");
    });

    it("rejects empty message", async () => {
      const res = await memberAgent(orgId, "member@test.com")
        .post(`/api/group-chats/${chatId}/send`)
        .send({ content: "" });
      expect(res.status).toBe(400);
    });

    it("rejects non-member", async () => {
      const res = await memberAgent(orgId, "outsider@test.com")
        .post(`/api/group-chats/${chatId}/send`)
        .send({ content: "I shouldn't be here" });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("not a member");
    });

    it("returns 404 for non-existent chat", async () => {
      const res = await memberAgent(orgId, "member@test.com")
        .post("/api/group-chats/nonexistent-chat/send")
        .send({ content: "Hello" });
      expect(res.status).toBe(404);
    });
  });

  // ─── GET /api/group-chats/:id/stream ────────────────────────────────────────

  describe("GET /api/group-chats/:id/stream", () => {
    it("rejects non-member from SSE stream", async () => {
      const res = await memberAgent(orgId, "outsider@test.com")
        .get(`/api/group-chats/${chatId}/stream`);
      expect(res.status).toBe(403);
    });

    it("returns 404 for non-existent chat stream", async () => {
      const res = await memberAgent(orgId, "member@test.com")
        .get("/api/group-chats/nonexistent-chat/stream");
      expect(res.status).toBe(404);
    });
  });
});
