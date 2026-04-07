import { describe, it, expect } from "vitest";
import { isConfident, reformulateQuery, iterativeRetrieve } from "../rag/iterativeRetrieval.js";
import type { RerankedResult } from "../rag/reranker.js";
import type { SearchResult, GenerateFn, SearchFn } from "../rag/orchestrator.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRerankedResult(
  chunkId: string,
  text: string,
  similarity: number,
  relevanceScore: number,
): RerankedResult {
  return {
    chunkId,
    chunk: text,
    similarity,
    relevanceScore,
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

/**
 * Create a generate function that returns different responses
 * for sequential calls (reformulation prompt, then re-ranking prompt).
 */
function makeSequentialGenerateFn(responses: string[]): GenerateFn {
  let callIndex = 0;
  return async function* () {
    const response = responses[callIndex] ?? responses[responses.length - 1]!;
    callIndex++;
    yield response;
  };
}

// ─── isConfident ────────────────────────────────────────────────────────────

describe("isConfident", () => {
  it("returns false for empty results", () => {
    expect(isConfident([])).toBe(false);
  });

  it("returns false when top score is <= 2", () => {
    const results = [
      makeRerankedResult("a", "text", 0.8, 2),
      makeRerankedResult("b", "text", 0.7, 1),
      makeRerankedResult("c", "text", 0.6, 1),
    ];
    expect(isConfident(results)).toBe(false);
  });

  it("returns false when fewer than 3 chunks score >= 3", () => {
    const results = [
      makeRerankedResult("a", "text", 0.9, 5),
      makeRerankedResult("b", "text", 0.8, 4),
      makeRerankedResult("c", "text", 0.7, 2),
      makeRerankedResult("d", "text", 0.6, 1),
    ];
    // Only 2 chunks >= 3 (a=5, b=4)
    expect(isConfident(results)).toBe(false);
  });

  it("returns true when top score > 2 and >= 3 chunks score >= 3", () => {
    const results = [
      makeRerankedResult("a", "text", 0.9, 5),
      makeRerankedResult("b", "text", 0.8, 4),
      makeRerankedResult("c", "text", 0.7, 3),
      makeRerankedResult("d", "text", 0.6, 2),
    ];
    // 3 chunks >= 3 (a=5, b=4, c=3) and top > 2
    expect(isConfident(results)).toBe(true);
  });

  it("returns true when all chunks score high", () => {
    const results = [
      makeRerankedResult("a", "text", 0.9, 5),
      makeRerankedResult("b", "text", 0.8, 5),
      makeRerankedResult("c", "text", 0.7, 4),
    ];
    expect(isConfident(results)).toBe(true);
  });
});

// ─── reformulateQuery ───────────────────────────────────────────────────────

describe("reformulateQuery", () => {
  it("parses valid reformulated queries", async () => {
    const generate = makeGenerateFn(
      '["new hire orientation steps", "onboarding requirements"]',
    );
    const result = await reformulateQuery("employee onboarding checklist", generate);
    expect(result).toEqual(["new hire orientation steps", "onboarding requirements"]);
  });

  it("returns empty array on parse failure", async () => {
    const generate = makeGenerateFn("I don't understand");
    const result = await reformulateQuery("test", generate);
    expect(result).toEqual([]);
  });

  it("caps at 3 reformulated queries", async () => {
    const generate = makeGenerateFn('["a", "b", "c", "d", "e"]');
    const result = await reformulateQuery("test", generate);
    expect(result).toHaveLength(3);
  });
});

// ─── iterativeRetrieve ──────────────────────────────────────────────────────

describe("iterativeRetrieve", () => {
  it("skips second round when first round is confident", async () => {
    const confidentResults = [
      makeRerankedResult("a", "text a", 0.9, 5),
      makeRerankedResult("b", "text b", 0.8, 4),
      makeRerankedResult("c", "text c", 0.7, 3),
    ];

    const generate = makeGenerateFn("should not be called");
    const search: SearchFn = async () => {
      throw new Error("Search should not be called for confident results");
    };

    const { results, iterationCount } = await iterativeRetrieve(
      "query", confidentResults, search, generate, 10,
    );

    expect(iterationCount).toBe(1);
    expect(results).toBe(confidentResults); // Same reference — no processing
  });

  it("performs second round when first round is low confidence", async () => {
    const lowConfidenceResults = [
      makeRerankedResult("a", "barely relevant", 0.5, 2),
      makeRerankedResult("b", "not relevant", 0.3, 1),
    ];

    // First call: reformulation, second call: re-ranking
    const generate = makeSequentialGenerateFn([
      '["alternative search term", "related concept"]',
      // Re-ranking scores for combined results (a, b from round 1 + c, d from round 2)
      '[{"index":0,"score":2},{"index":1,"score":1},{"index":2,"score":5},{"index":3,"score":4}]',
    ]);

    const search: SearchFn = async (query: string) => {
      if (query === "alternative search term") {
        return [makeSearchResult("c", "much better result", 0.8)];
      }
      if (query === "related concept") {
        return [makeSearchResult("d", "also good", 0.7)];
      }
      return [];
    };

    const { results, iterationCount } = await iterativeRetrieve(
      "original query", lowConfidenceResults, search, generate, 10, 3,
    );

    expect(iterationCount).toBe(2);
    // Should have results from both rounds, re-ranked
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3); // topN = 3
  });

  it("deduplicates second-round results against first round", async () => {
    const lowConfidenceResults = [
      makeRerankedResult("a", "some text", 0.5, 2),
      makeRerankedResult("b", "other text", 0.3, 1),
    ];

    const generate = makeSequentialGenerateFn([
      '["reformulated"]',
      // Re-ranking for combined (only a, b since c is a dupe of a)
      '[{"index":0,"score":3},{"index":1,"score":2}]',
    ]);

    // Second round returns a duplicate of chunk "a"
    const search: SearchFn = async () => [
      makeSearchResult("a", "some text", 0.6), // Duplicate of first-round chunk
    ];

    const { results, iterationCount } = await iterativeRetrieve(
      "query", lowConfidenceResults, search, generate, 10,
    );

    expect(iterationCount).toBe(2);
    // chunk "a" should only appear once
    const chunkACount = results.filter((r) => r.chunkId === "a").length;
    expect(chunkACount).toBeLessThanOrEqual(1);
  });

  it("keeps first-round results when reformulation fails", async () => {
    const lowConfidenceResults = [
      makeRerankedResult("a", "text", 0.5, 2),
    ];

    const generate = makeGenerateFn("I can't reformulate this");
    const search: SearchFn = async () => [];

    const { results, iterationCount } = await iterativeRetrieve(
      "query", lowConfidenceResults, search, generate, 10,
    );

    expect(iterationCount).toBe(1);
    expect(results).toEqual(lowConfidenceResults);
  });

  it("keeps first-round results when second round finds nothing new", async () => {
    const lowConfidenceResults = [
      makeRerankedResult("a", "text", 0.5, 2),
    ];

    const generate = makeSequentialGenerateFn([
      '["reformulated query"]',
    ]);

    // Second round search returns empty
    const search: SearchFn = async () => [];

    const { results, iterationCount } = await iterativeRetrieve(
      "query", lowConfidenceResults, search, generate, 10,
    );

    expect(iterationCount).toBe(2);
    expect(results).toEqual(lowConfidenceResults);
  });
});
