import { test, expect } from "@playwright/test";

/**
 * Audit Log — E2E tests.
 *
 * Covers: query audit log, limit param, stats, integrity verification, export (JSON + CSV).
 *
 * Runs in solo mode (AUTH_MODE=none, auto-admin as solo@localhost).
 * Other tests may have generated audit entries, so we validate shape
 * rather than exact counts.
 */

test.describe("Audit Log", () => {
  test("GET /api/audit returns entries and total", async ({ request }) => {
    const res = await request.get("/api/audit");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.entries)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  test("GET /api/audit?limit=5 respects limit parameter", async ({ request }) => {
    const res = await request.get("/api/audit?limit=5");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBeLessThanOrEqual(5);
  });

  test("GET /api/audit/stats returns event count stats", async ({ request }) => {
    const res = await request.get("/api/audit/stats");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();
    // Stats should be an object with string keys and numeric values
    for (const [key, value] of Object.entries(body)) {
      expect(typeof key).toBe("string");
      expect(typeof value).toBe("number");
    }
  });

  test("GET /api/audit/verify returns integrity result", async ({ request }) => {
    const res = await request.get("/api/audit/verify");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.valid).toBe("boolean");
  });

  test("GET /api/audit/export?format=json exports as JSON", async ({ request }) => {
    const res = await request.get("/api/audit/export?format=json");
    expect(res.ok()).toBe(true);
    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("GET /api/audit/export?format=csv exports as CSV", async ({ request }) => {
    const res = await request.get("/api/audit/export?format=csv");
    expect(res.ok()).toBe(true);
    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toContain("text/csv");
    const text = await res.text();
    // CSV should have at least a header row
    expect(text.length).toBeGreaterThan(0);
  });
});
