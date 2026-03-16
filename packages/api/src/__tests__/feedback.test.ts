import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { setupTestApp, teardownTestApp, memberAgent, getDefaultOrgId } from "./helpers.js";
import { createConversation, addMessage } from "../services/conversationStore.js";

function seedMessage(conversationId: string, role: "user" | "assistant", content: string) {
  const id = randomUUID();
  addMessage({ id, conversationId, role, content, createdAt: new Date() });
  return { id };
}

describe("Feedback API", () => {
  let orgId: string;
  let convId: string;
  let msgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();

    const conv = createConversation("member@test.com", "Test", orgId);
    convId = conv.id;
    seedMessage(conv.id, "user", "Question?");
    const msg = seedMessage(conv.id, "assistant", "Answer.");
    msgId = msg.id;
  });
  afterAll(() => { teardownTestApp(); });

  describe("POST /api/feedback", () => {
    it("submits thumbs up feedback", async () => {
      const res = await memberAgent(orgId)
        .post("/api/feedback")
        .send({
          conversationId: convId,
          messageId: msgId,
          rating: "up",
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.rating).toBe("up");
    });

    it("rejects duplicate feedback for same message", async () => {
      const res = await memberAgent(orgId)
        .post("/api/feedback")
        .send({
          conversationId: convId,
          messageId: msgId,
          rating: "down",
        });

      expect(res.status).toBe(409);
    });

    it("rejects feedback for non-existent message", async () => {
      const res = await memberAgent(orgId)
        .post("/api/feedback")
        .send({
          conversationId: convId,
          messageId: "non-existent",
          rating: "up",
        });

      expect(res.status).toBe(404);
    });

    it("rejects invalid rating value", async () => {
      const conv = createConversation("member@test.com", "Test", orgId);
      const msg = seedMessage(conv.id, "assistant", "Answer");

      const res = await memberAgent(orgId)
        .post("/api/feedback")
        .send({
          conversationId: conv.id,
          messageId: msg.id,
          rating: "invalid",
        });

      expect(res.status).toBe(400);
    });

    it("thumbs down can include comment", async () => {
      const conv = createConversation("member@test.com", "Test", orgId);
      seedMessage(conv.id, "user", "Q?");
      const msg = seedMessage(conv.id, "assistant", "A.");

      const res = await memberAgent(orgId)
        .post("/api/feedback")
        .send({
          conversationId: conv.id,
          messageId: msg.id,
          rating: "down",
          comment: "Incorrect information",
        });

      expect(res.status).toBe(201);
    });
  });
});
