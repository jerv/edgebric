import { test, expect } from "@playwright/test";

/**
 * Sync API — E2E tests for chunk synchronization endpoints.
 *
 * Covers: dataset version hash, NDJSON chunk streaming.
 * Runs in solo mode (AUTH_MODE=none, auto-admin as solo@localhost).
 */

test.describe("Sync API", () => {
  test("GET /api/sync/version returns 403 when vault mode disabled", async ({ request }) => {
    const res = await request.get("/api/sync/version");
    // Vault mode is not enabled in solo mode — returns 403 with revoked flag
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.revoked).toBe(true);
  });

  test("GET /api/sync/chunks returns 403 when vault mode disabled", async ({ request }) => {
    const res = await request.get("/api/sync/chunks");
    expect(res.status()).toBe(403);
  });
});
