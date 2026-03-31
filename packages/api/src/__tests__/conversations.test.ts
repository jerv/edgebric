import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { setupTestApp, teardownTestApp, adminAgent, memberAgent, getDefaultOrgId } from "./helpers.js";
import { createConversation, addMessage } from "../services/conversationStore.js";

function seedMessage(conversationId: string, role: "user" | "assistant", content: string) {
  addMessage({
    id: randomUUID(),
    conversationId,
    role,
    content,
    createdAt: new Date(),
  });
}

describe("Conversations API", () => {
  let orgId: string;
  let convId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();

    // Seed a conversation (email, userName, orgId)
    const conv = createConversation("member@test.com", "Test User", orgId);
    convId = conv.id;
    seedMessage(conv.id, "user", "What is the PTO policy?");
    seedMessage(conv.id, "assistant", "You get 15 days of PTO per year.");
  });
  afterAll(() => { teardownTestApp(); });

  describe("GET /api/conversations", () => {
    it("returns user's conversations with expected structure", async () => {
      const res = await memberAgent(orgId).get("/api/conversations");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      // Verify conversation structure
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conv = res.body.find((c: any) => c.id === convId);
      expect(conv).toBeDefined();
      expect(conv.userEmail).toBe("member@test.com");
      expect(typeof conv.createdAt).toBe("string");
    });

    it("admin sees their own conversations (not all)", async () => {
      const res = await adminAgent(orgId).get("/api/conversations");
      expect(res.status).toBe(200);
      // Admin has no conversations — should be empty
      expect(res.body).toEqual([]);
    });
  });

  describe("GET /api/conversations/:id", () => {
    it("owner can view their conversation with messages", async () => {
      const res = await memberAgent(orgId).get(`/api/conversations/${convId}`);
      expect(res.status).toBe(200);
      expect(res.body.conversation.id).toBe(convId);
      expect(res.body.messages).toHaveLength(2);
      // Verify message ordering and content
      expect(res.body.messages[0].role).toBe("user");
      expect(res.body.messages[0].content).toBe("What is the PTO policy?");
      expect(res.body.messages[1].role).toBe("assistant");
      expect(res.body.messages[1].content).toBe("You get 15 days of PTO per year.");
    });

    it("admin can view any conversation", async () => {
      const res = await adminAgent(orgId).get(`/api/conversations/${convId}`);
      expect(res.status).toBe(200);
      expect(res.body.conversation.id).toBe(convId);
    });

    it("other user cannot view conversation", async () => {
      const res = await memberAgent(orgId, "other@test.com").get(`/api/conversations/${convId}`);
      expect(res.status).toBe(403);
    });

    it("returns 404 for non-existent conversation", async () => {
      const res = await memberAgent(orgId).get("/api/conversations/non-existent");
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/conversations/:id", () => {
    it("owner can archive their conversation", async () => {
      const conv = createConversation("member@test.com", "Test", orgId);
      const res = await memberAgent(orgId)
        .delete(`/api/conversations/${conv.id}?mode=archive`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("requires mode query param", async () => {
      const conv = createConversation("member@test.com", "Test", orgId);
      const res = await memberAgent(orgId)
        .delete(`/api/conversations/${conv.id}`);
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/conversations (bulk)", () => {
    it("archives all user conversations", async () => {
      createConversation("member@test.com", "Test", orgId);
      createConversation("member@test.com", "Test", orgId);

      const res = await memberAgent(orgId)
        .delete("/api/conversations?mode=archive");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.count).toBeGreaterThanOrEqual(2);
    });
  });

  describe("GET /api/conversations/archived", () => {
    it("returns archived conversations", async () => {
      const conv = createConversation("member@test.com", "Test", orgId);
      seedMessage(conv.id, "user", "Archived question");
      // Archive it
      await memberAgent(orgId).delete(`/api/conversations/${conv.id}?mode=archive`);

      const res = await memberAgent(orgId).get("/api/conversations/archived");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const found = res.body.find((c: any) => c.id === conv.id);
      expect(found).toBeDefined();
      expect(found.archivedAt).toBeDefined();
    });
  });

  describe("POST /api/conversations/:id/restore", () => {
    it("restores an archived conversation", async () => {
      const conv = createConversation("member@test.com", "Test", orgId);
      seedMessage(conv.id, "user", "Restoring this");
      await memberAgent(orgId).delete(`/api/conversations/${conv.id}?mode=archive`);

      const restoreRes = await memberAgent(orgId).post(`/api/conversations/${conv.id}/restore`);
      expect(restoreRes.status).toBe(200);
      expect(restoreRes.body.ok).toBe(true);

      // Should now appear in main list, not archived
      const listRes = await memberAgent(orgId).get("/api/conversations");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const found = listRes.body.find((c: any) => c.id === conv.id);
      expect(found).toBeDefined();
    });

    it("returns 400 for non-archived conversation", async () => {
      const conv = createConversation("member@test.com", "Test", orgId);
      const res = await memberAgent(orgId).post(`/api/conversations/${conv.id}/restore`);
      expect(res.status).toBe(400);
    });

    it("returns 403 for other user", async () => {
      const conv = createConversation("member@test.com", "Test", orgId);
      await memberAgent(orgId).delete(`/api/conversations/${conv.id}?mode=archive`);
      const res = await memberAgent(orgId, "other@test.com").post(`/api/conversations/${conv.id}/restore`);
      expect(res.status).toBe(403);
    });
  });
});
