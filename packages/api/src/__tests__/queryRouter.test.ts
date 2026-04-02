import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { setupTestApp, teardownTestApp, getDefaultOrgId } from "./helpers.js";
import { initMeshConfig, deleteMeshConfig } from "../services/nodeRegistry.js";
import { randomUUID } from "crypto";

// Mock the search service — no real inference/sqlite-vec
const mockHybridSearch = vi.fn();
vi.mock("../services/searchService.js", () => ({
  hybridMultiDatasetSearch: (...args: unknown[]) => mockHybridSearch(...args),
}));

// Mock meshClient.searchAllNodes — no real HTTP calls
const mockSearchAllNodes = vi.fn();
vi.mock("../services/meshClient.js", () => ({
  searchAllNodes: (...args: unknown[]) => mockSearchAllNodes(...args),
}));

// Must import AFTER mocks are registered
const { routedSearch } = await import("../services/queryRouter.js");

describe("Query Router", () => {
  let orgId: string;

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
  });

  // ─── Local-only (mesh disabled) ─────────────────────────────────────────

  describe("mesh disabled", () => {
    it("returns only local results when mesh is not configured", async () => {
      mockHybridSearch.mockResolvedValue({
        results: [
          { chunkId: "ds-0", chunk: "Local result", similarity: 0.9, metadata: { sourceDocument: "doc.pdf", documentName: "doc.pdf", sectionPath: [], pageNumber: 1, heading: "", chunkIndex: 0 } },
        ],
        candidateCount: 1,
        hybridBoost: false,
      });

      const response = await routedSearch(["ds"], "test query");

      expect(response.results).toHaveLength(1);
      expect(response.results[0]!.chunkId).toBe("ds-0");
      expect(response.meshNodesSearched).toBe(0);
      expect(response.meshNodesUnavailable).toBe(0);
      expect(mockSearchAllNodes).not.toHaveBeenCalled();
    });

    it("returns empty results when no local datasets", async () => {
      const response = await routedSearch([], "test query");

      expect(response.results).toHaveLength(0);
      expect(response.candidateCount).toBe(0);
    });
  });

  // ─── Mesh enabled — fan-out ─────────────────────────────────────────────

  describe("mesh enabled", () => {
    beforeEach(() => {
      initMeshConfig({ role: "primary", nodeName: "test-primary", orgId });
    });

    it("merges local and remote results sorted by similarity", async () => {
      mockHybridSearch.mockResolvedValue({
        results: [
          { chunkId: "local-0", chunk: "Local chunk", similarity: 0.85, metadata: { sourceDocument: "", documentName: "handbook.pdf", sectionPath: [], pageNumber: 1, heading: "", chunkIndex: 0 } },
        ],
        candidateCount: 1,
        hybridBoost: false,
      });

      mockSearchAllNodes.mockResolvedValue({
        results: [
          {
            nodeId: "remote-1",
            nodeName: "Branch Office",
            chunks: [
              { chunkId: "remote-ds-5", content: "Remote chunk", similarity: 0.92, documentName: "policy.pdf", sectionPath: [], heading: "Vacation", sourceName: "HR Docs" },
            ],
          },
        ],
        nodesSearched: 1,
        nodesUnavailable: 0,
      });

      const response = await routedSearch(["local-ds"], "vacation policy");

      expect(response.results).toHaveLength(2);
      // Remote result has higher similarity, should be first
      expect(response.results[0]!.chunkId).toBe("remote-ds-5");
      expect(response.results[0]!.similarity).toBe(0.92);
      expect(response.results[0]!.sourceNodeId).toBe("remote-1");
      expect(response.results[0]!.sourceNodeName).toBe("Branch Office");
      // Local result second
      expect(response.results[1]!.chunkId).toBe("local-0");
      expect(response.results[1]!.similarity).toBe(0.85);
      expect(response.meshNodesSearched).toBe(1);
    });

    it("deduplicates by chunkId, keeping highest similarity", async () => {
      mockHybridSearch.mockResolvedValue({
        results: [
          { chunkId: "shared-doc-0", chunk: "Local version", similarity: 0.80, metadata: { sourceDocument: "", sectionPath: [], pageNumber: 0, heading: "", chunkIndex: 0 } },
        ],
        candidateCount: 1,
        hybridBoost: false,
      });

      mockSearchAllNodes.mockResolvedValue({
        results: [
          {
            nodeId: "remote-1",
            nodeName: "Branch",
            chunks: [
              { chunkId: "shared-doc-0", content: "Remote version", similarity: 0.95, sourceName: "Docs" },
            ],
          },
        ],
        nodesSearched: 1,
        nodesUnavailable: 0,
      });

      const response = await routedSearch(["ds"], "test");

      // Same chunkId — only keep the one with higher similarity (remote: 0.95)
      expect(response.results).toHaveLength(1);
      expect(response.results[0]!.similarity).toBe(0.95);
      expect(response.results[0]!.sourceNodeId).toBe("remote-1");
    });

    it("caps results to maxCandidates", async () => {
      const localResults = Array.from({ length: 15 }, (_, i) => ({
        chunkId: `local-${i}`, chunk: `Chunk ${i}`, similarity: 0.9 - i * 0.01,
        metadata: { sourceDocument: "", sectionPath: [], pageNumber: 0, heading: "", chunkIndex: i },
      }));
      const remoteChunks = Array.from({ length: 15 }, (_, i) => ({
        chunkId: `remote-${i}`, content: `Remote ${i}`, similarity: 0.89 - i * 0.01, sourceName: "Src",
      }));

      mockHybridSearch.mockResolvedValue({ results: localResults, candidateCount: 15, hybridBoost: false });
      mockSearchAllNodes.mockResolvedValue({
        results: [{ nodeId: "n1", nodeName: "N1", chunks: remoteChunks }],
        nodesSearched: 1,
        nodesUnavailable: 0,
      });

      const response = await routedSearch(["ds"], "test", 10);

      expect(response.results).toHaveLength(10);
    });

    it("handles partial remote failures gracefully", async () => {
      mockHybridSearch.mockResolvedValue({
        results: [{ chunkId: "local-0", chunk: "Local", similarity: 0.85, metadata: { sourceDocument: "", sectionPath: [], pageNumber: 0, heading: "", chunkIndex: 0 } }],
        candidateCount: 1,
        hybridBoost: false,
      });

      mockSearchAllNodes.mockResolvedValue({
        results: [
          { nodeId: "ok-node", nodeName: "OK", chunks: [{ chunkId: "ok-0", content: "OK result", similarity: 0.88, sourceName: "Src" }] },
        ],
        nodesSearched: 1,
        nodesUnavailable: 2, // Two nodes failed
      });

      const response = await routedSearch(["ds"], "test");

      expect(response.results).toHaveLength(2);
      expect(response.meshNodesSearched).toBe(1);
      expect(response.meshNodesUnavailable).toBe(2);
    });

    it("passes allowedGroupIds to searchAllNodes", async () => {
      mockHybridSearch.mockResolvedValue({ results: [], candidateCount: 0, hybridBoost: false });
      mockSearchAllNodes.mockResolvedValue({ results: [], nodesSearched: 0, nodesUnavailable: 0 });

      const groupIds = [randomUUID(), randomUUID()];
      await routedSearch(["ds"], "test", 20, groupIds);

      expect(mockSearchAllNodes).toHaveBeenCalledWith("test", expect.objectContaining({ groupIds }));
    });

    it("skips mesh search when allowedGroupIds is empty array", async () => {
      mockHybridSearch.mockResolvedValue({
        results: [{ chunkId: "local-0", chunk: "Local", similarity: 0.85, metadata: { sourceDocument: "", sectionPath: [], pageNumber: 0, heading: "", chunkIndex: 0 } }],
        candidateCount: 1,
        hybridBoost: false,
      });

      const response = await routedSearch(["ds"], "test", 20, []);

      // Empty group array = no mesh access
      expect(mockSearchAllNodes).not.toHaveBeenCalled();
      expect(response.meshNodesSearched).toBe(0);
      expect(response.results).toHaveLength(1);
    });

    it("searches all groups when allowedGroupIds is undefined (admin)", async () => {
      mockHybridSearch.mockResolvedValue({ results: [], candidateCount: 0, hybridBoost: false });
      mockSearchAllNodes.mockResolvedValue({ results: [], nodesSearched: 0, nodesUnavailable: 0 });

      await routedSearch(["ds"], "test", 20, undefined);

      // undefined = admin, no groupIds filter
      expect(mockSearchAllNodes).toHaveBeenCalledWith("test", expect.not.objectContaining({ groupIds: expect.anything() }));
    });

    it("parses chunkIndex from remote chunkIds", async () => {
      mockHybridSearch.mockResolvedValue({ results: [], candidateCount: 0, hybridBoost: false });
      mockSearchAllNodes.mockResolvedValue({
        results: [
          {
            nodeId: "n1", nodeName: "N1",
            chunks: [
              { chunkId: "my-dataset-42", content: "Chunk 42", similarity: 0.9, sourceName: "Src" },
              { chunkId: "other-ds-7", content: "Chunk 7", similarity: 0.8, sourceName: "Src" },
            ],
          },
        ],
        nodesSearched: 1,
        nodesUnavailable: 0,
      });

      const response = await routedSearch(["ds"], "test");

      expect(response.results[0]!.metadata.chunkIndex).toBe(42);
      expect(response.results[1]!.metadata.chunkIndex).toBe(7);
    });
  });
});
