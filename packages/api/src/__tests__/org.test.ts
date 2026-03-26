import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, teardownTestApp, adminAgent, memberAgent, getDefaultOrgId } from "./helpers.js";
import { inviteUser } from "../services/userStore.js";

describe("Org API", () => {
  let orgId: string;
  let invitedUserId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();

    // Seed a member user for role/permission tests
    const user = inviteUser({
      email: "invited@test.com",
      role: "member",
      orgId,
      invitedBy: "admin@test.com",
    });
    invitedUserId = user.id;
  });
  afterAll(() => { teardownTestApp(); });

  describe("GET /api/admin/org", () => {
    it("returns org details for admin", async () => {
      const res = await adminAgent(orgId).get("/api/admin/org");
      expect(res.status).toBe(200);
      expect(typeof res.body.id).toBe("string");
      expect(typeof res.body.name).toBe("string");
      expect(typeof res.body.slug).toBe("string");
    });

    it("rejects non-admin requests", async () => {
      const res = await memberAgent(orgId).get("/api/admin/org");
      expect(res.status).toBe(403);
    });
  });

  describe("PUT /api/admin/org", () => {
    it("updates org name", async () => {
      const res = await adminAgent(orgId)
        .put("/api/admin/org")
        .send({ name: "Updated Org Name" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated Org Name");
    });

    it("rejects empty name", async () => {
      const res = await adminAgent(orgId)
        .put("/api/admin/org")
        .send({ name: "" });
      expect(res.status).toBe(400);
    });

    it("rejects non-admin requests", async () => {
      const res = await memberAgent(orgId)
        .put("/api/admin/org")
        .send({ name: "Hacked" });
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/admin/org/complete-onboarding", () => {
    it("marks onboarding as complete", async () => {
      const res = await adminAgent(orgId)
        .post("/api/admin/org/complete-onboarding");
      expect(res.status).toBe(200);
      expect(res.body.settings.onboardingComplete).toBe(true);
    });
  });

  describe("GET /api/admin/org/members", () => {
    it("lists org members", async () => {
      const res = await adminAgent(orgId).get("/api/admin/org/members");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      // Verify member structure
      const member = res.body.find((m: any) => m.email === "invited@test.com");
      expect(member).toBeDefined();
      expect(member.role).toBe("member");
      expect(member.status).toBe("invited");
    });
  });

  describe("POST /api/admin/org/members/invite", () => {
    it("invites a new user", async () => {
      const res = await adminAgent(orgId)
        .post("/api/admin/org/members/invite")
        .send({ email: "newuser@test.com", role: "member" });
      expect(res.status).toBe(201);
      expect(res.body.email).toBe("newuser@test.com");
      expect(res.body.role).toBe("member");
      expect(res.body.status).toBe("invited");
    });

    it("rejects duplicate invite", async () => {
      const res = await adminAgent(orgId)
        .post("/api/admin/org/members/invite")
        .send({ email: "invited@test.com", role: "member" });
      expect(res.status).toBe(409);
    });

    it("rejects invalid email", async () => {
      const res = await adminAgent(orgId)
        .post("/api/admin/org/members/invite")
        .send({ email: "not-an-email", role: "member" });
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/org/members/:id/role", () => {
    it("changes member role", async () => {
      const res = await adminAgent(orgId)
        .patch(`/api/admin/org/members/${invitedUserId}/role`)
        .send({ role: "admin" });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("admin");
    });

    it("prevents admin from changing own role", async () => {
      // First get the admin's user ID
      const members = await adminAgent(orgId).get("/api/admin/org/members");
      const admin = members.body.find((m: any) => m.email === "admin@test.com");
      if (admin) {
        const res = await adminAgent(orgId)
          .patch(`/api/admin/org/members/${admin.id}/role`)
          .send({ role: "member" });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain("cannot change your own role");
      }
    });

    it("rejects invalid role", async () => {
      const res = await adminAgent(orgId)
        .patch(`/api/admin/org/members/${invitedUserId}/role`)
        .send({ role: "superadmin" });
      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent user", async () => {
      const res = await adminAgent(orgId)
        .patch("/api/admin/org/members/nonexistent/role")
        .send({ role: "member" });
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/admin/org/members/:id/permissions", () => {
    it("grants data source creation permission", async () => {
      const res = await adminAgent(orgId)
        .patch(`/api/admin/org/members/${invitedUserId}/permissions`)
        .send({ canCreateDataSources: true });
      expect(res.status).toBe(200);
      expect(res.body.canCreateDataSources).toBe(true);
    });

    it("grants group chat creation permission", async () => {
      const res = await adminAgent(orgId)
        .patch(`/api/admin/org/members/${invitedUserId}/permissions`)
        .send({ canCreateGroupChats: true });
      expect(res.status).toBe(200);
      expect(res.body.canCreateGroupChats).toBe(true);
    });
  });

  describe("DELETE /api/admin/org/members/:id", () => {
    it("removes a member", async () => {
      // Invite a throwaway user to delete
      const invite = await adminAgent(orgId)
        .post("/api/admin/org/members/invite")
        .send({ email: "deleteme@test.com" });
      const userId = invite.body.id;

      const res = await adminAgent(orgId)
        .delete(`/api/admin/org/members/${userId}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("prevents admin from removing themselves", async () => {
      const members = await adminAgent(orgId).get("/api/admin/org/members");
      const admin = members.body.find((m: any) => m.email === "admin@test.com");
      if (admin) {
        const res = await adminAgent(orgId)
          .delete(`/api/admin/org/members/${admin.id}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain("cannot remove yourself");
      }
    });

    it("returns 404 for non-existent user", async () => {
      const res = await adminAgent(orgId)
        .delete("/api/admin/org/members/nonexistent");
      expect(res.status).toBe(404);
    });
  });
});
