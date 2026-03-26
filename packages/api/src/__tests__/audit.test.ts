import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, teardownTestApp, adminAgent, memberAgent, getDefaultOrgId } from "./helpers.js";
import { recordAuditEvent } from "../services/auditLog.js";

describe("Audit API", () => {
  let orgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();

    // Seed audit events for testing
    recordAuditEvent({
      eventType: "auth.login",
      actorEmail: "admin@test.com",
      actorIp: "127.0.0.1",
    });
    recordAuditEvent({
      eventType: "document.upload",
      actorEmail: "admin@test.com",
      actorIp: "127.0.0.1",
      resourceType: "document",
      resourceId: "doc-1",
      details: { filename: "handbook.pdf", size: 1024 },
    });
    recordAuditEvent({
      eventType: "query.execute",
      actorEmail: "member@test.com",
      actorIp: "192.168.1.5",
    });
  });
  afterAll(() => { teardownTestApp(); });

  describe("GET /api/audit", () => {
    it("returns audit entries for admin", async () => {
      const res = await adminAgent(orgId).get("/api/audit");
      expect(res.status).toBe(200);
      expect(res.body.entries).toBeDefined();
      expect(Array.isArray(res.body.entries)).toBe(true);
      expect(res.body.entries.length).toBeGreaterThanOrEqual(3);
      expect(typeof res.body.total).toBe("number");
      expect(res.body.total).toBeGreaterThanOrEqual(3);
    });

    it("rejects non-admin requests", async () => {
      const res = await memberAgent(orgId).get("/api/audit");
      expect(res.status).toBe(403);
    });

    it("filters by eventType", async () => {
      const res = await adminAgent(orgId).get("/api/audit?eventType=auth.login");
      expect(res.status).toBe(200);
      for (const entry of res.body.entries) {
        expect(entry.eventType).toBe("auth.login");
      }
      expect(res.body.entries.length).toBeGreaterThanOrEqual(1);
    });

    it("filters by actorEmail", async () => {
      const res = await adminAgent(orgId).get("/api/audit?actorEmail=member@test.com");
      expect(res.status).toBe(200);
      for (const entry of res.body.entries) {
        expect(entry.actorEmail).toBe("member@test.com");
      }
    });

    it("supports pagination with limit and offset", async () => {
      const res = await adminAgent(orgId).get("/api/audit?limit=1&offset=0");
      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(1);
      expect(res.body.total).toBeGreaterThanOrEqual(3);
    });

    it("entries contain required fields", async () => {
      const res = await adminAgent(orgId).get("/api/audit?limit=1");
      const entry = res.body.entries[0];
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.timestamp).toBe("string");
      expect(typeof entry.eventType).toBe("string");
      expect(typeof entry.hash).toBe("string");
      expect(entry.hash.length).toBe(64); // SHA-256 hex
      expect(typeof entry.prevHash).toBe("string");
    });
  });

  describe("GET /api/audit/stats", () => {
    it("returns event counts by type", async () => {
      const res = await adminAgent(orgId).get("/api/audit/stats");
      expect(res.status).toBe(200);
      expect(typeof res.body).toBe("object");
      expect(res.body["auth.login"]).toBeGreaterThanOrEqual(1);
      expect(res.body["document.upload"]).toBeGreaterThanOrEqual(1);
      expect(res.body["query.execute"]).toBeGreaterThanOrEqual(1);
    });

    it("rejects non-admin requests", async () => {
      const res = await memberAgent(orgId).get("/api/audit/stats");
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/audit/verify", () => {
    it("reports valid chain for untampered log", async () => {
      const res = await adminAgent(orgId).get("/api/audit/verify");
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.totalEntries).toBeGreaterThanOrEqual(3);
      expect(res.body).not.toHaveProperty("brokenAt");
    });

    it("rejects non-admin requests", async () => {
      const res = await memberAgent(orgId).get("/api/audit/verify");
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/audit/export", () => {
    it("exports CSV with correct headers", async () => {
      const res = await adminAgent(orgId).get("/api/audit/export");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("edgebric-audit-log.csv");
      const lines = res.text.split("\n");
      expect(lines[0]).toBe("timestamp,event_type,actor_email,actor_ip,resource_type,resource_id,details,hash");
      expect(lines.length).toBeGreaterThanOrEqual(2); // header + at least 1 row
    });

    it("exports JSON when format=json", async () => {
      const res = await adminAgent(orgId).get("/api/audit/export?format=json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(3);
    });

    it("rejects non-admin requests", async () => {
      const res = await memberAgent(orgId).get("/api/audit/export");
      expect(res.status).toBe(403);
    });
  });
});
