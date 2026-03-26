import { test, expect } from "@playwright/test";

/**
 * Conversation Details & Misc — E2E tests for endpoints not covered elsewhere.
 *
 * Covers: single conversation get/archive, convert solo to group,
 * group chat member search, thread messages.
 *
 * Runs in solo mode (AUTH_MODE=none) — auto-admin as solo@localhost.
 */

test.describe("Single Conversation", () => {
  test("GET non-existent conversation returns 404", async ({ request }) => {
    const res = await request.get("/api/conversations/00000000-0000-0000-0000-000000000000");
    expect(res.status()).toBe(404);
  });

  test("DELETE non-existent conversation returns 404", async ({ request }) => {
    const res = await request.delete("/api/conversations/00000000-0000-0000-0000-000000000000?mode=archive");
    expect(res.status()).toBe(404);
  });

  test("convert non-existent conversation returns error", async ({ request }) => {
    const res = await request.post("/api/conversations/00000000-0000-0000-0000-000000000000/convert-to-group", {
      data: { name: "Converted Chat" },
    });
    // Returns 400 (validation) or 404 (not found)
    expect(res.ok()).toBe(false);
    expect([400, 404]).toContain(res.status());
  });
});

test.describe("Group Chat Member Search", () => {
  test("searches org members by query", async ({ request }) => {
    const res = await request.get("/api/group-chats/members/search?q=solo");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const found = body.find((m: { email: string }) => m.email === "solo@localhost");
    expect(found).toBeDefined();
  });

  test("search with empty query returns results", async ({ request }) => {
    const res = await request.get("/api/group-chats/members/search?q=");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("search with no matches returns empty array", async ({ request }) => {
    const res = await request.get("/api/group-chats/members/search?q=zzzznonexistent");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });
});

test.describe("Group Chat Threads", () => {
  let chatId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/group-chats", {
      data: { name: "E2E Thread Test", expiration: "never" },
    });
    const body = await res.json();
    chatId = body.id;
  });

  test("GET thread with non-existent parent returns empty array", async ({ request }) => {
    const res = await request.get(`/api/group-chats/${chatId}/threads/00000000-0000-0000-0000-000000000000`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/group-chats/${chatId}`);
  });
});
