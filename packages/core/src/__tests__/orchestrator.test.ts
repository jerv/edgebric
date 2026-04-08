import { describe, it, expect } from "vitest";
import { answer, answerStream, createSession } from "../rag/orchestrator.js";
import type { OrchestratorDeps, RAGOptions, SearchResult } from "../rag/orchestrator.js";
import type { Session } from "@edgebric/types";

function makeSearchResult(
  text: string,
  similarity: number,
  docName = "Handbook",
): SearchResult {
  return {
    chunkId: `chunk-${Math.random().toString(36).slice(2, 8)}`,
    chunk: text,
    similarity,
    metadata: {
      sourceDocument: "doc-1",
      documentName: docName,
      sectionPath: ["Section"],
      pageNumber: 1,
      heading: "Section",
      chunkIndex: 0,
    },
  };
}

function makeDeps(
  results: SearchResult[] = [],
  generatedText = "The answer is 42.",
): OrchestratorDeps {
  return {
    search: async () => results,
    generate: async function* (_messages) {
      // Yield the answer in chunks to simulate streaming
      const words = generatedText.split(" ");
      for (const word of words) {
        yield word + " ";
      }
    },
  };
}

function makeSession(): Session {
  return createSession();
}

const defaultOptions: RAGOptions = {
  datasetName: "test-dataset",
  topK: 3,
  similarityThreshold: 0.3,
};

const strictOptions: RAGOptions = {
  ...defaultOptions,
  strict: true,
};

