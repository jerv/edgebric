import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  setupTestApp,
  teardownTestApp,
  adminAgent,
  memberAgent,
  getDefaultOrgId,
} from "./helpers.js";
import {
  initMeshConfig,
  deleteMeshConfig,
  createNodeGroup,
  deleteNodeGroup,
} from "../services/nodeRegistry.js";
import {
  getUserGroups,
  getUserGroupIds,
  assignUserToGroup,
  removeUserFromGroup,
  removeAllUserGroups,
  setUserGroups,
  getGroupMembers,
} from "../services/userMeshGroupStore.js";

describe("User Mesh Group Store", () => {
  let orgId: string;
  let groupId1: string;
  let groupId2: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
    initMeshConfig({ role: "primary", nodeName: "test-primary", orgId });
  });

  afterAll(() => {
    try { deleteMeshConfig(); } catch { /* may not exist */ }
    teardownTestApp();
  });

  beforeEach(() => {
    // Create fresh groups for each test
    const g1 = createNodeGroup({ name: "Group A", orgId });
    const g2 = createNodeGroup({ name: "Group B", orgId });
    groupId1 = g1.id;
    groupId2 = g2.id;
  });

  // ─── assignUserToGroup ──────────────────────────────────────────────────

  describe("assignUserToGroup", () => {
    it("assigns a user to a group and returns the assignment", () => {
      const result = assignUserToGroup({
        userId: "user-1",
        groupId: groupId1,
        orgId,
        assignedBy: "admin@test.com",
      });
      expect(result).not.toBeNull();
      expect(result!.userId).toBe("user-1");
      expect(result!.groupId).toBe(groupId1);
      expect(result!.groupName).toBe("Group A");
      expect(result!.assignedBy).toBe("admin@test.com");
    });

    it("returns null if already assigned (idempotent)", () => {
      assignUserToGroup({ userId: "user-dup", groupId: groupId1, orgId, assignedBy: "admin@test.com" });
      const dup = assignUserToGroup({ userId: "user-dup", groupId: groupId1, orgId, assignedBy: "admin@test.com" });
      expect(dup).toBeNull();
    });

    it("allows same user in multiple groups", () => {
      assignUserToGroup({ userId: "multi-user", groupId: groupId1, orgId, assignedBy: "admin@test.com" });
      const second = assignUserToGroup({ userId: "multi-user", groupId: groupId2, orgId, assignedBy: "admin@test.com" });
      expect(second).not.toBeNull();
      expect(second!.groupId).toBe(groupId2);
    });
  });

  // ─── getUserGroups / getUserGroupIds ─────────────────────────────────────

  describe("getUserGroups", () => {
    it("returns all groups for a user", () => {
      assignUserToGroup({ userId: "full-user", groupId: groupId1, orgId, assignedBy: "admin@test.com" });
      assignUserToGroup({ userId: "full-user", groupId: groupId2, orgId, assignedBy: "admin@test.com" });

      const groups = getUserGroups("full-user");
      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.groupId).sort()).toEqual([groupId1, groupId2].sort());
    });

    it("returns empty array for user with no groups", () => {
      const groups = getUserGroups("no-groups-user");
      expect(groups).toHaveLength(0);
    });
  });

  describe("getUserGroupIds", () => {
    it("returns just the group IDs", () => {
      assignUserToGroup({ userId: "id-user", groupId: groupId1, orgId, assignedBy: "admin@test.com" });
      const ids = getUserGroupIds("id-user");
      expect(ids).toEqual([groupId1]);
    });
  });

  // ─── removeUserFromGroup ────────────────────────────────────────────────

  describe("removeUserFromGroup", () => {
    it("removes a user from a group", () => {
      assignUserToGroup({ userId: "rm-user", groupId: groupId1, orgId, assignedBy: "admin@test.com" });
      const removed = removeUserFromGroup("rm-user", groupId1);
      expect(removed).toBe(true);
      expect(getUserGroupIds("rm-user")).toHaveLength(0);
    });

    it("returns false if user was not in the group", () => {
      const removed = removeUserFromGroup("nonexistent-user", groupId1);
      expect(removed).toBe(false);
    });
  });

  // ─── removeAllUserGroups ────────────────────────────────────────────────

  describe("removeAllUserGroups", () => {
    it("removes all group assignments for a user", () => {
      assignUserToGroup({ userId: "bulk-rm", groupId: groupId1, orgId, assignedBy: "admin@test.com" });
      assignUserToGroup({ userId: "bulk-rm", groupId: groupId2, orgId, assignedBy: "admin@test.com" });

      const count = removeAllUserGroups("bulk-rm");
      expect(count).toBe(2);
      expect(getUserGroups("bulk-rm")).toHaveLength(0);
    });
  });

  // ─── setUserGroups ──────────────────────────────────────────────────────

  describe("setUserGroups", () => {
    it("replaces all group assignments", () => {
      assignUserToGroup({ userId: "set-user", groupId: groupId1, orgId, assignedBy: "admin@test.com" });

      setUserGroups({ userId: "set-user", groupIds: [groupId2], orgId, assignedBy: "admin@test.com" });

      const ids = getUserGroupIds("set-user");
      expect(ids).toEqual([groupId2]);
    });

    it("sets to empty array to remove all groups", () => {
      assignUserToGroup({ userId: "clear-user", groupId: groupId1, orgId, assignedBy: "admin@test.com" });

      setUserGroups({ userId: "clear-user", groupIds: [], orgId, assignedBy: "admin@test.com" });

      expect(getUserGroupIds("clear-user")).toHaveLength(0);
    });
  });

  // ─── getGroupMembers ────────────────────────────────────────────────────

  describe("getGroupMembers", () => {
    it("returns all user IDs in a group", () => {
      assignUserToGroup({ userId: "member-a", groupId: groupId1, orgId, assignedBy: "admin@test.com" });
      assignUserToGroup({ userId: "member-b", groupId: groupId1, orgId, assignedBy: "admin@test.com" });

      const members = getGroupMembers(groupId1);
      expect(members.sort()).toEqual(["member-a", "member-b"]);
    });

    it("returns empty for group with no members", () => {
      expect(getGroupMembers(groupId2)).toHaveLength(0);
    });
  });

  // ─── deleteNodeGroup cleans up userMeshGroups ───────────────────────────

  describe("deleteNodeGroup cascade", () => {
    it("removes user assignments when group is deleted", () => {
      assignUserToGroup({ userId: "cascade-user", groupId: groupId1, orgId, assignedBy: "admin@test.com" });
      expect(getUserGroupIds("cascade-user")).toContain(groupId1);

      deleteNodeGroup(groupId1);

      // Assignment should be gone
      expect(getUserGroupIds("cascade-user")).not.toContain(groupId1);
    });

    it("only removes assignments for the deleted group", () => {
      assignUserToGroup({ userId: "partial-user", groupId: groupId1, orgId, assignedBy: "admin@test.com" });
      assignUserToGroup({ userId: "partial-user", groupId: groupId2, orgId, assignedBy: "admin@test.com" });

      deleteNodeGroup(groupId1);

      const ids = getUserGroupIds("partial-user");
      expect(ids).toEqual([groupId2]);
    });
  });
});

