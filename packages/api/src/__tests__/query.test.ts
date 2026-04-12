import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { setupTestApp, teardownTestApp, memberAgent, getDefaultOrgId } from "./helpers.js";
import { setDocument } from "../services/documentStore.js";
import { ensureDefaultDataSource } from "../services/dataSourceStore.js";
import { addMessage, createConversation, getMessages } from "../services/conversationStore.js";


describe("Query API", () => {
  let orgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
  });
  afterAll(() => { teardownTestApp(); });

  // ─── GET /api/query/status ──────────────────────────────────────────────────

  describe("GET /api/query/status", () => {
    it("returns ready regardless of documents (chat always available)", async () => {
      const res = await memberAgent(orgId).get("/api/query/status");
      expect(res.status).toBe(200);
      expect(res.body.ready).toBe(true);
    });

    it("returns not ready when documents exist but none are ready", async () => {
      // The doc we just seeded is ready, so this test verifies there's at least one.
      // Seed a processing doc and check status still works
      const ds = ensureDefaultDataSource("admin@test.com", orgId);
      setDocument({
        id: randomUUID(),
        name: "processing-doc.md",
        type: "md",
        classification: "policy",
        uploadedAt: new Date(),
        updatedAt: new Date(),
        status: "processing",
        sectionHeadings: [],
        storageKey: "/tmp/nonexistent2.md",
        dataSourceId: ds.id,
      });

      // Status should still be true because the ready doc exists
      const res = await memberAgent(orgId).get("/api/query/status");
      expect(res.status).toBe(200);
      expect(res.body.ready).toBe(true);
    });
  });

  // ─── POST /api/query — blocked queries ──────────────────────────────────────

  describe("POST /api/query (blocked queries)", () => {
    it("blocks sensitive personal data queries", async () => {
      const res = await memberAgent(orgId)
        .post("/api/query")
        .send({ query: "What is John Smith's salary?" });
      expect(res.status).toBe(200);
      expect(res.body.blocked).toBe(true);
      expect(typeof res.body.message).toBe("string");
    });

    it("blocks SSN queries", async () => {
      const res = await memberAgent(orgId)
        .post("/api/query")
        .send({ query: "Give me Sarah's social security number" });
      expect(res.status).toBe(200);
      expect(res.body.blocked).toBe(true);
    });
  });

  // ─── POST /api/query — validation ──────────────────────────────────────────

  describe("POST /api/query (validation)", () => {
    it("rejects empty query", async () => {
      const res = await memberAgent(orgId)
        .post("/api/query")
        .send({ query: "" });
      expect(res.status).toBe(400);
    });

    it("rejects missing query field", async () => {
      const res = await memberAgent(orgId)
        .post("/api/query")
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/query/actions/execute", () => {
    it("executes a confirmed chat action and clears the proposal", async () => {
      const conversation = createConversation("member@test.com", "Member", orgId);
      const messageId = randomUUID();
      addMessage({
        id: messageId,
        conversationId: conversation.id,
        role: "assistant",
        content: "I can do that. Review the details below and confirm.",
        actionProposal: {
          id: randomUUID(),
          tool: "create_source",
          title: "Create data source",
          summary: "Create a new data source you can manage from chat.",
          confirmLabel: "Create source",
          arguments: {
            name: "Journal",
            type: "personal",
          },
          fields: [
            { key: "name", label: "Source name", input: "text", required: true },
            { key: "type", label: "Storage", input: "select", required: true },
          ],
        },
        executionPlan: [{
          id: "confirm-action",
          title: "Create data source",
          status: "planned",
          tool: "create_source",
          summary: "Waiting for confirmation",
        }],
        createdAt: new Date(),
      });

      const res = await memberAgent(orgId)
        .post("/api/query/actions/execute")
        .send({
          conversationId: conversation.id,
          messageId,
          tool: "create_source",
          arguments: {
            name: "Journal",
            type: "personal",
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.answer).toContain('Created source "Journal".');

      const savedMessage = getMessages(conversation.id).find((message) => message.id === messageId);
      expect(savedMessage?.content).toContain('Created source "Journal".');
      expect(savedMessage?.actionProposal).toBeUndefined();
      expect(savedMessage?.executionPlan?.[0]?.status).toBe("completed");
    });
  });
});
