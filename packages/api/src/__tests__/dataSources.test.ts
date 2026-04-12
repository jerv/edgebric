import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, teardownTestApp, adminAgent, memberAgent, unauthAgent, getDefaultOrgId } from "./helpers.js";

describe("Data Sources API", () => {
  let orgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
  });
  afterAll(() => { teardownTestApp(); });

  describe("POST /api/data-sources", () => {
    it("admin can create a data source", async () => {
      const res = await adminAgent(orgId)
        .post("/api/data-sources")
        .send({ name: "Test Source" });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.name).toBe("Test Source");
      expect(res.body.status).toBe("active");
      expect(res.body.accessMode).toBe("all");
      expect(res.body.allowSourceViewing).toBe(true);
      expect(res.body.allowVaultSync).toBe(true);
    });

    it("rejects empty name", async () => {
      const res = await adminAgent(orgId)
        .post("/api/data-sources")
        .send({ name: "" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "Validation failed");
    });

    it("member without permission cannot create data source", async () => {
      const res = await memberAgent(orgId)
        .post("/api/data-sources")
        .send({ name: "Blocked Source" });

      expect(res.status).toBe(403);
    });

    it("creates data source with restricted access mode", async () => {
      const res = await adminAgent(orgId)
        .post("/api/data-sources")
        .send({
          name: "Restricted Source",
          accessMode: "restricted",
          accessList: ["user1@test.com", "user2@test.com"],
        });

      expect(res.status).toBe(201);
      expect(res.body.accessList).toEqual(["user1@test.com", "user2@test.com"]);
    });
  });

  describe("GET /api/data-sources", () => {
    it("admin sees all data sources", async () => {
      const res = await adminAgent(orgId).get("/api/data-sources");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Should include the default data source + ones we created above
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it("requires authentication", async () => {
      const res = await unauthAgent().get("/api/data-sources");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/data-sources/:id", () => {
    it("returns data source with documents", async () => {
      // Create a data source first
      const createRes = await adminAgent(orgId)
        .post("/api/data-sources")
        .send({ name: "Detail Source" });
      const dsId = createRes.body.id;

      const res = await adminAgent(orgId).get(`/api/data-sources/${dsId}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Detail Source");
      expect(res.body).toHaveProperty("documents");
      expect(Array.isArray(res.body.documents)).toBe(true);
    });

    it("returns 404 for non-existent data source", async () => {
      const res = await adminAgent(orgId).get("/api/data-sources/non-existent-id");
      expect(res.status).toBe(404);
    });

    it("hides restricted data source details from unauthorized members", async () => {
      const createRes = await adminAgent(orgId)
        .post("/api/data-sources")
        .send({
          name: "Restricted Detail Source",
          accessMode: "restricted",
          accessList: ["allowed@test.com"],
        });
      const dsId = createRes.body.id as string;

      const res = await memberAgent(orgId).get(`/api/data-sources/${dsId}`);
      expect(res.status).toBe(404);
    });

    it("blocks member detail view when source document viewing is disabled", async () => {
      const createRes = await adminAgent(orgId)
        .post("/api/data-sources")
        .send({ name: "No View Source" });
      const dsId = createRes.body.id as string;

      await adminAgent(orgId)
        .put(`/api/data-sources/${dsId}`)
        .send({ allowSourceViewing: false });

      const res = await memberAgent(orgId).get(`/api/data-sources/${dsId}`);
      expect(res.status).toBe(403);
    });
  });

  describe("PUT /api/data-sources/:id", () => {
    it("admin can update data source name", async () => {
      const createRes = await adminAgent(orgId)
        .post("/api/data-sources")
        .send({ name: "Original" });
      const dsId = createRes.body.id;

      const res = await adminAgent(orgId)
        .put(`/api/data-sources/${dsId}`)
        .send({ name: "Updated" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated");
    });

    it("admin can toggle security settings", async () => {
      const createRes = await adminAgent(orgId)
        .post("/api/data-sources")
        .send({ name: "Security Test" });
      const dsId = createRes.body.id;

      const res = await adminAgent(orgId)
        .put(`/api/data-sources/${dsId}`)
        .send({
          allowSourceViewing: false,
          allowVaultSync: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.allowSourceViewing).toBe(false);
      expect(res.body.allowVaultSync).toBe(false);
    });

    it("member cannot update data source", async () => {
      const createRes = await adminAgent(orgId)
        .post("/api/data-sources")
        .send({ name: "Admin Only" });
      const dsId = createRes.body.id;

      const res = await memberAgent(orgId)
        .put(`/api/data-sources/${dsId}`)
        .send({ name: "Hacked" });

      expect(res.status).toBe(403);
    });
  });

  describe("Source type", () => {
    it("defaults to organization type when not specified", async () => {
      const res = await adminAgent(orgId)
        .post("/api/data-sources")
        .send({ name: "Default Type" });

      expect(res.status).toBe(201);
      expect(res.body.type).toBe("organization");
    });

    it("can create personal (vault) source", async () => {
      const res = await adminAgent(orgId)
        .post("/api/data-sources")
        .send({ name: "Vault Source", type: "personal" });

      expect(res.status).toBe(201);
      expect(res.body.type).toBe("personal");
    });

    it("admin can change source type", async () => {
      const createRes = await adminAgent(orgId)
        .post("/api/data-sources")
        .send({ name: "Type Change", type: "organization" });
      const dsId = createRes.body.id;

      const res = await adminAgent(orgId)
        .put(`/api/data-sources/${dsId}`)
        .send({ type: "personal" });

      expect(res.status).toBe(200);
      expect(res.body.type).toBe("personal");
    });

    it("rejects invalid type value", async () => {
      const res = await adminAgent(orgId)
        .post("/api/data-sources")
        .send({ name: "Bad Type", type: "invalid" });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/data-sources/:id", () => {
    it("admin can archive a data source", async () => {
      const createRes = await adminAgent(orgId)
        .post("/api/data-sources")
        .send({ name: "To Delete" });
      const dsId = createRes.body.id;

      const res = await adminAgent(orgId)
        .delete(`/api/data-sources/${dsId}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it("member cannot delete data source", async () => {
      const createRes = await adminAgent(orgId)
        .post("/api/data-sources")
        .send({ name: "Protected" });
      const dsId = createRes.body.id;

      const res = await memberAgent(orgId)
        .delete(`/api/data-sources/${dsId}`);

      expect(res.status).toBe(403);
    });
  });
});
