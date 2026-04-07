import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, teardownTestApp, adminAgent, memberAgent, getDefaultOrgId } from "./helpers.js";

describe("Integrations API", () => {
  let orgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
  });
  afterAll(() => { teardownTestApp(); });

  describe("GET /api/admin/integrations", () => {
    it("returns integration config for admin", async () => {
      const res = await adminAgent(orgId).get("/api/admin/integrations");
      expect(res.status).toBe(200);
      expect(typeof res.body).toBe("object");
    });

    it("rejects non-admin requests", async () => {
      const res = await memberAgent(orgId).get("/api/admin/integrations");
      expect(res.status).toBe(403);
    });
  });

  describe("PUT /api/admin/integrations", () => {
    it("updates privateModeEnabled", async () => {
      const res = await adminAgent(orgId)
        .put("/api/admin/integrations")
        .send({ privateModeEnabled: true });
      expect(res.status).toBe(200);
      expect(res.body.privateModeEnabled).toBe(true);
    });

    it("updates vaultModeEnabled", async () => {
      const res = await adminAgent(orgId)
        .put("/api/admin/integrations")
        .send({ vaultModeEnabled: true });
      expect(res.status).toBe(200);
      expect(res.body.vaultModeEnabled).toBe(true);
      // privateModeEnabled should still be true from previous test
      expect(res.body.privateModeEnabled).toBe(true);
    });

    it("updates generalAnswersEnabled", async () => {
      const res = await adminAgent(orgId)
        .put("/api/admin/integrations")
        .send({ generalAnswersEnabled: false });
      expect(res.status).toBe(200);
      expect(res.body.generalAnswersEnabled).toBe(false);
    });

    it("rejects non-admin requests", async () => {
      const res = await memberAgent(orgId)
        .put("/api/admin/integrations")
        .send({ privateModeEnabled: true });
      expect(res.status).toBe(403);
    });

    it("rejects invalid fields", async () => {
      const res = await adminAgent(orgId)
        .put("/api/admin/integrations")
        .send({ privateModeEnabled: "not-a-boolean" });
      expect(res.status).toBe(400);
    });

    it("rejects constructor key via strict schema", async () => {
      const res = await adminAgent(orgId)
        .put("/api/admin/integrations")
        .send({ constructor: "polluted" });
      expect(res.status).toBe(400);
    });

    it("rejects unknown extra keys via strict schema", async () => {
      const res = await adminAgent(orgId)
        .put("/api/admin/integrations")
        .send({ privateModeEnabled: true, randomKey: "injected" });
      expect(res.status).toBe(400);
    });

    it("does not pollute Object.prototype after valid update", async () => {
      // Send a valid body and verify no prototype pollution side effects
      const res = await adminAgent(orgId)
        .put("/api/admin/integrations")
        .send({ privateModeEnabled: false });
      expect(res.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((Object.prototype as any).isAdmin).toBeUndefined();
    });
  });
});
