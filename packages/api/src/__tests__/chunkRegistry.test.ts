import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { escapeLikePattern, registerChunks, getChunkCountForDataset, clearChunksForDataset } from "../services/chunkRegistry.js";
import { setupTestApp, teardownTestApp } from "./helpers.js";

describe("chunkRegistry", () => {
  // ─── escapeLikePattern (unit) ──────────────────────────────────────────

  describe("escapeLikePattern", () => {
    it("escapes % wildcard", () => {
      expect(escapeLikePattern("test%name")).toBe("test\\%name");
    });

    it("escapes _ wildcard", () => {
      expect(escapeLikePattern("test_name")).toBe("test\\_name");
    });

    it("escapes backslash before wildcards", () => {
      expect(escapeLikePattern("test\\%")).toBe("test\\\\\\%");
    });

    it("leaves normal strings unchanged", () => {
      expect(escapeLikePattern("my-dataset")).toBe("my-dataset");
      expect(escapeLikePattern("knowledge-base")).toBe("knowledge-base");
    });

    it("handles multiple wildcards", () => {
      expect(escapeLikePattern("%test%_foo_")).toBe("\\%test\\%\\_foo\\_");
    });

    it("handles empty string", () => {
      expect(escapeLikePattern("")).toBe("");
    });
  });

  // ─── LIKE injection prevention (integration) ────────────────────────────

  describe("LIKE injection prevention", () => {
    beforeAll(() => { setupTestApp(); });
    afterAll(() => { teardownTestApp(); });

    it("dataset name with % does not match other datasets", () => {
      // Register chunks for two datasets
      registerChunks("alpha", 0, [
        { sourceDocument: "doc-alpha", sectionPath: [], pageNumber: 1, heading: "A", chunkIndex: 0 },
      ]);
      registerChunks("beta", 0, [
        { sourceDocument: "doc-beta", sectionPath: [], pageNumber: 1, heading: "B", chunkIndex: 0 },
      ]);

      // A malicious dataset name containing % should NOT match "alpha" or "beta"
      const count = getChunkCountForDataset("%");
      expect(count).toBe(0);

      // Clean up
      clearChunksForDataset("alpha");
      clearChunksForDataset("beta");
    });

    it("dataset name with _ does not match other datasets", () => {
      registerChunks("ab", 0, [
        { sourceDocument: "doc-ab", sectionPath: [], pageNumber: 1, heading: "AB", chunkIndex: 0 },
      ]);

      // _ matches any single char in LIKE — "a_" would match "ab" without escaping
      const count = getChunkCountForDataset("a_");
      expect(count).toBe(0);

      clearChunksForDataset("ab");
    });

    it("exact dataset name still matches correctly", () => {
      registerChunks("my-dataset", 0, [
        { sourceDocument: "doc-1", sectionPath: [], pageNumber: 1, heading: "H", chunkIndex: 0 },
        { sourceDocument: "doc-1", sectionPath: [], pageNumber: 1, heading: "H2", chunkIndex: 1 },
      ]);

      const count = getChunkCountForDataset("my-dataset");
      expect(count).toBe(2);

      clearChunksForDataset("my-dataset");

      // After clearing, count should be 0
      const countAfter = getChunkCountForDataset("my-dataset");
      expect(countAfter).toBe(0);
    });
  });
});
