import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { setupTestApp, teardownTestApp, adminAgent, memberAgent, getDefaultOrgId } from "./helpers.js";
import { createConversation, addMessage } from "../services/conversationStore.js";
import { createTarget } from "../services/escalationTargetStore.js";

function seedMessage(conversationId: string, role: "user" | "assistant", content: string) {
  const id = randomUUID();
  addMessage({ id, conversationId, role, content, createdAt: new Date() });
  return { id };
}

describe("Escalations API", () => {
  let orgId: string;
  let targetId: string;
  let convId: string;
  let msgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();

    // Seed an escalation target
    const target = createTarget({
      name: "HR Manager",
      role: "HR",
      email: "hr@test.com",
      orgId,
    });
    targetId = target.id;

    // Seed a conversation + messages
    const conv = createConversation("member@test.com", "Test", orgId);
    convId = conv.id;
    seedMessage(conv.id, "user", "How many vacation days?");
    const msg = seedMessage(conv.id, "assistant", "I'm not sure about that.");
    msgId = msg.id;
  });
  afterAll(() => { teardownTestApp(); });

  describe("GET /api/escalation-targets", () => {
    it("returns empty when no integrations configured", async () => {
      // Targets are filtered to only those with working notification methods
      // With no Slack/email configured, all targets are filtered out
      const res = await memberAgent(orgId).get("/api/escalation-targets");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toEqual([]);
    });
  });

  describe("POST /api/escalate", () => {
    it("creates an escalation", async () => {
      const res = await memberAgent(orgId)
        .post("/api/escalate")
        .send({
          question: "How many vacation days?",
          aiAnswer: "I'm not sure about that.",
          conversationId: convId,
          messageId: msgId,
          targetId,
          method: "email",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id");
      // Status is "logged" (not "sent") since email integration isn't configured
      expect(res.body.status).toBe("logged");
    });

    it("rejects with invalid target", async () => {
      const res = await memberAgent(orgId)
        .post("/api/escalate")
        .send({
          question: "Test",
          aiAnswer: "Test",
          conversationId: convId,
          messageId: msgId,
          targetId: "non-existent",
          method: "email",
        });

      expect(res.status).toBe(404);
    });

    it("validates required fields", async () => {
      const res = await memberAgent(orgId)
        .post("/api/escalate")
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("Admin escalation management", () => {
    it("admin can list all escalations", async () => {
      const res = await adminAgent(orgId).get("/api/admin/escalations");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("member cannot access admin escalation routes", async () => {
      const res = await memberAgent(orgId).get("/api/admin/escalations");
      expect(res.status).toBe(403);
    });
  });

  describe("Admin target management", () => {
    it("admin can create a target", async () => {
      const res = await adminAgent(orgId)
        .post("/api/admin/targets")
        .send({
          name: "IT Support",
          role: "IT",
          email: "it@test.com",
        });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe("IT Support");
    });

    it("admin can update a target", async () => {
      const res = await adminAgent(orgId)
        .put(`/api/admin/targets/${targetId}`)
        .send({ name: "Senior HR Manager" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Senior HR Manager");
    });

    it("admin can delete a target", async () => {
      const newTarget = createTarget({ name: "Temp", email: "temp@test.com", orgId });
      const res = await adminAgent(orgId)
        .delete(`/api/admin/targets/${newTarget.id}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("rejects target without contact method", async () => {
      const res = await adminAgent(orgId)
        .post("/api/admin/targets")
        .send({ name: "No Contact" });

      expect(res.status).toBe(400);
    });
  });
});
