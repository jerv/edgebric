import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, teardownTestApp, adminAgent, memberAgent, getDefaultOrgId } from "./helpers.js";
import { setIntegrationConfig } from "../services/integrationConfigStore.js";

describe("Sync API", () => {
  let orgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
  });
  afterAll(() => { teardownTestApp(); });

  // ─── Vault mode disabled (default) ──────────────────────────────────────────

  describe("when vault mode is disabled", () => {
    it("GET /api/sync/version returns 403", async () => {
      const res = await memberAgent(orgId).get("/api/sync/version");
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Vault mode is not enabled");
    });

    it("GET /api/sync/chunks returns 403", async () => {
      const res = await memberAgent(orgId).get("/api/sync/chunks");
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Vault mode is not enabled");
    });
  });

  // ─── Vault mode enabled ────────────────────────────────────────────────────

  describe("when vault mode is enabled", () => {
    beforeAll(() => {
      setIntegrationConfig({ vaultModeEnabled: true });
    });

    it("GET /api/sync/version returns version hash and chunk count", async () => {
      const res = await memberAgent(orgId).get("/api/sync/version");
      expect(res.status).toBe(200);
      expect(typeof res.body.version).toBe("string");
      expect(typeof res.body.chunkCount).toBe("number");
      expect(res.body.revoked).toBe(false);
      expect(Array.isArray(res.body.accessibleChunkIds)).toBe(true);
    });

    it("GET /api/sync/chunks returns NDJSON content type", async () => {
      const res = await memberAgent(orgId).get("/api/sync/chunks");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/x-ndjson");
    });

    it("admin can access sync version too", async () => {
      const res = await adminAgent(orgId).get("/api/sync/version");
      expect(res.status).toBe(200);
      expect(typeof res.body.version).toBe("string");
    });

    it("version hash is consistent for same data", async () => {
      const res1 = await memberAgent(orgId).get("/api/sync/version");
      const res2 = await memberAgent(orgId).get("/api/sync/version");
      expect(res1.body.version).toBe(res2.body.version);
      expect(res1.body.chunkCount).toBe(res2.body.chunkCount);
    });
  });
});
