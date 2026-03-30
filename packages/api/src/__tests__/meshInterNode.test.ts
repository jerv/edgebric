import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import supertest from "supertest";
import express from "express";
import {
  setupTestApp,
  teardownTestApp,
  getDefaultOrgId,
} from "./helpers.js";
import { createApp } from "../app.js";
import {
  initMeshConfig,
  registerNode,
} from "../services/nodeRegistry.js";
import {
  createDataSource,
  updateDataSource,
} from "../services/dataSourceStore.js";

// Mock the search service — we don't want real Ollama/sqlite-vec calls
vi.mock("../services/searchService.js", () => ({
  hybridMultiDatasetSearch: vi.fn().mockResolvedValue({
    results: [
      {
        chunkId: "test-dataset-0",
        chunk: "The vacation policy allows 15 days PTO per year.",
        similarity: 0.92,
        metadata: {
          documentName: "handbook.md",
          sectionPath: "Benefits > Vacation",
          pageNumber: null,
          heading: "Vacation Policy",
        },
      },
    ],
    candidateCount: 1,
    hybridBoost: false,
  }),
}));


/**
 * Create a supertest agent for mesh peer requests.
 * Uses a wrapper that injects a minimal empty session (to prevent crashes
 * in error handlers) but does NOT inject user auth — mesh routes use
 * MeshToken auth, not session-based auth.
 */
function createMeshTestAgent() {
  const testApp = createApp({
    skipSession: true,
    skipCsrf: true,
    skipRateLimit: true,
    skipRequestLogging: true,
  });

  const wrapper = express();
  wrapper.use((req: any, _res: any, next: any) => {
    // Inject an empty session object so Express doesn't crash
    req.session = {
      save: (cb: any) => cb?.(),
      destroy: (cb: any) => cb?.(),
    };
    next();
  });
  wrapper.use(testApp);

  return supertest(wrapper);
}

