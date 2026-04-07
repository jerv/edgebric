import { describe, it, expect } from "vitest";
import { buildMemoryContext } from "../rag/memoryContext.js";
import type { MemorySearchResult } from "../rag/memoryContext.js";

describe("memoryContext", () => {
  describe("buildMemoryContext", () => {
    it("returns empty string when search returns no results", async () => {
      const mockSearch = async (): Promise<MemorySearchResult[]> => [];
      const result = await buildMemoryContext("test query", mockSearch);
      expect(result).toBe("");
    });

    it("wraps memories in user_context XML tags", async () => {
      const mockSearch = async (): Promise<MemorySearchResult[]> => [
        { content: "Prefers concise answers", category: "preference", confidence: 0.95 },
      ];
      const result = await buildMemoryContext("how should I format", mockSearch);
      expect(result).toContain("<user_context>");
      expect(result).toContain("</user_context>");
    });

    it("numbers each memory entry", async () => {
      const mockSearch = async (): Promise<MemorySearchResult[]> => [
        { content: "Fact A", category: "fact", confidence: 0.9 },
        { content: "Fact B", category: "fact", confidence: 0.8 },
        { content: "Fact C", category: "fact", confidence: 0.7 },
      ];
      const result = await buildMemoryContext("test", mockSearch);
      expect(result).toContain("[1] Fact A");
      expect(result).toContain("[2] Fact B");
      expect(result).toContain("[3] Fact C");
    });

    it("includes descriptive header", async () => {
      const mockSearch = async (): Promise<MemorySearchResult[]> => [
        { content: "Some fact", category: "fact", confidence: 0.9 },
      ];
      const result = await buildMemoryContext("test", mockSearch);
      expect(result).toContain("known facts and preferences");
    });

    it("truncates to stay under ~800 chars of content", async () => {
      const longMemories: MemorySearchResult[] = Array.from({ length: 30 }, (_, i) => ({
        content: `Memory number ${i}: ${"x".repeat(50)}`,
        category: "fact",
        confidence: 0.9,
      }));
      const mockSearch = async (): Promise<MemorySearchResult[]> => longMemories;
      const result = await buildMemoryContext("test", mockSearch);
      // The content inside the tags should be limited
      const contentOnly = result.replace(/<\/?user_context>/g, "").trim();
      // Header line + entries should be under ~1000 chars (800 content + header)
      expect(contentOnly.length).toBeLessThan(1100);
    });

    it("passes query and topK to search function", async () => {
      let capturedQuery = "";
      let capturedTopK = 0;
      const mockSearch = async (q: string, k: number): Promise<MemorySearchResult[]> => {
        capturedQuery = q;
        capturedTopK = k;
        return [];
      };
      await buildMemoryContext("my specific query", mockSearch, 3);
      expect(capturedQuery).toBe("my specific query");
      expect(capturedTopK).toBe(3);
    });

    it("uses default maxResults of 5", async () => {
      let capturedTopK = 0;
      const mockSearch = async (_q: string, k: number): Promise<MemorySearchResult[]> => {
        capturedTopK = k;
        return [];
      };
      await buildMemoryContext("test", mockSearch);
      expect(capturedTopK).toBe(5);
    });

    it("handles single memory entry", async () => {
      const mockSearch = async (): Promise<MemorySearchResult[]> => [
        { content: "User is a lawyer", category: "fact", confidence: 1.0 },
      ];
      const result = await buildMemoryContext("test", mockSearch);
      expect(result).toContain("[1] User is a lawyer");
      expect(result).not.toContain("[2]");
    });
  });
});
