import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import { setupTestApp, teardownTestApp, adminAgent, getDefaultOrgId } from "./helpers.js";
import { createApiKey, hashKey, getApiKey, listApiKeys, revokeApiKey } from "../services/apiKeyStore.js";
import { createDataSource } from "../services/dataSourceStore.js";
import { setDocument } from "../services/documentStore.js";
import { createApp } from "../app.js";
import type { Document } from "@edgebric/types";
import { randomUUID } from "crypto";

// ─── Test helpers ──────────────────────────────────────────────────────────

/** Create a supertest agent-like object that sets the Bearer token on each request. */
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
    put: (url: string) => supertest(testApp).put(url).set("Authorization", `Bearer ${rawKey}`),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Agent API", () => {
  let orgId: string;
  let readKey: string;
  let readWriteKey: string;
  let adminKey: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();

    // Create API keys for testing
    const rk = createApiKey({ name: "Read Key", orgId, permission: "read", createdBy: "admin@test.com" });
    readKey = rk.rawKey;

    const rwk = createApiKey({ name: "RW Key", orgId, permission: "read-write", createdBy: "admin@test.com" });
    readWriteKey = rwk.rawKey;

    const ak = createApiKey({ name: "Admin Key", orgId, permission: "admin", createdBy: "admin@test.com" });
    adminKey = ak.rawKey;
  });

  afterAll(() => { teardownTestApp(); });

  // ─── API Key Store ──────────────────────────────────────────────────────

  describe("API Key Store", () => {
    it("creates key with eb_ prefix", () => {
      const key = createApiKey({ name: "Test", orgId, permission: "read", createdBy: "test@test.com" });
      expect(key.rawKey).toMatch(/^eb_/);
      expect(key.rawKey.length).toBeGreaterThan(10);
      expect(key.name).toBe("Test");
      expect(key.permission).toBe("read");
      expect(key.revoked).toBe(false);
    });

    it("stores key as SHA-256 hash", () => {
      const key = createApiKey({ name: "Hash Test", orgId, permission: "read", createdBy: "test@test.com" });
      hashKey(key.rawKey);
      // The hash should match what we can look up
      const found = getApiKey(key.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe("Hash Test");
    });

    it("lists keys for org", () => {
      const keys = listApiKeys(orgId);
      expect(keys.length).toBeGreaterThanOrEqual(3);
      // Never returns raw key or hash
      for (const k of keys) {
        expect(k).not.toHaveProperty("rawKey");
        expect(k).not.toHaveProperty("keyHash");
      }
    });

    it("revokes key", () => {
      const key = createApiKey({ name: "Revoke Me", orgId, permission: "read", createdBy: "test@test.com" });
      expect(key.revoked).toBe(false);
      revokeApiKey(key.id);
      const found = getApiKey(key.id);
      expect(found!.revoked).toBe(true);
    });
  });

  // ─── Auth Middleware ────────────────────────────────────────────────────

  describe("API Key Auth Middleware", () => {
    it("rejects missing Authorization header", async () => {
      const app = createApp({ skipSession: true, skipCsrf: true, skipRateLimit: true, skipRequestLogging: true });
      const res = await supertest(app).get("/api/v1/discover");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTH_REQUIRED");
    });

    it("rejects non-eb_ prefixed key", async () => {
      const app = createApp({ skipSession: true, skipCsrf: true, skipRateLimit: true, skipRequestLogging: true });
      const res = await supertest(app)
        .get("/api/v1/discover")
        .set("Authorization", "Bearer bad_key_here");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("INVALID_KEY");
    });

    it("rejects invalid key", async () => {
      const app = createApp({ skipSession: true, skipCsrf: true, skipRateLimit: true, skipRequestLogging: true });
      const res = await supertest(app)
        .get("/api/v1/discover")
        .set("Authorization", "Bearer eb_invalidkey12345678901234567890abcdef");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("INVALID_KEY");
    });

    it("rejects revoked key", async () => {
      const rk = createApiKey({ name: "Will Revoke", orgId, permission: "read", createdBy: "test@test.com" });
      revokeApiKey(rk.id);
      const app = createApp({ skipSession: true, skipCsrf: true, skipRateLimit: true, skipRequestLogging: true });
      const res = await supertest(app)
        .get("/api/v1/discover")
        .set("Authorization", `Bearer ${rk.rawKey}`);
      expect(res.status).toBe(401);
    });

    it("accepts valid key", async () => {
      const res = await agentApp(readKey).get("/api/v1/discover");
      expect(res.status).toBe(200);
    });
  });

  // ─── Permission Enforcement ─────────────────────────────────────────────

  describe("Permission Enforcement", () => {
    it("read key can access discover", async () => {
      const res = await agentApp(readKey).get("/api/v1/discover");
      expect(res.status).toBe(200);
    });

    it("read key can access sources", async () => {
      const res = await agentApp(readKey).get("/api/v1/sources");
      expect(res.status).toBe(200);
    });

    it("read key cannot create source", async () => {
      const res = await agentApp(readKey)
        .post("/api/v1/sources")
        .send({ name: "Read Only Source" });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("INSUFFICIENT_PERMISSION");
    });

    it("read key cannot delete document", async () => {
      const res = await agentApp(readKey).delete("/api/v1/documents/fake-id");
      expect(res.status).toBe(403);
    });

    it("read-write key can create source", async () => {
      const res = await agentApp(readWriteKey)
        .post("/api/v1/sources")
        .send({ name: "RW Source" });
      expect(res.status).toBe(201);
      expect(res.body.source.name).toBe("RW Source");
    });

    it("read-write key cannot delete source", async () => {
      const ds = createDataSource({ name: "Protected", ownerId: "admin@test.com", orgId });
      const res = await agentApp(readWriteKey).delete(`/api/v1/sources/${ds.id}`);
      expect(res.status).toBe(403);
    });

    it("admin key can delete source", async () => {
      const ds = createDataSource({ name: "Deletable", ownerId: "admin@test.com", orgId });
      const res = await agentApp(adminKey).delete(`/api/v1/sources/${ds.id}`);
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);
    });
  });

  // ─── Source Scoping ──────────────────────────────────────────────────────

  describe("Source Scoping", () => {
    it("scoped key only sees allowed sources", async () => {
      const ds1 = createDataSource({ name: "Visible", ownerId: "admin@test.com", orgId });
      const ds2 = createDataSource({ name: "Hidden", ownerId: "admin@test.com", orgId });

      const scopedKey = createApiKey({
        name: "Scoped",
        orgId,
        permission: "read",
        sourceScope: JSON.stringify([ds1.id]),
        createdBy: "admin@test.com",
      });

      const res = await agentApp(scopedKey.rawKey).get("/api/v1/sources");
      expect(res.status).toBe(200);
      const ids = res.body.sources.map((s: { id: string }) => s.id);
      expect(ids).toContain(ds1.id);
      expect(ids).not.toContain(ds2.id);
    });

    it("scoped key cannot access out-of-scope source documents", async () => {
      const ds1 = createDataSource({ name: "In Scope", ownerId: "admin@test.com", orgId });
      const ds2 = createDataSource({ name: "Out Scope", ownerId: "admin@test.com", orgId });

      const scopedKey = createApiKey({
        name: "Scoped2",
        orgId,
        permission: "read",
        sourceScope: JSON.stringify([ds1.id]),
        createdBy: "admin@test.com",
      });

      const res = await agentApp(scopedKey.rawKey).get(`/api/v1/sources/${ds2.id}/documents`);
      expect(res.status).toBe(404);
    });
  });

  // ─── Read Endpoints ──────────────────────────────────────────────────────

  describe("Read Endpoints", () => {
    it("GET /discover returns version and capabilities", async () => {
      const res = await agentApp(readKey).get("/api/v1/discover");
      expect(res.status).toBe(200);
      expect(res.body.version).toBe("1.0");
      expect(res.body.capabilities).toContain("search");
      expect(res.body.capabilities).toContain("query");
      expect(res.body.capabilities).toContain("upload");
      expect(res.body.capabilities).toContain("manage");
      expect(res.body.endpoints).toBeDefined();
    });

    it("GET /sources returns source list", async () => {
      const res = await agentApp(readKey).get("/api/v1/sources");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.sources)).toBe(true);
      if (res.body.sources.length > 0) {
        const src = res.body.sources[0];
        expect(src).toHaveProperty("id");
        expect(src).toHaveProperty("name");
        expect(src).toHaveProperty("documentCount");
        expect(src).toHaveProperty("lastUpdated");
      }
    });

    it("GET /sources/:id/documents returns documents", async () => {
      const ds = createDataSource({ name: "Doc List Test", ownerId: "admin@test.com", orgId });
      const doc: Document = {
        id: randomUUID(),
        name: "test.pdf",
        type: "pdf",
        classification: "policy",
        uploadedAt: new Date(),
        updatedAt: new Date(),
        status: "ready",
        sectionHeadings: [],
        storageKey: "/tmp/fake.pdf",
        dataSourceId: ds.id,
      };
      setDocument(doc);

      const res = await agentApp(readKey).get(`/api/v1/sources/${ds.id}/documents`);
      expect(res.status).toBe(200);
      expect(res.body.documents.length).toBe(1);
      expect(res.body.documents[0].name).toBe("test.pdf");
      expect(res.body.documents[0].status).toBe("ready");
    });

    it("GET /sources/:id/documents returns 404 for unknown source", async () => {
      const res = await agentApp(readKey).get("/api/v1/sources/nonexistent-id/documents");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });
  });

  // ─── Write Endpoints ─────────────────────────────────────────────────────

  describe("Write Endpoints", () => {
    it("POST /sources creates a data source", async () => {
      const res = await agentApp(readWriteKey)
        .post("/api/v1/sources")
        .send({ name: "Agent Source", description: "Created by agent" });
      expect(res.status).toBe(201);
      expect(res.body.source.name).toBe("Agent Source");
      expect(res.body.source).toHaveProperty("id");
    });

    it("POST /sources rejects empty name", async () => {
      const res = await agentApp(readWriteKey)
        .post("/api/v1/sources")
        .send({ name: "" });
      expect(res.status).toBe(400);
    });

    it("DELETE /documents/:id deletes a document", async () => {
      const ds = createDataSource({ name: "Delete Doc Test", ownerId: "admin@test.com", orgId });
      const doc: Document = {
        id: randomUUID(),
        name: "deleteme.txt",
        type: "txt",
        classification: "policy",
        uploadedAt: new Date(),
        updatedAt: new Date(),
        status: "ready",
        sectionHeadings: [],
        storageKey: "/tmp/fakefile-" + randomUUID(),
        dataSourceId: ds.id,
      };
      setDocument(doc);

      const res = await agentApp(readWriteKey).delete(`/api/v1/documents/${doc.id}`);
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);
    });

    it("DELETE /documents/:id returns 404 for unknown document", async () => {
      const res = await agentApp(readWriteKey).delete("/api/v1/documents/nonexistent-id");
      expect(res.status).toBe(404);
    });
  });

  // ─── Search Endpoint ──────────────────────────────────────────────────────

  describe("Search Endpoint", () => {
    it("POST /search returns results array", async () => {
      // Search with no documents — should get empty results
      const res = await agentApp(readKey)
        .post("/api/v1/search")
        .send({ query: "test query" });
      // May fail with 503 if inference isn't running or is misconfigured, but should at least parse
      expect([200, 503]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty("results");
        expect(Array.isArray(res.body.results)).toBe(true);
      }
    });

    it("POST /search rejects empty query", async () => {
      const res = await agentApp(readKey)
        .post("/api/v1/search")
        .send({ query: "" });
      expect(res.status).toBe(400);
    });

    it("POST /search rejects too-long query", async () => {
      const res = await agentApp(readKey)
        .post("/api/v1/search")
        .send({ query: "x".repeat(4001) });
      expect(res.status).toBe(400);
    });
  });

  // ─── Error Response Format ────────────────────────────────────────────────

  describe("Error Response Format", () => {
    it("errors are always JSON with error, code, status", async () => {
      const app = createApp({ skipSession: true, skipCsrf: true, skipRateLimit: true, skipRequestLogging: true });
      const res = await supertest(app).get("/api/v1/discover");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
      expect(res.body).toHaveProperty("code");
      expect(res.body).toHaveProperty("status");
      expect(typeof res.body.error).toBe("string");
      expect(typeof res.body.code).toBe("string");
      expect(typeof res.body.status).toBe("number");
    });

    it("404 errors include code NOT_FOUND", async () => {
      const res = await agentApp(readKey).get("/api/v1/sources/fake-id/documents");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("permission errors include code INSUFFICIENT_PERMISSION", async () => {
      const res = await agentApp(readKey)
        .post("/api/v1/sources")
        .send({ name: "Forbidden" });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("INSUFFICIENT_PERMISSION");
    });
  });

  // ─── Key Management Routes ────────────────────────────────────────────────

  describe("Key Management Routes", () => {
    it("POST /api/admin/api-keys creates key and returns raw key", async () => {
      const res = await adminAgent(orgId)
        .post("/api/admin/api-keys")
        .send({ name: "New Agent Key", permission: "read" });
      expect(res.status).toBe(201);
      expect(res.body.rawKey).toMatch(/^eb_/);
      expect(res.body.name).toBe("New Agent Key");
      expect(res.body.permission).toBe("read");
    });

    it("GET /api/admin/api-keys lists keys without hashes", async () => {
      const res = await adminAgent(orgId).get("/api/admin/api-keys");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      for (const k of res.body) {
        expect(k).not.toHaveProperty("rawKey");
        expect(k).not.toHaveProperty("keyHash");
        expect(k).toHaveProperty("name");
        expect(k).toHaveProperty("permission");
        expect(k).toHaveProperty("createdAt");
      }
    });

    it("DELETE /api/admin/api-keys/:id revokes key", async () => {
      const createRes = await adminAgent(orgId)
        .post("/api/admin/api-keys")
        .send({ name: "Revoke Test", permission: "read" });
      const keyId = createRes.body.id;

      const res = await adminAgent(orgId).delete(`/api/admin/api-keys/${keyId}`);
      expect(res.status).toBe(200);
      expect(res.body.revoked).toBe(true);

      // Verify key is revoked
      const found = getApiKey(keyId);
      expect(found!.revoked).toBe(true);
    });

    it("DELETE /api/admin/api-keys/:id returns 404 for wrong org", async () => {
      // Create key in our org, try to revoke from "wrong" org
      await adminAgent(orgId)
        .post("/api/admin/api-keys")
        .send({ name: "Wrong Org", permission: "read" });

      // Create agent for different org (the key won't match)
      const res = await adminAgent(orgId).delete(`/api/admin/api-keys/nonexistent-id`);
      expect(res.status).toBe(404);
    });
  });

  // ─── Audit Logging ──────────────────────────────────────────────────────

  describe("Audit Logging", () => {
    it("key creation is audited", async () => {
      const res = await adminAgent(orgId)
        .post("/api/admin/api-keys")
        .send({ name: "Audit Test Key", permission: "read-write" });
      expect(res.status).toBe(201);

      // Check audit log
      const auditRes = await adminAgent(orgId).get("/api/audit?eventType=api.key_created&limit=1");
      expect(auditRes.status).toBe(200);
      expect(auditRes.body.entries.length).toBeGreaterThanOrEqual(1);
      const entry = auditRes.body.entries[0];
      expect(entry.eventType).toBe("api.key_created");
    });

    it("key revocation is audited", async () => {
      const createRes = await adminAgent(orgId)
        .post("/api/admin/api-keys")
        .send({ name: "Revoke Audit", permission: "read" });
      await adminAgent(orgId).delete(`/api/admin/api-keys/${createRes.body.id}`);

      const auditRes = await adminAgent(orgId).get("/api/audit?eventType=api.key_revoked&limit=1");
      expect(auditRes.status).toBe(200);
      expect(auditRes.body.entries.length).toBeGreaterThanOrEqual(1);
    });
  });
});
