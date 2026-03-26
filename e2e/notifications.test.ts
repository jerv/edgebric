import { test, expect } from "@playwright/test";

/**
 * Notifications — E2E tests.
 *
 * Covers: list notifications, unread count, mark read, mark read for
 * conversation, unread group chats, mark group chat read, notification
 * preferences per group chat.
 *
 * Runs in solo mode — user is solo@localhost (admin).
 */

test.describe("Notification Basics", () => {
  test("lists notifications (initially empty)", async ({ request }) => {
    const res = await request.get("/api/notifications");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  test("returns unread count", async ({ request }) => {
    const res = await request.get("/api/notifications/unread-count");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.count).toBe("number");
    expect(body.count).toBe(0);
  });

  test("lists with custom limit param", async ({ request }) => {
    const res = await request.get("/api/notifications?limit=10");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("mark read on non-existent notification succeeds silently", async ({ request }) => {
    const res = await request.patch("/api/notifications/non-existent-id/read");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("mark read for conversation with fake ID succeeds", async ({ request }) => {
    const res = await request.post("/api/notifications/mark-read-for-conversation", {
      data: { conversationId: "fake-conversation-id" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("mark read for conversation rejects missing conversationId", async ({ request }) => {
    const res = await request.post("/api/notifications/mark-read-for-conversation", {
      data: {},
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Group Chat Unread Tracking", () => {
  test("returns unread group chat IDs (initially empty)", async ({ request }) => {
    const res = await request.get("/api/notifications/unread-group-chats");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ids).toBeDefined();
    expect(Array.isArray(body.ids)).toBe(true);
  });

  test("mark group chat read with fake ID succeeds", async ({ request }) => {
    const res = await request.post("/api/notifications/mark-read-group-chat", {
      data: { groupChatId: "fake-group-chat-id" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("mark group chat read rejects missing groupChatId", async ({ request }) => {
    const res = await request.post("/api/notifications/mark-read-group-chat", {
      data: {},
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Group Chat Notification Preferences", () => {
  let chatId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/group-chats", {
      data: { name: "E2E Notif Pref Test", expiration: "never" },
    });
    const body = await res.json();
    chatId = body.id;
  });

  test("gets default notification pref for group chat", async ({ request }) => {
    const res = await request.get(`/api/notifications/group-chat-pref/${chatId}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.level).toBeDefined();
    // Default should be "all"
    expect(body.level).toBe("all");
  });

  test("sets notification pref to mentions", async ({ request }) => {
    const res = await request.put("/api/notifications/group-chat-pref", {
      data: { groupChatId: chatId, level: "mentions" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("verifies updated pref is mentions", async ({ request }) => {
    const res = await request.get(`/api/notifications/group-chat-pref/${chatId}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.level).toBe("mentions");
  });

  test("sets notification pref to none", async ({ request }) => {
    const res = await request.put("/api/notifications/group-chat-pref", {
      data: { groupChatId: chatId, level: "none" },
    });
    expect(res.ok()).toBe(true);
  });

  test("verifies pref is none", async ({ request }) => {
    const res = await request.get(`/api/notifications/group-chat-pref/${chatId}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.level).toBe("none");
  });

  test("rejects invalid pref level", async ({ request }) => {
    const res = await request.put("/api/notifications/group-chat-pref", {
      data: { groupChatId: chatId, level: "invalid" },
    });
    expect(res.status()).toBe(400);
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/group-chats/${chatId}`);
  });
});
