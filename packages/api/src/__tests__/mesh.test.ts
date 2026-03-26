import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { setupTestApp, teardownTestApp, adminAgent, memberAgent, getDefaultOrgId } from "./helpers.js";

describe("Mesh API", () => {
  let orgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
  });
  afterAll(() => { teardownTestApp(); });

  // ─── Mesh Config ────────────────────────────────────────────────────────────

  describe("GET /api/mesh/config (before init)", () => {
    it("returns unconfigured state", async () => {
      const res = await adminAgent(orgId).get("/api/mesh/config");
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
      expect(res.body.configured).toBe(false);
    });

    it("rejects non-admin requests", async () => {
      const res = await memberAgent(orgId).get("/api/mesh/config");
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/mesh/config", () => {
    it("initializes mesh as primary", async () => {
      const res = await adminAgent(orgId)
        .post("/api/mesh/config")
        .send({ role: "primary", nodeName: "HQ Node" });
      expect(res.status).toBe(201);
      expect(res.body.role).toBe("primary");
      expect(res.body.nodeName).toBe("HQ Node");
      expect(res.body.enabled).toBe(true);
      expect(typeof res.body.nodeId).toBe("string");
      expect(typeof res.body.meshToken).toBe("string");
      expect(res.body.meshToken.length).toBeGreaterThan(8);
    });

    it("requires primaryEndpoint for secondary nodes", async () => {
      const res = await adminAgent(orgId)
        .post("/api/mesh/config")
        .send({ role: "secondary", nodeName: "Branch" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("primary node endpoint");
    });

    it("rejects invalid role", async () => {
      const res = await adminAgent(orgId)
        .post("/api/mesh/config")
        .send({ role: "supernode", nodeName: "Bad" });
      expect(res.status).toBe(400);
    });

    it("rejects empty node name", async () => {
      const res = await adminAgent(orgId)
        .post("/api/mesh/config")
        .send({ role: "primary", nodeName: "" });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/mesh/config (after init)", () => {
    it("returns configured state with truncated token", async () => {
      const res = await adminAgent(orgId).get("/api/mesh/config");
      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      expect(res.body.enabled).toBe(true);
      expect(res.body.role).toBe("primary");
      expect(res.body.nodeName).toBe("HQ Node");
      // Token should be truncated (starts with "...")
      expect(res.body.meshToken).toMatch(/^\.\.\./);
    });
  });

  describe("GET /api/mesh/config/token", () => {
    it("returns full mesh token for admin", async () => {
      const res = await adminAgent(orgId).get("/api/mesh/config/token");
      expect(res.status).toBe(200);
      expect(typeof res.body.meshToken).toBe("string");
      // Full token should NOT start with "..."
      expect(res.body.meshToken).not.toMatch(/^\.\.\./);
    });
  });

  describe("PATCH /api/mesh/config", () => {
    it("updates mesh node name", async () => {
      const res = await adminAgent(orgId)
        .patch("/api/mesh/config")
        .send({ nodeName: "Updated HQ" });
      expect(res.status).toBe(200);
      expect(res.body.nodeName).toBe("Updated HQ");
    });

    it("disables mesh", async () => {
      const res = await adminAgent(orgId)
        .patch("/api/mesh/config")
        .send({ enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });

    it("re-enables mesh", async () => {
      const res = await adminAgent(orgId)
        .patch("/api/mesh/config")
        .send({ enabled: true });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
    });
  });

  describe("POST /api/mesh/config/regenerate-token", () => {
    it("regenerates the mesh token", async () => {
      const before = await adminAgent(orgId).get("/api/mesh/config/token");
      const oldToken = before.body.meshToken;

      const res = await adminAgent(orgId)
        .post("/api/mesh/config/regenerate-token");
      expect(res.status).toBe(200);
      expect(typeof res.body.meshToken).toBe("string");
      expect(res.body.meshToken).not.toBe(oldToken);
    });
  });

  // ─── Mesh Status (available to all users) ───────────────────────────────────

  describe("GET /api/mesh/status", () => {
    it("returns mesh status for member", async () => {
      const res = await memberAgent(orgId).get("/api/mesh/status");
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.role).toBe("primary");
      expect(typeof res.body.connectedNodes).toBe("number");
      expect(typeof res.body.totalNodes).toBe("number");
    });
  });

  describe("GET /api/mesh/query-targets", () => {
    it("returns query targets for member", async () => {
      const res = await memberAgent(orgId).get("/api/mesh/query-targets");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.groups)).toBe(true);
    });
  });

  // ─── Nodes ──────────────────────────────────────────────────────────────────

  describe("Nodes CRUD", () => {
    let nodeId: string;

    it("registers a node", async () => {
      nodeId = randomUUID();
      const res = await adminAgent(orgId)
        .post("/api/mesh/nodes")
        .send({
          id: nodeId,
          name: "Branch Office",
          role: "secondary",
          endpoint: "https://branch.example.com:3001",
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe(nodeId);
      expect(res.body.name).toBe("Branch Office");
      expect(res.body.role).toBe("secondary");
      expect(res.body.endpoint).toBe("https://branch.example.com:3001");
    });

    it("lists nodes", async () => {
      const res = await adminAgent(orgId).get("/api/mesh/nodes");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const node = res.body.find((n: any) => n.id === nodeId);
      expect(node).toBeDefined();
      expect(node.name).toBe("Branch Office");
    });

    it("gets a single node", async () => {
      const res = await adminAgent(orgId).get(`/api/mesh/nodes/${nodeId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(nodeId);
    });

    it("updates a node", async () => {
      const res = await adminAgent(orgId)
        .patch(`/api/mesh/nodes/${nodeId}`)
        .send({ name: "Updated Branch" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated Branch");
    });

    it("returns 404 for non-existent node", async () => {
      const res = await adminAgent(orgId).get(`/api/mesh/nodes/${randomUUID()}`);
      expect(res.status).toBe(404);
    });

    it("rejects node registration with invalid endpoint", async () => {
      const res = await adminAgent(orgId)
        .post("/api/mesh/nodes")
        .send({
          id: randomUUID(),
          name: "Bad Node",
          role: "secondary",
          endpoint: "not-a-url",
        });
      expect(res.status).toBe(400);
    });

    it("removes a node", async () => {
      const res = await adminAgent(orgId).delete(`/api/mesh/nodes/${nodeId}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify it's gone
      const check = await adminAgent(orgId).get(`/api/mesh/nodes/${nodeId}`);
      expect(check.status).toBe(404);
    });

    it("returns 404 when removing non-existent node", async () => {
      const res = await adminAgent(orgId).delete(`/api/mesh/nodes/${randomUUID()}`);
      expect(res.status).toBe(404);
    });

    it("rejects non-admin node requests", async () => {
      const res = await memberAgent(orgId).get("/api/mesh/nodes");
      expect(res.status).toBe(403);
    });
  });

  // ─── Node Groups ────────────────────────────────────────────────────────────

  describe("Node Groups CRUD", () => {
    let groupId: string;

    it("creates a node group", async () => {
      const res = await adminAgent(orgId)
        .post("/api/mesh/groups")
        .send({ name: "Engineering", description: "Dev team nodes", color: "#3B82F6" });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Engineering");
      expect(res.body.description).toBe("Dev team nodes");
      expect(res.body.color).toBe("#3B82F6");
      expect(typeof res.body.id).toBe("string");
      groupId = res.body.id;
    });

    it("lists node groups", async () => {
      const res = await adminAgent(orgId).get("/api/mesh/groups");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const group = res.body.find((g: any) => g.id === groupId);
      expect(group).toBeDefined();
      expect(group.name).toBe("Engineering");
    });

    it("gets a single group", async () => {
      const res = await adminAgent(orgId).get(`/api/mesh/groups/${groupId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(groupId);
      expect(res.body.name).toBe("Engineering");
    });

    it("updates a node group", async () => {
      const res = await adminAgent(orgId)
        .patch(`/api/mesh/groups/${groupId}`)
        .send({ name: "Eng Team", color: "#EF4444" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Eng Team");
      expect(res.body.color).toBe("#EF4444");
    });

    it("returns 404 for non-existent group", async () => {
      const res = await adminAgent(orgId).get(`/api/mesh/groups/${randomUUID()}`);
      expect(res.status).toBe(404);
    });

    it("rejects invalid color format", async () => {
      const res = await adminAgent(orgId)
        .post("/api/mesh/groups")
        .send({ name: "Bad Color", color: "red" });
      expect(res.status).toBe(400);
    });

    it("deletes a node group", async () => {
      const res = await adminAgent(orgId).delete(`/api/mesh/groups/${groupId}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify it's gone
      const check = await adminAgent(orgId).get(`/api/mesh/groups/${groupId}`);
      expect(check.status).toBe(404);
    });

    it("returns 404 when deleting non-existent group", async () => {
      const res = await adminAgent(orgId).delete(`/api/mesh/groups/${randomUUID()}`);
      expect(res.status).toBe(404);
    });

    it("rejects non-admin group requests", async () => {
      const res = await memberAgent(orgId).get("/api/mesh/groups");
      expect(res.status).toBe(403);
    });
  });

  // ─── DELETE /api/mesh/config ────────────────────────────────────────────────

  describe("DELETE /api/mesh/config", () => {
    it("leaves the mesh", async () => {
      const res = await adminAgent(orgId).delete("/api/mesh/config");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("mesh status shows disabled after leaving", async () => {
      const res = await memberAgent(orgId).get("/api/mesh/status");
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });
  });
});