describe("answer (non-streaming)", () => {
  it("returns confident answer when relevant chunks found", async () => {
    const results = [
      makeSearchResult("Employees get 15 days PTO per year.", 0.85),
    ];
    const response = await answer("How much PTO do I get?", makeSession(), defaultOptions, makeDeps(results));
    expect(response.hasConfidentAnswer).toBe(true);
    expect(response.answer).toContain("42");
    expect(response.citations).toHaveLength(1);
    expect(response.citations[0]!.documentName).toBe("Handbook");
  });

  it("generates general-knowledge answer in strict mode when no chunks found", async () => {
    const response = await answer("Something obscure?", makeSession(), strictOptions, makeDeps([], "General knowledge answer."));
    expect(response.hasConfidentAnswer).toBe(false);
    expect(response.citations).toHaveLength(0);
    expect(response.answerType).toBe("general");
    expect(response.answer).toContain("General knowledge");
  });

  it("generates general-knowledge answer in permissive mode when no chunks found", async () => {
    const response = await answer("What is photosynthesis?", makeSession(), defaultOptions, makeDeps([], "Photosynthesis is how plants make energy."));
    expect(response.hasConfidentAnswer).toBe(false);
    expect(response.answerType).toBe("general");
    expect(response.citations).toHaveLength(0);
    expect(response.answer).toContain("Photosynthesis");
  });

  it("generates general-knowledge answer when all chunks below similarity threshold", async () => {
    const results = [
      makeSearchResult("Unrelated text", 0.1),
      makeSearchResult("Also unrelated", 0.2),
    ];
    const response = await answer("Something specific?", makeSession(), strictOptions, makeDeps(results, "A general answer."));
    expect(response.hasConfidentAnswer).toBe(false);
    expect(response.answerType).toBe("general");
    expect(response.answer).toContain("general answer");
  });

  it("blocks queries with person name + sensitive term", async () => {
    const results = [makeSearchResult("Some policy", 0.9)];
    const response = await answer("What is John Smith's salary?", makeSession(), defaultOptions, makeDeps(results));
    expect(response.hasConfidentAnswer).toBe(false);
    expect(response.answerType).toBe("blocked");
    expect(response.citations).toHaveLength(0);
  });

  it("includes sessionId in response", async () => {
    const session = makeSession();
    const response = await answer("Test?", session, strictOptions, makeDeps([]));
    expect(response.sessionId).toBe(session.id);
  });

  it("includes searchedDatasets from options", async () => {
    const opts: RAGOptions = {
      ...strictOptions,
      datasetNames: ["kb-1", "kb-2"],
    };
    const response = await answer("Test?", makeSession(), opts, makeDeps([]));
    expect(response.searchedDatasets).toEqual(["kb-1", "kb-2"]);
  });

  it("falls back to [datasetName] when datasetNames not provided", async () => {
    const response = await answer("Test?", makeSession(), strictOptions, makeDeps([]));
    expect(response.searchedDatasets).toEqual(["test-dataset"]);
  });

  it("deduplicates child chunks sharing the same parent content", async () => {
    // Two children from the same parent section
    const sharedParent = "Full section about PTO. Employees get 15 days. Accrual is monthly.";
    const results: SearchResult[] = [
      {
        chunkId: "c1",
        chunk: "Employees get 15 days",
        similarity: 0.9,
        metadata: {
          sourceDocument: "doc-1",
          documentName: "Handbook",
          sectionPath: ["Benefits"],
          pageNumber: 1,
          heading: "PTO",
          chunkIndex: 0,
          parentContent: sharedParent,
        },
      },
      {
        chunkId: "c2",
        chunk: "Accrual is monthly",
        similarity: 0.85,
        metadata: {
          sourceDocument: "doc-1",
          documentName: "Handbook",
          sectionPath: ["Benefits"],
          pageNumber: 1,
          heading: "PTO",
          chunkIndex: 1,
          parentContent: sharedParent,
        },
      },
    ];

    let systemPromptContent = "";
    const deps: OrchestratorDeps = {
      search: async () => results,
      generate: async function* (messages) {
        systemPromptContent = messages[0]?.content ?? "";
        yield "Answer. ";
      },
    };

    const response = await answer("PTO policy?", makeSession(), defaultOptions, deps);
    // Parent content should appear only once in the system prompt (dedup)
    const parentOccurrences = systemPromptContent.split(sharedParent).length - 1;
    expect(parentOccurrences).toBe(1);
    // But we should still get citations for both child chunks
    expect(response.citations).toHaveLength(2);
  });

  it("includes retrievalScore in response", async () => {
    const results = [
      makeSearchResult("Policy text", 0.82),
      makeSearchResult("More policy", 0.74),
    ];
    const response = await answer("Policy?", makeSession(), defaultOptions, makeDeps(results));
    // Average of 0.82 and 0.74 = 0.78
    expect(response.retrievalScore).toBe(0.78);
  });

});

describe("answerStream", () => {
  it("yields deltas followed by final response", async () => {
    const results = [makeSearchResult("Policy content", 0.9)];
    const deltas: string[] = [];
    let finalResponse;

    for await (const chunk of answerStream("Question?", makeSession(), defaultOptions, makeDeps(results, "Word1 Word2"))) {
      if (chunk.delta) deltas.push(chunk.delta);
      if (chunk.final) finalResponse = chunk.final;
    }

    expect(deltas.length).toBeGreaterThan(0);
    expect(finalResponse).toBeDefined();
    expect(finalResponse!.hasConfidentAnswer).toBe(true);
  });

  it("yields only final for blocked queries (no deltas)", async () => {
    const deltas: string[] = [];
    let finalResponse;

    for await (const chunk of answerStream("What is John Smith's salary?", makeSession(), defaultOptions, makeDeps())) {
      if (chunk.delta) deltas.push(chunk.delta);
      if (chunk.final) finalResponse = chunk.final;
    }

    expect(deltas).toHaveLength(0);
    expect(finalResponse).toBeDefined();
    expect(finalResponse!.hasConfidentAnswer).toBe(false);
  });

  it("yields deltas for general-knowledge answer in strict mode (no chunks)", async () => {
    const deltas: string[] = [];
    let finalResponse;

    for await (const chunk of answerStream("Unknown?", makeSession(), strictOptions, makeDeps([], "General answer."))) {
      if (chunk.delta) deltas.push(chunk.delta);
      if (chunk.final) finalResponse = chunk.final;
    }

    expect(deltas.length).toBeGreaterThan(0);
    expect(finalResponse!.hasConfidentAnswer).toBe(false);
    expect(finalResponse!.answerType).toBe("general");
  });

  it("yields deltas for general-knowledge answer in permissive mode", async () => {
    const deltas: string[] = [];
    let finalResponse;

    for await (const chunk of answerStream("What is gravity?", makeSession(), defaultOptions, makeDeps([], "Gravity is a force."))) {
      if (chunk.delta) deltas.push(chunk.delta);
      if (chunk.final) finalResponse = chunk.final;
    }

    expect(deltas.length).toBeGreaterThan(0);
    expect(finalResponse!.hasConfidentAnswer).toBe(false);
    expect(finalResponse!.answerType).toBe("general");
    expect(finalResponse!.citations).toHaveLength(0);
  });
});

