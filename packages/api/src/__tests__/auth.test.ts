import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, teardownTestApp, createAgent, adminAgent, memberAgent, unauthAgent, getDefaultOrgId } from "./helpers.js";

describe("Auth Middleware", () => {
  let orgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
  });
  afterAll(() => { teardownTestApp(); });

  it("returns 401 for unauthenticated requests to protected routes", async () => {
    const res = await unauthAgent().get("/api/conversations");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Authentication required");
  });

  it("returns 428 when no org is selected", async () => {
    const agent = createAgent({ email: "user@test.com" });
    const res = await agent.get("/api/conversations");
    expect(res.status).toBe(428);
    expect(res.body.code).toBe("ORG_REQUIRED");
  });

  it("returns 403 for non-admin accessing admin routes", async () => {
    const res = await memberAgent(orgId).get("/api/admin/models");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Admin access required");
  });

  it("admin can access admin routes", async () => {
    const res = await adminAgent(orgId).get("/api/admin/models");
    expect(res.status).toBe(200);
  });

  it("authenticated user with org can access normal routes", async () => {
    const res = await memberAgent(orgId).get("/api/conversations");
    expect(res.status).toBe(200);
  });
});
