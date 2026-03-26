import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, teardownTestApp, createAgent } from "./helpers.js";

describe("GET /api/health", () => {
  beforeAll(() => { setupTestApp(); });
  afterAll(() => { teardownTestApp(); });

  it("returns minimal status for unauthenticated requests", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agent = createAgent({ queryToken: undefined, email: undefined } as any);
    const res = await agent.get("/api/health");
    // Core checks (db + disk) are healthy in test env → 200
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(typeof res.body.aiReady).toBe("boolean");
    // Unauthenticated should NOT see detailed checks
    expect(res.body).not.toHaveProperty("uptime");
    expect(res.body).not.toHaveProperty("checks");
    expect(res.body).not.toHaveProperty("activeModel");
  });

  it("returns detailed checks for admin users", async () => {
    const agent = createAgent({
      email: "admin@test.com",
      isAdmin: true,
      orgId: "org-1",
    });
    const res = await agent.get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(typeof res.body.uptime).toBe("number");
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof res.body.activeModel).toBe("string");
    // Database always ok in test env
    expect(res.body.checks.database.status).toBe("ok");
    // AI services may or may not be running — verify structure, not state
    expect(res.body.checks.inference).toBeDefined();
    expect(["ok", "degraded", "unavailable"]).toContain(res.body.checks.inference.status);
    expect(res.body.checks.vectorStore).toBeDefined();
    expect(["ok", "degraded", "unavailable"]).toContain(res.body.checks.vectorStore.status);
  });
});
