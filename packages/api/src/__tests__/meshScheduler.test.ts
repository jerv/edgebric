import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import {
  setupTestApp,
  teardownTestApp,
  getDefaultOrgId,
} from "./helpers.js";
import {
  initMeshConfig,
  registerNode,
  listNodes,
  markStaleNodesOffline,
  heartbeat,
  deleteMeshConfig,
} from "../services/nodeRegistry.js";
import {
  startMeshScheduler,
  stopMeshScheduler,
  getPrimaryReachable,
} from "../services/meshScheduler.js";
import { randomUUID } from "crypto";

// Mock the meshClient so no real HTTP calls are made
vi.mock("../services/meshClient.js", () => ({
  sendHeartbeat: vi.fn().mockResolvedValue(true),
}));

// Mock fetch for primary reachability checks
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Mesh Scheduler", () => {
  let orgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
  });

  afterEach(() => {
    stopMeshScheduler();
    vi.clearAllMocks();
    // Clean up mesh config between tests
    try { deleteMeshConfig(); } catch { /* may not exist */ }
  });

  afterAll(() => {
    teardownTestApp();
  });

  // ─── getPrimaryReachable ───────────────────────────────────────────────────

  describe("getPrimaryReachable", () => {
    it("returns null when scheduler is not running", () => {
      expect(getPrimaryReachable()).toBeNull();
    });

    it("returns null for primary nodes", () => {
      initMeshConfig({ role: "primary", nodeName: "test-primary", orgId });
      startMeshScheduler();
      // Primary nodes don't check their own reachability
      expect(getPrimaryReachable()).toBeNull();
    });
  });

  // ─── startMeshScheduler / stopMeshScheduler ────────────────────────────────

  describe("start/stop lifecycle", () => {
    it("starts without error when mesh is configured", () => {
      initMeshConfig({ role: "primary", nodeName: "test-primary", orgId });
      expect(() => startMeshScheduler()).not.toThrow();
    });

    it("is a no-op if already running", () => {
      initMeshConfig({ role: "primary", nodeName: "test-primary", orgId });
      startMeshScheduler();
      // Second call should be a no-op, not throw
      expect(() => startMeshScheduler()).not.toThrow();
    });

    it("stops cleanly", () => {
      initMeshConfig({ role: "primary", nodeName: "test-primary", orgId });
      startMeshScheduler();
      expect(() => stopMeshScheduler()).not.toThrow();
    });

    it("stop is a no-op if not running", () => {
      expect(() => stopMeshScheduler()).not.toThrow();
    });

    it("resets primaryReachable on stop", () => {
      initMeshConfig({ role: "primary", nodeName: "test-primary", orgId });
      startMeshScheduler();
      stopMeshScheduler();
      expect(getPrimaryReachable()).toBeNull();
    });
  });

  // ─── Stale node detection (via nodeRegistry) ──────────────────────────────

  describe("stale node detection", () => {
    it("marks old nodes as offline", () => {
      initMeshConfig({ role: "primary", nodeName: "test-primary", orgId });

      const nodeId = randomUUID();
      registerNode({
        id: nodeId,
        name: "stale-node",
        role: "secondary",
        endpoint: "https://stale.local:3001",
        orgId,
      });

      // Simulate a heartbeat from 2 minutes ago
      heartbeat(nodeId, 3);
      // markStaleNodesOffline with a 0ms timeout marks any node as stale
      const marked = markStaleNodesOffline(0);
      expect(marked).toBe(1);

      const nodes = listNodes({ orgId });
      const staleNode = nodes.find((n) => n.id === nodeId);
      expect(staleNode?.status).toBe("offline");
    });

    it("does not mark recently-seen nodes as offline", () => {
      initMeshConfig({ role: "primary", nodeName: "test-primary", orgId });

      const nodeId = randomUUID();
      registerNode({
        id: nodeId,
        name: "fresh-node",
        role: "secondary",
        endpoint: "https://fresh.local:3001",
        orgId,
      });

      // Fresh heartbeat
      heartbeat(nodeId, 5);

      // 90s timeout — node was just seen
      const marked = markStaleNodesOffline(90_000);
      expect(marked).toBe(0);

      const nodes = listNodes({ orgId });
      const freshNode = nodes.find((n) => n.id === nodeId);
      expect(freshNode?.status).toBe("online");
    });
  });
});