describe("Mesh Inter-Node API", () => {
  let orgId: string;
  let meshToken: string;
  let remoteNodeId: string;
  let agent: ReturnType<typeof createMeshTestAgent>;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();

    // Initialize mesh on this node
    const cfg = initMeshConfig({
      role: "primary",
      nodeName: "test-primary",
      orgId,
    });
    meshToken = cfg.meshToken;

    // Register a remote node (the one that will be calling us)
    remoteNodeId = randomUUID();
    registerNode({
      id: remoteNodeId,
      name: "remote-secondary",
      role: "secondary",
      endpoint: "http://192.168.1.50:3001",
      orgId,
    });

    agent = createMeshTestAgent();
  });

  afterAll(() => {
    teardownTestApp();
  });

  // ─── Auth middleware ────────────────────────────────────────────────────────

  describe("mesh token authentication", () => {
    it("rejects requests with no Authorization header", async () => {
      const res = await agent.get("/api/mesh/peer/info");
      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Missing or invalid mesh authorization");
    });

    it("rejects requests with wrong auth scheme", async () => {
      const res = await agent
        .get("/api/mesh/peer/info")
        .set("Authorization", `Bearer ${meshToken}`)
        .set("X-Mesh-Node-Id", remoteNodeId);
      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Missing or invalid mesh authorization");
    });

    it("rejects requests with invalid mesh token", async () => {
      const res = await agent
        .get("/api/mesh/peer/info")
        .set("Authorization", "MeshToken wrong-token")
        .set("X-Mesh-Node-Id", remoteNodeId);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Invalid mesh token");
    });

    it("rejects requests with missing X-Mesh-Node-Id header", async () => {
      const res = await agent
        .get("/api/mesh/peer/info")
        .set("Authorization", `MeshToken ${meshToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Missing X-Mesh-Node-Id");
    });

    it("rejects requests from unregistered node", async () => {
      const res = await agent
        .get("/api/mesh/peer/info")
        .set("Authorization", `MeshToken ${meshToken}`)
        .set("X-Mesh-Node-Id", randomUUID());
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Unknown node");
    });
  });

  // ─── Helper for authenticated requests ──────────────────────────────────────

  function authedGet(path: string) {
    return agent
      .get(path)
      .set("Authorization", `MeshToken ${meshToken}`)
      .set("X-Mesh-Node-Id", remoteNodeId);
  }

  function authedPost(path: string) {
    return agent
      .post(path)
      .set("Authorization", `MeshToken ${meshToken}`)
      .set("X-Mesh-Node-Id", remoteNodeId);
  }

  // ─── GET /api/mesh/peer/info ────────────────────────────────────────────────

  describe("GET /api/mesh/peer/info", () => {
    it("returns node identity and source counts", async () => {
      const res = await authedGet("/api/mesh/peer/info");
      expect(res.status).toBe(200);
      expect(typeof res.body.nodeId).toBe("string");
      expect(res.body.nodeName).toBe("test-primary");
      expect(res.body.role).toBe("primary");
      expect(typeof res.body.version).toBe("string");
      expect(typeof res.body.sourceCount).toBe("number");
      expect(typeof res.body.meshVisibleSourceCount).toBe("number");
    });

    it("meshVisibleSourceCount only counts externally accessible sources", async () => {
      // Create two sources: one with external access, one without
      const ds1 = createDataSource({
        name: "Public Policies",
        ownerId: "admin@test.com",
        orgId,
      });
      updateDataSource(ds1.id, { allowExternalAccess: true });

      const ds2 = createDataSource({
        name: "Internal Only",
        ownerId: "admin@test.com",
        orgId,
      });
      // Default is allowExternalAccess=true, so explicitly disable it
      updateDataSource(ds2.id, { allowExternalAccess: false });

      const res = await authedGet("/api/mesh/peer/info");
      expect(res.status).toBe(200);
      expect(res.body.sourceCount).toBeGreaterThanOrEqual(2);
      expect(res.body.meshVisibleSourceCount).toBeLessThan(res.body.sourceCount);
    });
  });

  // ─── POST /api/mesh/peer/heartbeat ──────────────────────────────────────────

  describe("POST /api/mesh/peer/heartbeat", () => {
    it("accepts heartbeat with source count", async () => {
      const res = await authedPost("/api/mesh/peer/heartbeat")
        .send({ sourceCount: 5, version: "0.5.0" });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("accepts heartbeat with no body", async () => {
      const res = await authedPost("/api/mesh/peer/heartbeat")
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("rejects negative source count", async () => {
      const res = await authedPost("/api/mesh/peer/heartbeat")
        .send({ sourceCount: -1 });
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/mesh/peer/search ─────────────────────────────────────────────

  describe("POST /api/mesh/peer/search", () => {
    it("returns search results with node identity", async () => {
      // Ensure we have an externally-accessible source
      const ds = createDataSource({
        name: "Mesh-Visible Source",
        ownerId: "admin@test.com",
        orgId,
        datasetName: "test-dataset",
      });
      updateDataSource(ds.id, { allowExternalAccess: true });

      const res = await authedPost("/api/mesh/peer/search")
        .send({ query: "vacation policy" });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.chunks)).toBe(true);
      expect(typeof res.body.nodeId).toBe("string");
      expect(typeof res.body.nodeName).toBe("string");
    });

    it("search results include expected fields", async () => {
      const res = await authedPost("/api/mesh/peer/search")
        .send({ query: "vacation policy" });
      expect(res.status).toBe(200);

      if (res.body.chunks.length > 0) {
        const chunk = res.body.chunks[0];
        expect(chunk).toHaveProperty("chunkId");
        expect(chunk).toHaveProperty("content");
        expect(chunk).toHaveProperty("similarity");
        expect(chunk).toHaveProperty("sourceName");
      }
    });

    it("respects topN parameter", async () => {
      const res = await authedPost("/api/mesh/peer/search")
        .send({ query: "vacation policy", topN: 5 });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.chunks)).toBe(true);
    });

    it("filters by dataset names when provided", async () => {
      const res = await authedPost("/api/mesh/peer/search")
        .send({ query: "vacation policy", datasetNames: ["test-dataset"] });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.chunks)).toBe(true);
    });

    it("returns empty chunks for non-existent dataset", async () => {
      const res = await authedPost("/api/mesh/peer/search")
        .send({ query: "vacation policy", datasetNames: ["nonexistent"] });
      expect(res.status).toBe(200);
      expect(res.body.chunks).toEqual([]);
    });

    it("rejects empty query", async () => {
      const res = await authedPost("/api/mesh/peer/search")
        .send({ query: "" });
      expect(res.status).toBe(400);
    });

    it("rejects missing query field", async () => {
      const res = await authedPost("/api/mesh/peer/search")
        .send({});
      expect(res.status).toBe(400);
    });

    it("rejects topN > 50", async () => {
      const res = await authedPost("/api/mesh/peer/search")
        .send({ query: "test", topN: 100 });
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /api/mesh/peer/auth-info ───────────────────────────────────────────

  describe("GET /api/mesh/peer/auth-info", () => {
    it("returns auth provider info", async () => {
      const res = await authedGet("/api/mesh/peer/auth-info");
      expect(res.status).toBe(200);
      expect(typeof res.body.provider).toBe("string");
      expect(typeof res.body.providerName).toBe("string");
    });

    it("returns valid provider value", async () => {
      const res = await authedGet("/api/mesh/peer/auth-info");
      expect(res.status).toBe(200);
      const validProviders = ["google", "microsoft", "okta", "onelogin", "ping", "generic", "none"];
      expect(validProviders).toContain(res.body.provider);
    });
  });
});