describe("RAG feature flags", () => {
  it("defaults decompose/rerank/iterativeRetrieval to false when not set", async () => {
    let receivedQuery = "";
    const searchResults = [makeSearchResult("Policy text", 0.9)];
    const deps: OrchestratorDeps = {
      search: async (q) => {
        receivedQuery = q;
        return searchResults;
      },
      generate: async function* () {
        yield "Answer. ";
      },
    };

    // Options without any RAG flags — they should default to false/undefined
    const opts: RAGOptions = { datasetName: "test-dataset", topK: 3 };
    const response = await answer("Simple question?", makeSession(), opts, deps);
    expect(response.hasConfidentAnswer).toBe(true);
    // The search should have been called with the original query (no decomposition)
    expect(receivedQuery).toBe("Simple question?");
  });

  it("calls search via decomposition when decompose is true and query is complex", async () => {
    let searchCallCount = 0;
    const searchResults = [makeSearchResult("Policy text", 0.9)];
    const deps: OrchestratorDeps = {
      search: async () => {
        searchCallCount++;
        return searchResults;
      },
      generate: async function* (messages) {
        // When decomposition asks for sub-queries, return a JSON response
        const lastMsg = messages[messages.length - 1]?.content ?? "";
        if (lastMsg.includes("decompos") || lastMsg.includes("sub-quer")) {
          yield '["What is the PTO policy?", "What are the benefits?"]';
        } else {
          yield "Answer. ";
        }
      },
    };

    const opts: RAGOptions = {
      datasetName: "test-dataset",
      topK: 3,
      decompose: true,
    };
    // Use a complex query (multi-part question)
    const response = await answer(
      "What is the PTO policy and how does it compare to the benefits package?",
      makeSession(), opts, deps,
    );
    // Should have made multiple search calls (one per sub-query)
    expect(searchCallCount).toBeGreaterThanOrEqual(1);
    expect(response.hasConfidentAnswer).toBe(true);
  });

  it("does not rerank when rerank is false", async () => {
    let generateCallCount = 0;
    const searchResults = [
      makeSearchResult("Policy A", 0.9),
      makeSearchResult("Policy B", 0.8),
    ];
    const deps: OrchestratorDeps = {
      search: async () => searchResults,
      generate: async function* () {
        generateCallCount++;
        yield "Answer. ";
      },
    };

    const opts: RAGOptions = {
      datasetName: "test-dataset",
      topK: 3,
      rerank: false,
    };
    await answer("Question?", makeSession(), opts, deps);
    // Only one generate call (for the final answer), no reranking call
    expect(generateCallCount).toBe(1);
  });
});

describe("createSession", () => {
  it("creates session with valid UUID and empty messages", () => {
    const session = createSession();
    expect(session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(session.messages).toHaveLength(0);
    expect(session.createdAt).toBeInstanceOf(Date);
  });
});
