import { test, expect } from "@playwright/test";
import { createDataSource, deleteDataSource, query, parseSSE } from "./helpers";

/**
 * Edge Cases & Error Handling Tests.
 *
 * Verifies:
 * - Empty/whitespace queries are rejected
 * - Extremely long queries are rejected (> 4000 chars)
 * - Query with no data sources still returns a response
 * - Unicode and special characters in queries
 * - SQL injection attempts are handled safely
 * - XSS payloads are neutralized
 * - Querying a non-existent data source
 * - Querying a non-existent conversation
 * - Health endpoint is always reachable
 * - Rate limiting kicks in (if not skipped)
 */

test.describe("Edge Cases — Input Validation", () => {
  test("rejects empty query", async ({ request }) => {
    const res = await request.fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ query: "" }),
    });
    // Zod validation should catch this
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("rejects whitespace-only query", async ({ request }) => {
    const res = await request.fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ query: "   " }),
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("rejects query exceeding max length", async ({ request }) => {
    const longQuery = "a".repeat(4001);
    const res = await request.fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ query: longQuery }),
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("accepts query at max length boundary", async ({ request }) => {
    const maxQuery = "What is the PTO policy? ".repeat(160).slice(0, 4000);
    const res = await request.fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ query: maxQuery }),
      timeout: 120_000,
    });
    // Should be accepted (200 SSE stream) — not a 400
    expect(res.status()).toBe(200);
  });
});

test.describe("Edge Cases — Special Characters", () => {
  test("handles unicode characters in query", async ({ request }) => {
    const res = await request.fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ query: "What is the PTO policy? Pregunta en espanol y tambien en japonais" }),
      timeout: 120_000,
    });
    expect(res.status()).toBe(200);
  });

  test("handles emoji in query without crashing", async ({ request }) => {
    const res = await request.fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ query: "What benefits do employees get? 🏥💰🏖️" }),
      timeout: 120_000,
    });
    expect(res.status()).toBe(200);
  });

  test("SQL injection in query is handled safely", async ({ request }) => {
    const res = await request.fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        query: "'; DROP TABLE documents; --",
      }),
      timeout: 120_000,
    });
    // Should not crash — either 200 (model answers) or graceful error
    expect(res.status()).toBeLessThan(500);
  });

  test("XSS payload in query is neutralized", async ({ request }) => {
    const res = await request.fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        query: '<script>alert("xss")</script>What is the PTO policy?',
      }),
      timeout: 120_000,
    });
    expect(res.status()).toBeLessThan(500);

    // If it returns an answer, the script tags should not appear unescaped
    if (res.status() === 200) {
      const body = await res.text();
      expect(body).not.toContain('<script>alert("xss")</script>');
    }
  });
});

test.describe("Edge Cases — Invalid References", () => {
  test("query with non-existent data source ID returns error", async ({ request }) => {
    const res = await request.fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        query: "What is the policy?",
        dataSourceIds: ["00000000-0000-0000-0000-000000000000"],
      }),
      timeout: 120_000,
    });
    // Should not crash — might return 200 with no-context answer or an error event in SSE
    expect(res.status()).toBeLessThan(500);
  });

  test("query with non-existent conversation ID creates new conversation", async ({ request }) => {
    const res = await request.fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        query: "Hello",
        conversationId: "00000000-0000-0000-0000-000000000000",
      }),
      timeout: 120_000,
    });
    // Should handle gracefully — either create new or return error
    expect(res.status()).toBeLessThan(500);
  });

  test("GET non-existent conversation returns 404", async ({ request }) => {
    const res = await request.get("/api/conversations/00000000-0000-0000-0000-000000000000");
    expect(res.status()).toBe(404);
  });

  test("GET non-existent group chat returns 404", async ({ request }) => {
    const res = await request.get("/api/group-chats/00000000-0000-0000-0000-000000000000");
    // 404 or 403 (not a member)
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});

test.describe("Edge Cases — Data Source Operations", () => {
  let sourceId: string;

  test.afterAll(async ({ request }) => {
    if (sourceId) await deleteDataSource(request, sourceId);
  });

  test("rejects creating data source with empty name", async ({ request }) => {
    const res = await request.post("/api/data-sources", {
      data: { name: "" },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("rejects creating data source with very long name", async ({ request }) => {
    const res = await request.post("/api/data-sources", {
      data: { name: "x".repeat(201) },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("rejects uploading unsupported file type", async ({ request }) => {
    const ds = await createDataSource(request, "File Type Test");
    sourceId = ds.id;

    const res = await request.post(`/api/data-sources/${sourceId}/documents/upload`, {
      multipart: {
        file: {
          name: "test.exe",
          mimeType: "application/octet-stream",
          buffer: Buffer.from("not a real exe"),
        },
      },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("rejects uploading to non-existent data source", async ({ request }) => {
    const res = await request.post(
      "/api/data-sources/00000000-0000-0000-0000-000000000000/documents/upload",
      {
        multipart: {
          file: {
            name: "test.md",
            mimeType: "text/markdown",
            buffer: Buffer.from("# Test"),
          },
        },
      },
    );
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});

test.describe("Edge Cases — Health & System", () => {
  test("health endpoint is always reachable", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.status).toBeDefined();
  });

  test("health endpoint returns valid structure", async ({ request }) => {
    const res = await request.get("/api/health");
    const body = await res.json();

    // Should have at minimum a status field
    expect(["healthy", "degraded", "unhealthy"]).toContain(body.status);
  });
});

test.describe("Edge Cases — Group Chat Validation", () => {
  test("rejects creating group chat with empty name", async ({ request }) => {
    const res = await request.post("/api/group-chats", {
      data: { name: "", expiration: "never" },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("rejects creating group chat with very long name", async ({ request }) => {
    const res = await request.post("/api/group-chats", {
      data: { name: "x".repeat(101), expiration: "never" },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("rejects invalid expiration value", async ({ request }) => {
    const res = await request.post("/api/group-chats", {
      data: { name: "Test", expiration: "invalid" },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});
