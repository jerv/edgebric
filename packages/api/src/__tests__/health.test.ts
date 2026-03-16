import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, teardownTestApp, createAgent } from "./helpers.js";

describe("GET /api/health", () => {
  beforeAll(() => { setupTestApp(); });
  afterAll(() => { teardownTestApp(); });

  it("returns status for unauthenticated requests", async () => {
    const agent = createAgent({ queryToken: undefined, email: undefined } as any);
    const res = await agent.get("/api/health");
    // 503 expected when mILM/mKB are unavailable (test environment)
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty("status");
    // Unauthenticated should NOT see detailed checks
    expect(res.body).not.toHaveProperty("uptime");
    expect(res.body).not.toHaveProperty("checks");
  });

  it("returns detailed checks for admin users", async () => {
    const agent = createAgent({
      email: "admin@test.com",
      isAdmin: true,
      orgId: "org-1",
    });
    const res = await agent.get("/api/health");
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("uptime");
    expect(res.body).toHaveProperty("checks");
    expect(res.body.checks).toHaveProperty("database");
    expect(res.body.checks.database.status).toBe("ok");
  });
});
