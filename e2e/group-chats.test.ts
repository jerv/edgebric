import { test, expect } from "@playwright/test";

/**
 * Group Chats — full lifecycle E2E tests.
 *
 * Covers: create group chat, invite members, send messages, list chats,
 * update chat settings, vault source sharing (share/extend/revoke),
 * chat expiration, member removal, chat deletion.
 *
 * Runs in solo mode — creator is solo@localhost (admin).
 * Member field is `userEmail` (not `email`).
 * `expiresAt` is absent (undefined) for "never" expiration, not null.
 */

test.describe("Group Chat CRUD", () => {
  let chatId: string;

  test("creates a group chat", async ({ request }) => {
    const res = await request.post("/api/group-chats", {
      data: {
        name: "E2E Test Chat",
        expiration: "24h",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("E2E Test Chat");
    expect(body.id).toBeTruthy();
    expect(body.creatorEmail).toBe("solo@localhost");
    expect(body.status).toBe("active");
    chatId = body.id;
  });

  test("lists group chats and finds the new one", async ({ request }) => {
    const res = await request.get("/api/group-chats");
    expect(res.ok()).toBe(true);
    const chats = await res.json();
    expect(Array.isArray(chats)).toBe(true);
    const found = chats.find((c: { id: string }) => c.id === chatId);
    expect(found).toBeDefined();
    expect(found.name).toBe("E2E Test Chat");
  });

  test("gets chat details by ID", async ({ request }) => {
    const res = await request.get(`/api/group-chats/${chatId}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.id).toBe(chatId);
    expect(body.name).toBe("E2E Test Chat");
    expect(body.members).toBeDefined();
    expect(Array.isArray(body.members)).toBe(true);
    // Creator should be a member (field is userEmail, not email)
    const creator = body.members.find((m: { userEmail: string }) => m.userEmail === "solo@localhost");
    expect(creator).toBeDefined();
    expect(creator.role).toBe("creator");
  });

  test("updates chat name", async ({ request }) => {
    const res = await request.patch(`/api/group-chats/${chatId}`, {
      data: { name: "E2E Renamed Chat" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.name).toBe("E2E Renamed Chat");
  });

  test("updates chat expiration", async ({ request }) => {
    const res = await request.patch(`/api/group-chats/${chatId}`, {
      data: { expiration: "1w" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.expiresAt).toBeTruthy();
  });

  test("gets chat messages (initially system message only)", async ({ request }) => {
    const res = await request.get(`/api/group-chats/${chatId}/messages`);
    expect(res.ok()).toBe(true);
    const messages = await res.json();
    expect(Array.isArray(messages)).toBe(true);
  });

  test("sends a text message", async ({ request }) => {
    const res = await request.post(`/api/group-chats/${chatId}/send`, {
      data: { content: "Hello from E2E test!" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.content).toBe("Hello from E2E test!");
    expect(body.authorEmail).toBe("solo@localhost");
    expect(body.role).toBe("user");
  });

  test("message appears in chat history", async ({ request }) => {
    const res = await request.get(`/api/group-chats/${chatId}/messages`);
    expect(res.ok()).toBe(true);
    const messages = await res.json();
    const userMsg = messages.find(
      (m: { content: string; role: string }) => m.content === "Hello from E2E test!" && m.role === "user",
    );
    expect(userMsg).toBeDefined();
  });

  test("deletes the chat", async ({ request }) => {
    const res = await request.delete(`/api/group-chats/${chatId}`);
    expect(res.ok()).toBe(true);
  });

  test("deleted chat is archived", async ({ request }) => {
    const res = await request.get("/api/group-chats");
    const chats = await res.json();
    const found = chats.find((c: { id: string }) => c.id === chatId);
    // Delete is soft-delete (archive) — chat still in list but status is "archived"
    expect(found).toBeDefined();
    expect(found.status).toBe("archived");
  });
});

test.describe("Group Chat Members", () => {
  let chatId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/group-chats", {
      data: { name: "E2E Member Test", expiration: "never" },
    });
    const body = await res.json();
    chatId = body.id;
  });

  test("adds a member by email", async ({ request }) => {
    const res = await request.post(`/api/group-chats/${chatId}/members`, {
      data: { email: "member1@test.com" },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.userEmail).toBe("member1@test.com");
  });

  test("adding duplicate member fails with 409", async ({ request }) => {
    const res = await request.post(`/api/group-chats/${chatId}/members`, {
      data: { email: "member1@test.com" },
    });
    expect(res.status()).toBe(409);
  });

  test("chat shows both members", async ({ request }) => {
    const res = await request.get(`/api/group-chats/${chatId}`);
    const body = await res.json();
    const emails = body.members.map((m: { userEmail: string }) => m.userEmail);
    expect(emails).toContain("solo@localhost");
    expect(emails).toContain("member1@test.com");
  });

  test("removes a member", async ({ request }) => {
    const res = await request.delete(`/api/group-chats/${chatId}/members/member1@test.com`);
    expect(res.ok()).toBe(true);

    // Verify member is gone
    const check = await request.get(`/api/group-chats/${chatId}`);
    const body = await check.json();
    const emails = body.members.map((m: { userEmail: string }) => m.userEmail);
    expect(emails).not.toContain("member1@test.com");
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/group-chats/${chatId}`);
  });
});

test.describe("Vault Source Sharing in Group Chats", () => {
  let chatId: string;
  let sourceId: string;
  let shareId: string;

  test.beforeAll(async ({ request }) => {
    // Create a group chat
    const chatRes = await request.post("/api/group-chats", {
      data: { name: "E2E Share Test", expiration: "never" },
    });
    const chatBody = await chatRes.json();
    chatId = chatBody.id;

    // Create a data source to share
    const srcRes = await request.post("/api/data-sources", {
      data: { name: "E2E Shared Source", type: "personal" },
    });
    const srcBody = await srcRes.json();
    sourceId = srcBody.id;
  });

  test("shares a data source with the group chat", async ({ request }) => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await request.post(`/api/group-chats/${chatId}/shared-data-sources`, {
      data: {
        dataSourceId: sourceId,
        allowSourceViewing: true,
        expiresAt: futureDate,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.dataSourceId).toBe(sourceId);
    expect(body.allowSourceViewing).toBe(true);
    expect(body.expiresAt).toBeTruthy();
    shareId = body.id;
  });

  test("rejects duplicate share (409)", async ({ request }) => {
    const res = await request.post(`/api/group-chats/${chatId}/shared-data-sources`, {
      data: {
        dataSourceId: sourceId,
        allowSourceViewing: false,
      },
    });
    expect(res.status()).toBe(409);
  });

  test("rejects share with past expiration", async ({ request }) => {
    // Create another source for this test
    const srcRes = await request.post("/api/data-sources", {
      data: { name: "E2E Past Expiry Source", type: "personal" },
    });
    const srcBody = await srcRes.json();

    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const res = await request.post(`/api/group-chats/${chatId}/shared-data-sources`, {
      data: {
        dataSourceId: srcBody.id,
        allowSourceViewing: false,
        expiresAt: pastDate,
      },
    });
    expect(res.status()).toBe(400);

    // Cleanup
    await request.delete(`/api/data-sources/${srcBody.id}`);
  });

  test("extends share expiration", async ({ request }) => {
    const newExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const res = await request.patch(`/api/group-chats/${chatId}/shared-data-sources/${shareId}`, {
      data: { expiresAt: newExpiry },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 47 * 60 * 60 * 1000);
  });

  test("revokes the shared source", async ({ request }) => {
    const res = await request.delete(`/api/group-chats/${chatId}/shared-data-sources/${shareId}`);
    expect(res.ok()).toBe(true);
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/group-chats/${chatId}`);
    await request.delete(`/api/data-sources/${sourceId}`);
  });
});

test.describe("Group Chat Expiration Modes", () => {
  test("creates chat with 'never' expiration", async ({ request }) => {
    const res = await request.post("/api/group-chats", {
      data: { name: "E2E Never Expire", expiration: "never" },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    // "never" expiration means expiresAt is absent from the response
    expect(body.expiresAt).toBeUndefined();
    await request.delete(`/api/group-chats/${body.id}`);
  });

  test("creates chat with '1m' (1 month) expiration", async ({ request }) => {
    const res = await request.post("/api/group-chats", {
      data: { name: "E2E Month Expire", expiration: "1m" },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.expiresAt).toBeTruthy();
    // Should expire roughly 30 days from now
    const expiresAt = new Date(body.expiresAt).getTime();
    const thirtyDays = 29 * 24 * 60 * 60 * 1000;
    expect(expiresAt - Date.now()).toBeGreaterThan(thirtyDays);
    await request.delete(`/api/group-chats/${body.id}`);
  });

  test("rejects invalid expiration", async ({ request }) => {
    const res = await request.post("/api/group-chats", {
      data: { name: "E2E Bad Expiry", expiration: "invalid" },
    });
    expect(res.status()).toBe(400);
  });
});
