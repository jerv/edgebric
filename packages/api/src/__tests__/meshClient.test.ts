import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { setupTestApp, teardownTestApp, getDefaultOrgId } from "./helpers.js";
import { initMeshConfig, registerNode, deleteMeshConfig, updateNode, removeAllNodes } from "../services/nodeRegistry.js";
import { searchRemoteNode, getRemoteNodeInfo, sendHeartbeat, searchAllNodes, broadcastRevocation } from "../services/meshClient.js";
import { randomUUID } from "crypto";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Mesh Client", () => {
  let orgId: string;
  let meshToken: string;
  let nodeId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
  });

  afterAll(() => {
    teardownTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    try { deleteMeshConfig(); } catch { /* may not exist */ }
    removeAllNodes();

    const cfg = initMeshConfig({ role: "primary", nodeName: "test-primary", orgId });
    meshToken = cfg.meshToken;

    nodeId = randomUUID();
    registerNode({
      id: nodeId,
      name: "test-remote",
      role: "secondary",
      endpoint: "https://remote.local:3001",
      orgId,
    });
    // Mark it online so searchAllNodes picks it up
    updateNode(nodeId, { status: "online" });
  });

  // ─── searchRemoteNode ───────────────────────────────────────────────────

  describe("searchRemoteNode", () => {
    it("sends correct auth headers and body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ chunks: [], nodeId: "remote", nodeName: "Remote" }),
      });

      await searchRemoteNode(nodeId, "test query", ["ds1"], 5);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://remote.local:3001/api/mesh/peer/search");
      expect(opts.method).toBe("POST");
      expect(opts.headers["Authorization"]).toBe(`MeshToken ${meshToken}`);
      expect(opts.headers["X-Mesh-Node-Id"]).toBeDefined();

      const body = JSON.parse(opts.body);
      expect(body.query).toBe("test query");
      expect(body.datasetNames).toEqual(["ds1"]);
      expect(body.topN).toBe(5);
    });

    it("returns null when remote returns non-ok status", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await searchRemoteNode(nodeId, "test");
      expect(result).toBeNull();
    });

    it("returns null when remote returns malformed JSON", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ bad: "data" }), // Missing chunks array
      });

      const result = await searchRemoteNode(nodeId, "test");
      expect(result).toBeNull();
    });

    it("returns null on network timeout", async () => {
      mockFetch.mockRejectedValue(new Error("AbortError: signal timed out"));

      const result = await searchRemoteNode(nodeId, "test");
      expect(result).toBeNull();
    });

    it("returns null when mesh config is missing", async () => {
      deleteMeshConfig();
      const result = await searchRemoteNode(nodeId, "test");
      expect(result).toBeNull();
    });

    it("returns null for unregistered node", async () => {
      const result = await searchRemoteNode(randomUUID(), "test");
      expect(result).toBeNull();
    });
  });

  // ─── getRemoteNodeInfo ──────────────────────────────────────────────────

  describe("getRemoteNodeInfo", () => {
    it("returns node info on success", async () => {
      const info = { nodeId: "n1", nodeName: "Node 1", role: "primary", version: "1.0", sourceCount: 5, groupId: null, groupName: null };
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(info) });

      const result = await getRemoteNodeInfo(nodeId);
      expect(result).toEqual(info);
    });

    it("returns null on non-ok response", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 503 });
      const result = await getRemoteNodeInfo(nodeId);
      expect(result).toBeNull();
    });

    it("returns null on malformed response", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ wrong: true }) });
      const result = await getRemoteNodeInfo(nodeId);
      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
      const result = await getRemoteNodeInfo(nodeId);
      expect(result).toBeNull();
    });
  });

  // ─── sendHeartbeat ──────────────────────────────────────────────────────

  describe("sendHeartbeat", () => {
    it("sends heartbeat with source count", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const result = await sendHeartbeat(nodeId, 10);
      expect(result).toBe(true);

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://remote.local:3001/api/mesh/peer/heartbeat");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.sourceCount).toBe(10);
    });

    it("returns false on failure", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 503 });
      const result = await sendHeartbeat(nodeId, 5);
      expect(result).toBe(false);
    });

    it("returns false on network error", async () => {
      mockFetch.mockRejectedValue(new Error("timeout"));
      const result = await sendHeartbeat(nodeId, 5);
      expect(result).toBe(false);
    });
  });

  // ─── searchAllNodes ─────────────────────────────────────────────────────

  describe("searchAllNodes", () => {
    it("fans out to all online nodes", async () => {
      // Add a second online node
      const node2 = randomUUID();
      registerNode({ id: node2, name: "node-2", role: "secondary", endpoint: "https://node2.local:3001", orgId });
      updateNode(node2, { status: "online" });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ chunks: [{ chunkId: "c-0", content: "Result", similarity: 0.9, sourceName: "Src" }], nodeId: "x", nodeName: "X" }),
      });

      const result = await searchAllNodes("test query");

      // Should have called fetch twice (once per online node, excluding self)
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.nodesSearched).toBe(2);
      expect(result.nodesUnavailable).toBe(0);
      expect(result.results).toHaveLength(2);
    });

    it("excludes self from fan-out", async () => {
      // The config node is "test-primary" — should not search itself
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ chunks: [], nodeId: "x", nodeName: "X" }),
      });

      await searchAllNodes("test");

      // Only the one registered remote node should be searched
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("skips offline nodes", async () => {
      updateNode(nodeId, { status: "offline" });
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ chunks: [], nodeId: "x", nodeName: "X" }) });

      const result = await searchAllNodes("test");

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.nodesSearched).toBe(0);
    });

    it("counts failed nodes as unavailable", async () => {
      mockFetch.mockRejectedValue(new Error("timeout"));

      const result = await searchAllNodes("test");

      expect(result.nodesSearched).toBe(0);
      expect(result.nodesUnavailable).toBe(1);
    });

    it("returns empty when mesh is not configured", async () => {
      deleteMeshConfig();
      const result = await searchAllNodes("test");
      expect(result.results).toHaveLength(0);
      expect(result.nodesSearched).toBe(0);
    });

    it("filters by groupIds when specified", async () => {
      // Node has no group — shouldn't match a group filter
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ chunks: [], nodeId: "x", nodeName: "X" }) });

      const result = await searchAllNodes("test", { groupIds: [randomUUID()] });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.nodesSearched).toBe(0);
    });

    it("forwards an empty allowedDataSourceIds array to remote nodes", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ chunks: [], nodeId: "x", nodeName: "X" }),
      });

      await searchAllNodes("test", { allowedDataSourceIds: [] });

      const [, opts] = mockFetch.mock.calls[0]!;
      const body = JSON.parse(opts.body);
      expect(body.allowedDataSourceIds).toEqual([]);
    });
  });

  // ─── broadcastRevocation ────────────────────────────────────────────────

  describe("broadcastRevocation", () => {
    it("sends revocation to all online nodes", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await broadcastRevocation("user@example.com");

      // Should have called fetch once (one online remote node)
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://remote.local:3001/api/mesh/peer/revoke-user");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.email).toBe("user@example.com");
    });

    it("does not throw when a node is unreachable", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      // Should not throw — fire-and-forget
      await expect(broadcastRevocation("user@example.com")).resolves.toBeUndefined();
    });

    it("does nothing when mesh is not configured", async () => {
      deleteMeshConfig();

      await broadcastRevocation("user@example.com");

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips offline nodes", async () => {
      updateNode(nodeId, { status: "offline" });
      mockFetch.mockResolvedValue({ ok: true });

      await broadcastRevocation("user@example.com");

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