// ─── User Group API Routes ────────────────────────────────────────────────────

describe("User Group API Routes", () => {
  let orgId: string;
  let groupId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
    initMeshConfig({ role: "primary", nodeName: "test-primary", orgId });
    const group = createNodeGroup({ name: "API Test Group", orgId });
    groupId = group.id;
  });

  afterAll(() => {
    try { deleteMeshConfig(); } catch { /* may not exist */ }
    teardownTestApp();
  });

  const userId = "api-test-user";

  describe("PUT /api/mesh/users/:userId/groups", () => {
    it("sets user group assignments", async () => {
      const res = await adminAgent(orgId)
        .put(`/api/mesh/users/${userId}/groups`)
        .send({ groupIds: [groupId] });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].groupId).toBe(groupId);
    });

    it("replaces existing assignments", async () => {
      const g2 = createNodeGroup({ name: "Replacement Group", orgId });

      const res = await adminAgent(orgId)
        .put(`/api/mesh/users/${userId}/groups`)
        .send({ groupIds: [g2.id] });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].groupId).toBe(g2.id);
    });

    it("clears all assignments with empty array", async () => {
      const res = await adminAgent(orgId)
        .put(`/api/mesh/users/${userId}/groups`)
        .send({ groupIds: [] });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });

    it("rejects non-admin requests", async () => {
      const res = await memberAgent(orgId)
        .put(`/api/mesh/users/${userId}/groups`)
        .send({ groupIds: [groupId] });
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/mesh/users/:userId/groups", () => {
    it("returns user group assignments", async () => {
      // Set up assignment first
      await adminAgent(orgId)
        .put(`/api/mesh/users/${userId}/groups`)
        .send({ groupIds: [groupId] });

      const res = await adminAgent(orgId)
        .get(`/api/mesh/users/${userId}/groups`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].groupId).toBe(groupId);
      expect(res.body[0].groupName).toBe("API Test Group");
    });
  });

  describe("POST /api/mesh/users/:userId/groups", () => {
    it("assigns user to a group", async () => {
      // Clear first
      await adminAgent(orgId)
        .put(`/api/mesh/users/${userId}/groups`)
        .send({ groupIds: [] });

      const res = await adminAgent(orgId)
        .post(`/api/mesh/users/${userId}/groups`)
        .send({ groupId });
      expect(res.status).toBe(201);
      expect(res.body.groupId).toBe(groupId);
    });

    it("returns ok for duplicate assignment", async () => {
      const res = await adminAgent(orgId)
        .post(`/api/mesh/users/${userId}/groups`)
        .send({ groupId });
      expect(res.status).toBe(200);
      expect(res.body.alreadyAssigned).toBe(true);
    });
  });

  describe("DELETE /api/mesh/users/:userId/groups/:groupId", () => {
    it("removes user from a group", async () => {
      const res = await adminAgent(orgId)
        .delete(`/api/mesh/users/${userId}/groups/${groupId}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("returns 404 if user not in group", async () => {
      const res = await adminAgent(orgId)
        .delete(`/api/mesh/users/${userId}/groups/${groupId}`);
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/mesh/groups/:id/members", () => {
    it("returns member IDs for a group", async () => {
      // Assign user first
      await adminAgent(orgId)
        .post(`/api/mesh/users/${userId}/groups`)
        .send({ groupId });

      const res = await adminAgent(orgId)
        .get(`/api/mesh/groups/${groupId}/members`);
      expect(res.status).toBe(200);
      expect(res.body.memberIds).toContain(userId);
    });
  });
});
