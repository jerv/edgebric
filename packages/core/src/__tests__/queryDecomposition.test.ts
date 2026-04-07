import { describe, it, expect } from "vitest";
import { isComplexQuery, decomposeQuery, searchWithDecomposition } from "../rag/queryDecomposition.js";
import type { SearchResult, GenerateFn, SearchFn } from "../rag/orchestrator.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSearchResult(
  chunkId: string,
  text: string,
  similarity: number,
): SearchResult {
  return {
    chunkId,
    chunk: text,
    similarity,
    metadata: {
      sourceDocument: "doc-1",
      documentName: "Test Doc",
      sectionPath: ["Section"],
      pageNumber: 1,
      heading: "Section",
      chunkIndex: 0,
    },
  };
}

function makeGenerateFn(response: string): GenerateFn {
  return async function* () {
    yield response;
  };
}

function makeSearchFn(resultsByQuery: Map<string, SearchResult[]>): SearchFn {
  return async (query: string, _topK: number) => {
    return resultsByQuery.get(query) ?? [];
  };
}

// ─── isComplexQuery ─────────────────────────────────────────────────────────

describe("isComplexQuery", () => {
  it("returns false for simple queries", () => {
    expect(isComplexQuery("What is our PTO policy?")).toBe(false);
    expect(isComplexQuery("How many vacation days do I get?")).toBe(false);
    expect(isComplexQuery("Tell me about the onboarding process")).toBe(false);
  });

  it("detects comparison queries", () => {
    expect(isComplexQuery("PTO vs sick leave")).toBe(true);
    expect(isComplexQuery("Compare the health plans")).toBe(true);
    expect(isComplexQuery("What is the difference between plan A and plan B?")).toBe(true);
    expect(isComplexQuery("How does our PTO differ from competitors?")).toBe(true);
  });

  it("detects multi-part questions (multiple question marks)", () => {
    expect(isComplexQuery("What is PTO? What about sick leave?")).toBe(true);
  });

  it("detects multi-topic conjunctions", () => {
    expect(isComplexQuery("Explain PTO and also the parental leave policy")).toBe(true);
    expect(isComplexQuery("Benefits as well as compensation")).toBe(true);
    expect(isComplexQuery("Onboarding in addition to training requirements")).toBe(true);
  });

  it("detects which-is-better patterns", () => {
    expect(isComplexQuery("Which is better, plan A or plan B?")).toBe(true);
  });
});

// ─── decomposeQuery ─────────────────────────────────────────────────────────

describe("decomposeQuery", () => {
  it("parses valid JSON array response", async () => {
    const generate = makeGenerateFn('["PTO policy details", "parental leave policy details"]');
    const result = await decomposeQuery("Compare PTO and parental leave", generate);
    expect(result).toEqual(["PTO policy details", "parental leave policy details"]);
  });

  it("handles markdown-wrapped JSON response", async () => {
    const generate = makeGenerateFn('```json\n["query one", "query two"]\n```');
    const result = await decomposeQuery("Complex query", generate);
    expect(result).toEqual(["query one", "query two"]);
  });

  it("falls back to original query on invalid JSON", async () => {
    const generate = makeGenerateFn("I can't parse this into queries");
    const result = await decomposeQuery("My original query", generate);
    expect(result).toEqual(["My original query"]);
  });

  it("falls back to original query on empty array", async () => {
    const generate = makeGenerateFn("[]");
    const result = await decomposeQuery("My original query", generate);
    expect(result).toEqual(["My original query"]);
  });

  it("caps sub-queries at 4", async () => {
    const generate = makeGenerateFn('["a", "b", "c", "d", "e", "f"]');
    const result = await decomposeQuery("Many parts", generate);
    expect(result).toHaveLength(4);
  });

  it("filters out non-string entries", async () => {
    const generate = makeGenerateFn('[123, "valid query", null, "another query"]');
    const result = await decomposeQuery("Test", generate);
    expect(result).toEqual(["valid query", "another query"]);
  });
});

// ─── searchWithDecomposition ────────────────────────────────────────────────

describe("searchWithDecomposition", () => {
  it("deduplicates results from multiple sub-queries by chunkId", async () => {
    const generate = makeGenerateFn('["PTO policy", "leave policy"]');

    const resultsByQuery = new Map<string, SearchResult[]>();
    resultsByQuery.set("PTO policy", [
      makeSearchResult("chunk-1", "PTO is 15 days", 0.9),
      makeSearchResult("chunk-2", "Sick leave is 5 days", 0.7),
    ]);
    resultsByQuery.set("leave policy", [
      makeSearchResult("chunk-1", "PTO is 15 days", 0.85), // Duplicate
      makeSearchResult("chunk-3", "Parental leave is 12 weeks", 0.8),
    ]);

    const search = makeSearchFn(resultsByQuery);
    const { results, subQueries } = await searchWithDecomposition(
      "Compare PTO and leave", search, generate, 10,
    );

    expect(subQueries).toEqual(["PTO policy", "leave policy"]);
    expect(results).toHaveLength(3); // 3 unique chunks
    // chunk-1 should keep the higher similarity (0.9 from first query)
    const chunk1 = results.find((r) => r.chunkId === "chunk-1");
    expect(chunk1?.similarity).toBe(0.9);
  });

  it("returns sorted by similarity descending", async () => {
    const generate = makeGenerateFn('["q1", "q2"]');

    const resultsByQuery = new Map<string, SearchResult[]>();
    resultsByQuery.set("q1", [makeSearchResult("a", "text a", 0.5)]);
    resultsByQuery.set("q2", [makeSearchResult("b", "text b", 0.9)]);

    const search = makeSearchFn(resultsByQuery);
    const { results } = await searchWithDecomposition("test", search, generate, 10);

    expect(results[0]!.chunkId).toBe("b");
    expect(results[1]!.chunkId).toBe("a");
  });

  it("passes through single sub-query without merging", async () => {
    const generate = makeGenerateFn('["simple query"]');
    const searchResults = [makeSearchResult("chunk-1", "text", 0.8)];
    const search: SearchFn = async () => searchResults;

    const { results, subQueries } = await searchWithDecomposition(
      "simple query", search, generate, 10,
    );

    expect(subQueries).toEqual(["simple query"]);
    expect(results).toEqual(searchResults);
  });
});
