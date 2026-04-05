import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import { setupTestApp, teardownTestApp, getDefaultOrgId, adminAgent, memberAgent } from "./helpers.js";
import { createApiKey } from "../services/apiKeyStore.js";
import { createDataSource, refreshDocumentCount } from "../services/dataSourceStore.js";
import { setDocument } from "../services/documentStore.js";
import { createWebhook, getWebhook, listWebhooksByOrg, deleteWebhook, getWebhooksForEvent } from "../services/webhookStore.js";
import { getSourceSummary, upsertSourceSummary } from "../services/sourceSummaryStore.js";
import { createApp } from "../app.js";
import type { Document } from "@edgebric/types";
import { randomUUID } from "crypto";

// ─── Test helpers ──────────────────────────────────────────────────────────

function agentApp(rawKey: string) {
  const testApp = createApp({
    skipSession: true,
    skipCsrf: true,
    skipRateLimit: true,
    skipRequestLogging: true,
  });
  return {
    get: (url: string) => supertest(testApp).get(url).set("Authorization", `Bearer ${rawKey}`),
    post: (url: string) => supertest(testApp).post(url).set("Authorization", `Bearer ${rawKey}`),
    delete: (url: string) => supertest(testApp).delete(url).set("Authorization", `Bearer ${rawKey}`),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Agent API Enhancements", () => {
  let orgId: string;
  let readKey: string;
  let readWriteKey: string;
  let adminKey: string;
  let readKeyId: string;
  let readWriteKeyId: string;
  let adminKeyId: string;
  let testSourceId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();

    const rk = createApiKey({ name: "Read Key", orgId, permission: "read", createdBy: "admin@test.com" });
    readKey = rk.rawKey;
    readKeyId = rk.id;

    const rwk = createApiKey({ name: "RW Key", orgId, permission: "read-write", createdBy: "admin@test.com" });
    readWriteKey = rwk.rawKey;
    readWriteKeyId = rwk.id;

    const ak = createApiKey({ name: "Admin Key", orgId, permission: "admin", createdBy: "admin@test.com" });
    adminKey = ak.rawKey;
    adminKeyId = ak.id;

    // Create a test data source with a document
    const ds = createDataSource({ name: "Test Source", ownerId: "admin@test.com", orgId });
    testSourceId = ds.id;
    const doc: Document = {
      id: randomUUID(),
      name: "test-doc.pdf",
      type: "pdf",
      classification: "policy",
      uploadedAt: new Date(),
      updatedAt: new Date(),
      status: "ready",
      sectionHeadings: ["Introduction", "Section 1"],
      storageKey: "/tmp/test-doc.pdf",
      dataSourceId: ds.id,
      datasetName: ds.datasetName,
    };
    setDocument(doc);
    refreshDocumentCount(ds.id);
  });

  afterAll(() => { teardownTestApp(); });

  // ─── Webhook Store ──────────────────────────────────────────────────────

  describe("Webhook Store", () => {
    it("creates a webhook", () => {
      const hook = createWebhook({
        url: "https://example.com/webhook",
        events: ["ingestion.complete"],
        orgId,
        apiKeyId: readWriteKeyId,
      });
      expect(hook.id).toBeDefined();
      expect(hook.url).toBe("https://example.com/webhook");
      expect(hook.events).toEqual(["ingestion.complete"]);
      expect(hook.orgId).toBe(orgId);
    });

    it("retrieves a webhook by ID", () => {
      const hook = createWebhook({
        url: "https://example.com/hook2",
        events: ["ingestion.failed"],
        orgId,
        apiKeyId: readWriteKeyId,
      });
      const found = getWebhook(hook.id);
      expect(found).toBeDefined();
      expect(found!.url).toBe("https://example.com/hook2");
      expect(found!.events).toEqual(["ingestion.failed"]);
    });

    it("lists webhooks by org", () => {
      const hooks = listWebhooksByOrg(orgId);
      expect(hooks.length).toBeGreaterThanOrEqual(2);
    });

    it("deletes a webhook", () => {
      const hook = createWebhook({
        url: "https://example.com/delete-me",
        events: ["ingestion.complete"],
        orgId,
        apiKeyId: readWriteKeyId,
      });
      expect(deleteWebhook(hook.id)).toBe(true);
      expect(getWebhook(hook.id)).toBeUndefined();
    });

    it("returns false for deleting non-existent webhook", () => {
      expect(deleteWebhook("non-existent")).toBe(false);
    });

    it("filters webhooks by event type", () => {
      // Create hooks with different events
      createWebhook({ url: "https://example.com/complete-only", events: ["ingestion.complete"], orgId, apiKeyId: readWriteKeyId });
      createWebhook({ url: "https://example.com/failed-only", events: ["ingestion.failed"], orgId, apiKeyId: readWriteKeyId });
      createWebhook({ url: "https://example.com/both", events: ["ingestion.complete", "ingestion.failed"], orgId, apiKeyId: readWriteKeyId });

      const completeHooks = getWebhooksForEvent(orgId, "ingestion.complete");
      const failedHooks = getWebhooksForEvent(orgId, "ingestion.failed");

      expect(completeHooks.some((h) => h.url.includes("complete-only"))).toBe(true);
      expect(completeHooks.some((h) => h.url.includes("both"))).toBe(true);
      expect(completeHooks.some((h) => h.url === "https://example.com/failed-only")).toBe(false);

      expect(failedHooks.some((h) => h.url.includes("failed-only"))).toBe(true);
      expect(failedHooks.some((h) => h.url.includes("both"))).toBe(true);
    });

    it("rejects invalid events", () => {
      expect(() => createWebhook({
        url: "https://example.com/bad",
        events: ["invalid.event" as "ingestion.complete"],
        orgId,
        apiKeyId: readWriteKeyId,
      })).toThrow("Invalid event");
    });
  });

  // ─── Source Summary Store ──────────────────────────────────────────────

  describe("Source Summary Store", () => {
    it("upserts and retrieves a summary", () => {
      const summary = {
        dataSourceId: testSourceId,
        summary: "Test summary of documents",
        topTopics: ["topic1", "topic2"],
        documentCount: 5,
        generatedAt: new Date().toISOString(),
        sourceUpdatedAt: new Date().toISOString(),
      };
      upsertSourceSummary(summary);

      const found = getSourceSummary(testSourceId);
      expect(found).toBeDefined();
      expect(found!.summary).toBe("Test summary of documents");
      expect(found!.topTopics).toEqual(["topic1", "topic2"]);
      expect(found!.documentCount).toBe(5);
    });

    it("updates existing summary", () => {
      const updated = {
        dataSourceId: testSourceId,
        summary: "Updated summary",
        topTopics: ["new topic"],
        documentCount: 10,
        generatedAt: new Date().toISOString(),
        sourceUpdatedAt: new Date().toISOString(),
      };
      upsertSourceSummary(updated);

      const found = getSourceSummary(testSourceId);
      expect(found!.summary).toBe("Updated summary");
      expect(found!.documentCount).toBe(10);
    });

    it("returns undefined for missing source", () => {
      expect(getSourceSummary("non-existent")).toBeUndefined();
    });
  });

  // ─── Webhook API Endpoints ─────────────────────────────────────────��───

  describe("POST /api/v1/webhooks", () => {
    it("creates webhook with read-write key", async () => {
      const res = await agentApp(readWriteKey)
        .post("/api/v1/webhooks")
        .send({ url: "https://example.com/api-hook", events: ["ingestion.complete"] });
      expect(res.status).toBe(201);
      expect(res.body.webhookId).toBeDefined();
      expect(res.body.url).toBe("https://example.com/api-hook");
      expect(res.body.events).toEqual(["ingestion.complete"]);
    });

    it("rejects with read-only key", async () => {
      const res = await agentApp(readKey)
        .post("/api/v1/webhooks")
        .send({ url: "https://example.com/nope", events: ["ingestion.complete"] });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("INSUFFICIENT_PERMISSION");
    });

    it("rejects invalid URL", async () => {
      const res = await agentApp(readWriteKey)
        .post("/api/v1/webhooks")
        .send({ url: "not-a-url", events: ["ingestion.complete"] });
      expect(res.status).toBe(400);
    });

    it("rejects invalid events", async () => {
      const res = await agentApp(readWriteKey)
        .post("/api/v1/webhooks")
        .send({ url: "https://example.com/test", events: ["bad.event"] });
      expect(res.status).toBe(400);
    });

    it("rejects empty events array", async () => {
      const res = await agentApp(readWriteKey)
        .post("/api/v1/webhooks")
        .send({ url: "https://example.com/test", events: [] });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/webhooks", () => {
    it("lists webhooks with read key", async () => {
      const res = await agentApp(readKey).get("/api/v1/webhooks");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.webhooks)).toBe(true);
      expect(res.body.webhooks.length).toBeGreaterThan(0);
      // Each webhook should have id, url, events, createdAt
      const hook = res.body.webhooks[0];
      expect(hook.id).toBeDefined();
      expect(hook.url).toBeDefined();
      expect(hook.events).toBeDefined();
      expect(hook.createdAt).toBeDefined();
    });
  });

  describe("DELETE /api/v1/webhooks/:id", () => {
    it("deletes webhook with read-write key", async () => {
      // Create one first
      const createRes = await agentApp(readWriteKey)
        .post("/api/v1/webhooks")
        .send({ url: "https://example.com/to-delete", events: ["ingestion.complete"] });
      expect(createRes.status).toBe(201);
      const webhookId = createRes.body.webhookId;

      const deleteRes = await agentApp(readWriteKey).delete(`/api/v1/webhooks/${webhookId}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.deleted).toBe(true);
    });

    it("rejects with read-only key", async () => {
      const createRes = await agentApp(readWriteKey)
        .post("/api/v1/webhooks")
        .send({ url: "https://example.com/protected", events: ["ingestion.failed"] });
      const webhookId = createRes.body.webhookId;

      const res = await agentApp(readKey).delete(`/api/v1/webhooks/${webhookId}`);
      expect(res.status).toBe(403);
    });

    it("returns 404 for non-existent webhook", async () => {
      const res = await agentApp(readWriteKey).delete("/api/v1/webhooks/non-existent");
      expect(res.status).toBe(404);
    });
  });

  // ─── POST /api/v1/ask ──────────────────────────────────────────────────

  describe("POST /api/v1/ask", () => {
    it("rejects empty question", async () => {
      const res = await agentApp(readKey)
        .post("/api/v1/ask")
        .send({ question: "" });
      expect(res.status).toBe(400);
    });

    it("rejects missing question field", async () => {
      const res = await agentApp(readKey)
        .post("/api/v1/ask")
        .send({});
      expect(res.status).toBe(400);
    });

    it("requires read permission", async () => {
      const res = await agentApp(readKey)
        .post("/api/v1/ask")
        .send({ question: "What is the policy?" });
      // Will get 503 (inference unavailable) in test env — that's expected, not 403
      expect([200, 503]).toContain(res.status);
    });

    it("returns 503 when inference is not running", async () => {
      const res = await agentApp(readKey)
        .post("/api/v1/ask")
        .send({ question: "test question" });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("INFERENCE_UNAVAILABLE");
    });
  });

  // ─── GET /api/v1/sources/:id/summary ──────────────────────────────────

  describe("GET /api/v1/sources/:id/summary", () => {
    it("returns cached summary if available", async () => {
      // Pre-cache a summary so the endpoint returns it without calling LLM
      const ds = createDataSource({ name: "Cached Summary Source", ownerId: "admin@test.com", orgId });
      upsertSourceSummary({
        dataSourceId: ds.id,
        summary: "This is a cached summary",
        topTopics: ["policy", "procedures"],
        documentCount: 3,
        generatedAt: new Date().toISOString(),
        sourceUpdatedAt: ds.updatedAt.toISOString(),
      });

      const res = await agentApp(readKey).get(`/api/v1/sources/${ds.id}/summary`);
      expect(res.status).toBe(200);
      expect(res.body.summary).toBe("This is a cached summary");
      expect(res.body.topTopics).toEqual(["policy", "procedures"]);
      expect(res.body.documentCount).toBe(3);
    });

    it("returns 404 for non-existent source", async () => {
      const res = await agentApp(readKey).get("/api/v1/sources/non-existent/summary");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("returns empty summary for source with no documents", async () => {
      const ds = createDataSource({ name: "Empty Source", ownerId: "admin@test.com", orgId });
      const res = await agentApp(readKey).get(`/api/v1/sources/${ds.id}/summary`);
      expect(res.status).toBe(200);
      expect(res.body.summary).toContain("no documents");
      expect(res.body.documentCount).toBe(0);
    });
  });

  // ─── Discover Endpoint (updated capabilities) ──────────────────────────

  describe("GET /api/v1/discover (updated)", () => {
    it("includes new capabilities and endpoints", async () => {
      const res = await agentApp(readKey).get("/api/v1/discover");
      expect(res.status).toBe(200);
      expect(res.body.capabilities).toContain("ask");
      expect(res.body.capabilities).toContain("webhooks");
      expect(res.body.capabilities).toContain("summaries");
      expect(res.body.endpoints.ask).toBe("POST /api/v1/ask");
      expect(res.body.endpoints.sourceSummary).toBe("GET /api/v1/sources/:id/summary");
      expect(res.body.endpoints.webhooks).toBe("POST /api/v1/webhooks");
      expect(res.body.endpoints.deleteWebhook).toBe("DELETE /api/v1/webhooks/:id");
    });
  });

  // ─── Model Capabilities Endpoint ─────────────────────────────────────

  describe("GET /api/admin/models/capabilities", () => {
    it("returns capabilities stub for authenticated user", async () => {
      const res = await adminAgent(orgId).get("/api/admin/models/capabilities");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("vision");
      expect(res.body).toHaveProperty("toolUse");
      expect(res.body).toHaveProperty("reasoning");
      // Stub returns false for all
      expect(res.body.vision).toBe(false);
      expect(res.body.toolUse).toBe(false);
      expect(res.body.reasoning).toBe(false);
    });

    it("returns capabilities for non-admin user too", async () => {
      const res = await memberAgent(orgId).get("/api/admin/models/capabilities");
      expect(res.status).toBe(200);
      expect(res.body.vision).toBe(false);
    });
  });

  // ─── File Upload Query Endpoint ───────────────────────────────────────

  describe("POST /api/query/with-file", () => {
    it("rejects missing query field", async () => {
      const res = await adminAgent(orgId)
        .post("/api/query/with-file")
        .attach("file", Buffer.from("test content"), "test.txt");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Query is required");
    });

    it("rejects missing file", async () => {
      const res = await adminAgent(orgId)
        .post("/api/query/with-file")
        .field("query", "What is this about?");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("No file uploaded");
    });

    it("rejects unsupported file type", async () => {
      const res = await adminAgent(orgId)
        .post("/api/query/with-file")
        .field("query", "test")
        .attach("file", Buffer.from("test"), "test.exe");
      expect(res.status).toBe(400);
    });

    it("processes text file and returns augmented query", async () => {
      const res = await adminAgent(orgId)
        .post("/api/query/with-file")
        .field("query", "Summarize this document")
        .attach("file", Buffer.from("This is test content for the document."), "test.txt");
      expect(res.status).toBe(200);
      expect(res.body.fileType).toBe("document");
      expect(res.body.fileName).toBe("test.txt");
      expect(res.body.augmentedQuery).toContain("test.txt");
      expect(res.body.augmentedQuery).toContain("test content");
    });

    it("processes markdown file", async () => {
      const res = await adminAgent(orgId)
        .post("/api/query/with-file")
        .field("query", "What does this say?")
        .attach("file", Buffer.from("# Hello\n\nThis is markdown content."), "readme.md");
      expect(res.status).toBe(200);
      expect(res.body.fileType).toBe("document");
      expect(res.body.augmentedQuery).toContain("markdown content");
    });

    it("processes image file and returns base64", async () => {
      // Create a minimal 1x1 PNG
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, // 8-bit RGB
      ]);
      const res = await adminAgent(orgId)
        .post("/api/query/with-file")
        .field("query", "What is in this image?")
        .attach("file", pngHeader, "photo.png");
      expect(res.status).toBe(200);
      expect(res.body.fileType).toBe("image");
      expect(res.body.fileName).toBe("photo.png");
      expect(res.body.imageBase64).toMatch(/^data:image\/png;base64,/);
    });
  });

  // ─── Source Scoping for new endpoints ─────────────────────────────────

  describe("Source scoping for webhooks", () => {
    it("scoped key can still create webhooks for their org", async () => {
      // Create a source-scoped key
      const ds = createDataSource({ name: "Scoped Source", ownerId: "admin@test.com", orgId });
      const scopedKey = createApiKey({
        name: "Scoped RW",
        orgId,
        permission: "read-write",
        createdBy: "admin@test.com",
        sourceScope: JSON.stringify([ds.id]),
      });

      const res = await agentApp(scopedKey.rawKey)
        .post("/api/v1/webhooks")
        .send({ url: "https://example.com/scoped", events: ["ingestion.complete"] });
      expect(res.status).toBe(201);
    });
  });
});
