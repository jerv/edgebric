import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, teardownTestApp, adminAgent, memberAgent, getDefaultOrgId, createAgent } from "./helpers.js";
import { createKB } from "../services/knowledgeBaseStore.js";
import { upsertUser, updateUserPermissions } from "../services/userStore.js";

describe("Group Chats API", () => {
  let orgId: string;
  let creatorEmail: string;
  let memberEmail: string;
  let nonMemberEmail: string;
  let kbId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
    creatorEmail = "creator@test.com";
    memberEmail = "member@test.com";
    nonMemberEmail = "outsider@test.com";

    // Ensure users exist in org
    const creator = upsertUser({ email: creatorEmail, name: "Creator User", role: "member", orgId });
    upsertUser({ email: memberEmail, name: "Member User", role: "member", orgId });
    upsertUser({ email: nonMemberEmail, name: "Outsider User", role: "member", orgId });

    // Grant group chat permission to creator
    updateUserPermissions(creator.id, { canCreateGroupChats: true });

    // Create a KB for sharing tests
    const admin = upsertUser({ email: "admin@test.com", name: "Admin", role: "owner", orgId });
    const kb = createKB({
      name: "Test Source",
      orgId,
      ownerId: admin.id,
      type: "organization",
    });
    kbId = kb.id;
  });
  afterAll(() => { teardownTestApp(); });

  function creatorAgent() {
    return createAgent({
      email: creatorEmail,
      isAdmin: false,
      orgId,
      orgSlug: "test-org",
      name: "Creator User",
    });
  }

  function member2Agent() {
    return createAgent({
      email: memberEmail,
      isAdmin: false,
      orgId,
      orgSlug: "test-org",
      name: "Member User",
    });
  }

  function outsiderAgent() {
    return createAgent({
      email: nonMemberEmail,
      isAdmin: false,
      orgId,
      orgSlug: "test-org",
      name: "Outsider User",
    });
  }

  // ─── Creation ────────────────────────────────────────────────────────────────

  describe("POST /api/group-chats", () => {
    it("user with permission can create a group chat", async () => {
      const res = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "Test Chat", expiration: "never" });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.name).toBe("Test Chat");
      expect(res.body.status).toBe("active");
      expect(res.body.members).toHaveLength(1);
      expect(res.body.members[0].role).toBe("creator");
    });

    it("admin can always create group chats", async () => {
      const res = await adminAgent(orgId)
        .post("/api/group-chats")
        .send({ name: "Admin Chat", expiration: "24h" });

      expect(res.status).toBe(201);
    });

    it("user without permission cannot create group chats", async () => {
      const res = await outsiderAgent()
        .post("/api/group-chats")
        .send({ name: "Blocked", expiration: "never" });

      expect(res.status).toBe(403);
    });

    it("rejects empty name", async () => {
      const res = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "", expiration: "never" });

      expect(res.status).toBe(400);
    });

    it("rejects name over 100 chars", async () => {
      const res = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "x".repeat(101), expiration: "never" });

      expect(res.status).toBe(400);
    });
  });

  // ─── Listing and Detail ──────────────────────────────────────────────────────

  describe("GET /api/group-chats", () => {
    it("returns only chats user is a member of", async () => {
      // Creator's chats
      const res = await creatorAgent().get("/api/group-chats");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      // Outsider sees nothing
      const res2 = await outsiderAgent().get("/api/group-chats");
      expect(res2.status).toBe(200);
      expect(res2.body).toHaveLength(0);
    });
  });

  describe("GET /api/group-chats/:id", () => {
    it("member can view chat detail", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "Detail Test", expiration: "never" });
      const chatId = createRes.body.id;

      const res = await creatorAgent().get(`/api/group-chats/${chatId}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Detail Test");
    });

    it("non-member cannot view chat detail", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "Private Chat", expiration: "never" });
      const chatId = createRes.body.id;

      const res = await outsiderAgent().get(`/api/group-chats/${chatId}`);
      expect(res.status).toBe(403);
    });

    it("returns 404 for non-existent chat", async () => {
      const res = await creatorAgent().get("/api/group-chats/non-existent-id");
      expect(res.status).toBe(404);
    });
  });

  // ─── Update ──────────────────────────────────────────────────────────────────

  describe("PATCH /api/group-chats/:id", () => {
    it("creator can update chat name", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "Original Name", expiration: "never" });
      const chatId = createRes.body.id;

      const res = await creatorAgent()
        .patch(`/api/group-chats/${chatId}`)
        .send({ name: "Updated Name" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated Name");
    });

    it("non-creator cannot update chat", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "Creator Only", expiration: "never" });
      const chatId = createRes.body.id;

      // Add member first
      await creatorAgent()
        .post(`/api/group-chats/${chatId}/members`)
        .send({ email: memberEmail });

      const res = await member2Agent()
        .patch(`/api/group-chats/${chatId}`)
        .send({ name: "Hacked" });

      expect(res.status).toBe(403);
    });
  });

  // ─── Members ─────────────────────────────────────────────────────────────────

  describe("Member management", () => {
    it("creator can invite members", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "Invite Test", expiration: "never" });
      const chatId = createRes.body.id;

      const res = await creatorAgent()
        .post(`/api/group-chats/${chatId}/members`)
        .send({ email: memberEmail });

      expect(res.status).toBe(201);
      expect(res.body.userEmail).toBe(memberEmail);
      expect(res.body.role).toBe("member");
    });

    it("non-creator cannot invite", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "No Invite", expiration: "never" });
      const chatId = createRes.body.id;

      // Add member first
      await creatorAgent()
        .post(`/api/group-chats/${chatId}/members`)
        .send({ email: memberEmail });

      // Member tries to invite outsider
      const res = await member2Agent()
        .post(`/api/group-chats/${chatId}/members`)
        .send({ email: nonMemberEmail });

      expect(res.status).toBe(403);
    });

    it("rejects duplicate member invite", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "Dup Test", expiration: "never" });
      const chatId = createRes.body.id;

      await creatorAgent()
        .post(`/api/group-chats/${chatId}/members`)
        .send({ email: memberEmail });

      const res = await creatorAgent()
        .post(`/api/group-chats/${chatId}/members`)
        .send({ email: memberEmail });

      expect(res.status).toBe(409);
    });

    it("member can leave (self-remove)", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "Leave Test", expiration: "never" });
      const chatId = createRes.body.id;

      await creatorAgent()
        .post(`/api/group-chats/${chatId}/members`)
        .send({ email: memberEmail });

      const res = await member2Agent()
        .delete(`/api/group-chats/${chatId}/members/${encodeURIComponent(memberEmail)}`);

      expect(res.status).toBe(200);
    });

    it("creator cannot leave their own chat", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "Creator Stays", expiration: "never" });
      const chatId = createRes.body.id;

      const res = await creatorAgent()
        .delete(`/api/group-chats/${chatId}/members/${encodeURIComponent(creatorEmail)}`);

      expect(res.status).toBe(409);
    });

    it("creator can kick a member", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "Kick Test", expiration: "never" });
      const chatId = createRes.body.id;

      await creatorAgent()
        .post(`/api/group-chats/${chatId}/members`)
        .send({ email: memberEmail });

      const res = await creatorAgent()
        .delete(`/api/group-chats/${chatId}/members/${encodeURIComponent(memberEmail)}`);

      expect(res.status).toBe(200);
    });

    it("member cannot kick another member", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "No Kick", expiration: "never" });
      const chatId = createRes.body.id;

      await creatorAgent()
        .post(`/api/group-chats/${chatId}/members`)
        .send({ email: memberEmail });

      await creatorAgent()
        .post(`/api/group-chats/${chatId}/members`)
        .send({ email: nonMemberEmail });

      // member tries to remove outsider
      const res = await member2Agent()
        .delete(`/api/group-chats/${chatId}/members/${encodeURIComponent(nonMemberEmail)}`);

      expect(res.status).toBe(403);
    });
  });

  // ─── Data Source Sharing ─────────────────────────────────────────────────────

  describe("Data source sharing", () => {
    it("member can share a data source", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "Share Test", expiration: "never" });
      const chatId = createRes.body.id;

      const res = await creatorAgent()
        .post(`/api/group-chats/${chatId}/shared-kbs`)
        .send({ knowledgeBaseId: kbId, allowSourceViewing: true });

      expect(res.status).toBe(201);
      expect(res.body.knowledgeBaseId).toBe(kbId);
    });

    it("rejects duplicate share", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "Dup Share", expiration: "never" });
      const chatId = createRes.body.id;

      await creatorAgent()
        .post(`/api/group-chats/${chatId}/shared-kbs`)
        .send({ knowledgeBaseId: kbId, allowSourceViewing: true });

      const res = await creatorAgent()
        .post(`/api/group-chats/${chatId}/shared-kbs`)
        .send({ knowledgeBaseId: kbId, allowSourceViewing: true });

      expect(res.status).toBe(409);
    });

    it("non-member cannot share", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "No Share", expiration: "never" });
      const chatId = createRes.body.id;

      const res = await outsiderAgent()
        .post(`/api/group-chats/${chatId}/shared-kbs`)
        .send({ knowledgeBaseId: kbId, allowSourceViewing: true });

      expect(res.status).toBe(403);
    });

    it("sharer can unshare", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "Unshare Test", expiration: "never" });
      const chatId = createRes.body.id;

      const shareRes = await creatorAgent()
        .post(`/api/group-chats/${chatId}/shared-kbs`)
        .send({ knowledgeBaseId: kbId, allowSourceViewing: true });
      const shareId = shareRes.body.id;

      const res = await creatorAgent()
        .delete(`/api/group-chats/${chatId}/shared-kbs/${shareId}`);

      expect(res.status).toBe(200);
    });
  });

  // ─── Messages ────────────────────────────────────────────────────────────────

  describe("Messages", () => {
    it("member can list messages", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "Messages Test", expiration: "never" });
      const chatId = createRes.body.id;

      const res = await creatorAgent().get(`/api/group-chats/${chatId}/messages`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Should have at least the system message from creation
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it("non-member cannot list messages", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "Private Msgs", expiration: "never" });
      const chatId = createRes.body.id;

      const res = await outsiderAgent().get(`/api/group-chats/${chatId}/messages`);
      expect(res.status).toBe(403);
    });
  });

  // ─── Archive ─────────────────────────────────────────────────────────────────

  describe("DELETE /api/group-chats/:id", () => {
    it("creator can archive chat", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "Archive Me", expiration: "never" });
      const chatId = createRes.body.id;

      const res = await creatorAgent().delete(`/api/group-chats/${chatId}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it("non-creator cannot archive", async () => {
      const createRes = await creatorAgent()
        .post("/api/group-chats")
        .send({ name: "No Archive", expiration: "never" });
      const chatId = createRes.body.id;

      await creatorAgent()
        .post(`/api/group-chats/${chatId}/members`)
        .send({ email: memberEmail });

      const res = await member2Agent().delete(`/api/group-chats/${chatId}`);
      expect(res.status).toBe(403);
    });
  });
});
