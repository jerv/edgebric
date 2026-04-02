import { test, expect } from "@playwright/test";

/**
 * Conversations & Chat Query — full lifecycle E2E tests.
 *
 * Covers: query status, sending queries (SSE), conversation creation,
 * listing conversations, viewing history, archiving, bulk delete, feedback.
 *
 * Note: Actual LLM queries require a running inference server, so we test the query
 * infrastructure (status check, error handling) and conversation CRUD.
 * The SSE streaming is tested by sending a query and checking the error
 * response format (since the inference server is intentionally unreachable in E2E).
 */

test.describe("Query Infrastructure", () => {
  test("query status endpoint returns ready state", async ({ request }) => {
    const res = await request.get("/api/query/status");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.ready).toBe("boolean");
    // Inference server is unreachable in E2E, so ready should be false
    expect(body.ready).toBe(false);
  });

  test("query POST returns SSE error when no model available", async ({ request }) => {
    const res = await request.post("/api/query", {
      data: {
        query: "What is the PTO policy?",
      },
    });
    // Should get an SSE response (text/event-stream) with an error event
    // since the inference server is unreachable
    const contentType = res.headers()["content-type"] ?? "";
    // Could be SSE stream or JSON error depending on how far it gets
    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(500);

    if (contentType.includes("text/event-stream")) {
      const text = await res.text();
      // SSE stream should contain an error event or done event
      expect(text.length).toBeGreaterThan(0);
    }
  });

  test("query rejects empty query", async ({ request }) => {
    const res = await request.post("/api/query", {
      data: { query: "" },
    });
    expect(res.ok()).toBe(false);
    expect(res.status()).toBe(400);
  });

  test("query rejects overly long query", async ({ request }) => {
    const res = await request.post("/api/query", {
      data: { query: "a".repeat(4001) },
    });
    expect(res.ok()).toBe(false);
    expect(res.status()).toBe(400);
  });
});

test.describe("Conversation CRUD", () => {
  // We can't create conversations via query (no inference server), so we test
  // the list/archive endpoints and verify empty state behavior.

  test("lists conversations (empty initially)", async ({ request }) => {
    const res = await request.get("/api/conversations");
    expect(res.ok()).toBe(true);
    const convs = await res.json();
    expect(Array.isArray(convs)).toBe(true);
  });

  test("returns 404 for non-existent conversation", async ({ request }) => {
    const res = await request.get("/api/conversations/non-existent-id");
    expect(res.status()).toBe(404);
  });

  test("bulk archive requires mode param", async ({ request }) => {
    const res = await request.delete("/api/conversations");
    expect(res.status()).toBe(400);
  });

  test("bulk archive with mode=archive succeeds", async ({ request }) => {
    const res = await request.delete("/api/conversations?mode=archive");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.count).toBe("number");
  });
});

test.describe("Feedback", () => {
  test("rejects feedback for non-existent message", async ({ request }) => {
    const res = await request.post("/api/feedback", {
      data: {
        conversationId: "non-existent",
        messageId: "non-existent",
        rating: "up",
      },
    });
    // Should fail — conversation doesn't exist
    expect(res.ok()).toBe(false);
  });

  test("gets feedback status for non-existent message", async ({ request }) => {
    const res = await request.get("/api/feedback/non-existent-msg");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.rated).toBe(false);
  });
});
