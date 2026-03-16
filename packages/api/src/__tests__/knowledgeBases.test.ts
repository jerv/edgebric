import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, teardownTestApp, adminAgent, memberAgent, unauthAgent, getDefaultOrgId } from "./helpers.js";

describe("Knowledge Bases API", () => {
  let orgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
  });
  afterAll(() => { teardownTestApp(); });

  describe("POST /api/knowledge-bases", () => {
    it("admin can create a KB", async () => {
      const res = await adminAgent(orgId)
        .post("/api/knowledge-bases")
        .send({ name: "Test KB" });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.name).toBe("Test KB");
      expect(res.body.status).toBe("active");
      expect(res.body.accessMode).toBe("all");
      expect(res.body.allowSourceViewing).toBe(true);
      expect(res.body.allowVaultSync).toBe(true);
      expect(res.body.allowExternalAccess).toBe(true);
    });

    it("rejects empty name", async () => {
      const res = await adminAgent(orgId)
        .post("/api/knowledge-bases")
        .send({ name: "" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "Validation failed");
    });

    it("member without permission cannot create KB", async () => {
      const res = await memberAgent(orgId)
        .post("/api/knowledge-bases")
        .send({ name: "Blocked KB" });

      expect(res.status).toBe(403);
    });

    it("creates KB with restricted access mode", async () => {
      const res = await adminAgent(orgId)
        .post("/api/knowledge-bases")
        .send({
          name: "Restricted KB",
          accessMode: "restricted",
          accessList: ["user1@test.com", "user2@test.com"],
        });

      expect(res.status).toBe(201);
      expect(res.body.accessList).toEqual(["user1@test.com", "user2@test.com"]);
    });
  });

  describe("GET /api/knowledge-bases", () => {
    it("admin sees all KBs", async () => {
      const res = await adminAgent(orgId).get("/api/knowledge-bases");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Should include the default KB + ones we created above
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it("requires authentication", async () => {
      const res = await unauthAgent().get("/api/knowledge-bases");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/knowledge-bases/:id", () => {
    it("returns KB with documents", async () => {
      // Create a KB first
      const createRes = await adminAgent(orgId)
        .post("/api/knowledge-bases")
        .send({ name: "Detail KB" });
      const kbId = createRes.body.id;

      const res = await adminAgent(orgId).get(`/api/knowledge-bases/${kbId}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Detail KB");
      expect(res.body).toHaveProperty("documents");
      expect(Array.isArray(res.body.documents)).toBe(true);
    });

    it("returns 404 for non-existent KB", async () => {
      const res = await adminAgent(orgId).get("/api/knowledge-bases/non-existent-id");
      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/knowledge-bases/:id", () => {
    it("admin can update KB name", async () => {
      const createRes = await adminAgent(orgId)
        .post("/api/knowledge-bases")
        .send({ name: "Original" });
      const kbId = createRes.body.id;

      const res = await adminAgent(orgId)
        .put(`/api/knowledge-bases/${kbId}`)
        .send({ name: "Updated" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated");
    });

    it("admin can toggle security settings", async () => {
      const createRes = await adminAgent(orgId)
        .post("/api/knowledge-bases")
        .send({ name: "Security Test" });
      const kbId = createRes.body.id;

      const res = await adminAgent(orgId)
        .put(`/api/knowledge-bases/${kbId}`)
        .send({
          allowSourceViewing: false,
          allowVaultSync: false,
          allowExternalAccess: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.allowSourceViewing).toBe(false);
      expect(res.body.allowVaultSync).toBe(false);
      expect(res.body.allowExternalAccess).toBe(false);
    });

    it("member cannot update KB", async () => {
      const createRes = await adminAgent(orgId)
        .post("/api/knowledge-bases")
        .send({ name: "Admin Only" });
      const kbId = createRes.body.id;

      const res = await memberAgent(orgId)
        .put(`/api/knowledge-bases/${kbId}`)
        .send({ name: "Hacked" });

      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/knowledge-bases/:id", () => {
    it("admin can archive a KB", async () => {
      const createRes = await adminAgent(orgId)
        .post("/api/knowledge-bases")
        .send({ name: "To Delete" });
      const kbId = createRes.body.id;

      const res = await adminAgent(orgId)
        .delete(`/api/knowledge-bases/${kbId}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it("member cannot delete KB", async () => {
      const createRes = await adminAgent(orgId)
        .post("/api/knowledge-bases")
        .send({ name: "Protected" });
      const kbId = createRes.body.id;

      const res = await memberAgent(orgId)
        .delete(`/api/knowledge-bases/${kbId}`);

      expect(res.status).toBe(403);
    });
  });
});
