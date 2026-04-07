import { describe, it, expect } from "vitest";
import { rerankResults } from "../rag/reranker.js";
import type { SearchResult, GenerateFn } from "../rag/orchestrator.js";

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

// ─── rerankResults ──────────────────────────────────────────────────────────

describe("rerankResults", () => {
  it("re-sorts results by LLM relevance score", async () => {
    const results = [
      makeSearchResult("a", "Unrelated text", 0.9),
      makeSearchResult("b", "Relevant answer", 0.5),
      makeSearchResult("c", "Somewhat related", 0.7),
    ];

    // LLM says chunk b is most relevant (score 5), a is least (score 1)
    const generate = makeGenerateFn(
      '[{"index":0,"score":1},{"index":1,"score":5},{"index":2,"score":3}]',
    );

    const reranked = await rerankResults("test query", results, generate, 3);

    expect(reranked).toHaveLength(3);
    expect(reranked[0]!.chunkId).toBe("b");
    expect(reranked[0]!.relevanceScore).toBe(5);
    expect(reranked[1]!.chunkId).toBe("c");
    expect(reranked[1]!.relevanceScore).toBe(3);
    expect(reranked[2]!.chunkId).toBe("a");
    expect(reranked[2]!.relevanceScore).toBe(1);
  });

  it("trims results to topN", async () => {
    const results = [
      makeSearchResult("a", "text a", 0.9),
      makeSearchResult("b", "text b", 0.8),
      makeSearchResult("c", "text c", 0.7),
      makeSearchResult("d", "text d", 0.6),
    ];

    const generate = makeGenerateFn(
      '[{"index":0,"score":4},{"index":1,"score":5},{"index":2,"score":2},{"index":3,"score":1}]',
    );

    const reranked = await rerankResults("query", results, generate, 2);
    expect(reranked).toHaveLength(2);
    expect(reranked[0]!.chunkId).toBe("b"); // score 5
    expect(reranked[1]!.chunkId).toBe("a"); // score 4
  });

  it("handles malformed LLM response gracefully (default score 3)", async () => {
    const results = [
      makeSearchResult("a", "text a", 0.9),
      makeSearchResult("b", "text b", 0.5),
    ];

    const generate = makeGenerateFn("Sorry, I cannot rate these chunks.");

    const reranked = await rerankResults("query", results, generate, 5);
    // All get default score of 3, so sort by similarity tiebreaker
    expect(reranked).toHaveLength(2);
    expect(reranked[0]!.relevanceScore).toBe(3);
    expect(reranked[0]!.chunkId).toBe("a"); // higher similarity wins
    expect(reranked[1]!.chunkId).toBe("b");
  });

  it("returns single result with default score", async () => {
    const results = [makeSearchResult("a", "text a", 0.8)];
    const generate = makeGenerateFn("unused");

    const reranked = await rerankResults("query", results, generate, 5);
    expect(reranked).toHaveLength(1);
    expect(reranked[0]!.relevanceScore).toBe(3);
  });

  it("returns empty array for empty input", async () => {
    const generate = makeGenerateFn("unused");
    const reranked = await rerankResults("query", [], generate, 5);
    expect(reranked).toHaveLength(0);
  });

  it("handles markdown-wrapped JSON response", async () => {
    const results = [
      makeSearchResult("a", "text a", 0.9),
      makeSearchResult("b", "text b", 0.5),
    ];

    const generate = makeGenerateFn(
      '```json\n[{"index":0,"score":2},{"index":1,"score":4}]\n```',
    );

    const reranked = await rerankResults("query", results, generate, 5);
    expect(reranked[0]!.chunkId).toBe("b"); // score 4
    expect(reranked[1]!.chunkId).toBe("a"); // score 2
  });

  it("ignores out-of-range scores", async () => {
    const results = [
      makeSearchResult("a", "text a", 0.9),
      makeSearchResult("b", "text b", 0.5),
    ];

    // Score 10 is out of range (max 5), index 5 is out of range
    const generate = makeGenerateFn(
      '[{"index":0,"score":10},{"index":5,"score":4},{"index":1,"score":4}]',
    );

    const reranked = await rerankResults("query", results, generate, 5);
    // Only index 1 with score 4 is valid, index 0 gets default 3
    expect(reranked[0]!.chunkId).toBe("b"); // score 4
    expect(reranked[1]!.chunkId).toBe("a"); // default 3
  });

  it("uses similarity as tiebreaker when scores are equal", async () => {
    const results = [
      makeSearchResult("a", "text a", 0.5),
      makeSearchResult("b", "text b", 0.9),
    ];

    const generate = makeGenerateFn(
      '[{"index":0,"score":4},{"index":1,"score":4}]',
    );

    const reranked = await rerankResults("query", results, generate, 5);
    // Same score, b has higher similarity
    expect(reranked[0]!.chunkId).toBe("b");
    expect(reranked[1]!.chunkId).toBe("a");
  });
});
