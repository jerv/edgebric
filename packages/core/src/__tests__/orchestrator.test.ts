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

  it("returns no-answer in strict mode when no chunks found", async () => {
    const response = await answer("Something obscure?", makeSession(), strictOptions, makeDeps([]));
    expect(response.hasConfidentAnswer).toBe(false);
    expect(response.citations).toHaveLength(0);
    expect(response.answer).toContain("couldn't find");
  });

  it("generates general-knowledge answer in permissive mode when no chunks found", async () => {
    const response = await answer("What is photosynthesis?", makeSession(), defaultOptions, makeDeps([], "Photosynthesis is how plants make energy."));
    expect(response.hasConfidentAnswer).toBe(false);
    expect(response.answerType).toBe("general");
    expect(response.citations).toHaveLength(0);
    expect(response.answer).toContain("Photosynthesis");
  });

  it("returns no-answer when all chunks below similarity threshold", async () => {
    const results = [
      makeSearchResult("Unrelated text", 0.1),
      makeSearchResult("Also unrelated", 0.2),
    ];
    const response = await answer("Something specific?", makeSession(), strictOptions, makeDeps(results));
    expect(response.hasConfidentAnswer).toBe(false);
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

  it("yields only final for no-answer in strict mode (no deltas)", async () => {
    const deltas: string[] = [];
    let finalResponse;

    for await (const chunk of answerStream("Unknown?", makeSession(), strictOptions, makeDeps([]))) {
      if (chunk.delta) deltas.push(chunk.delta);
      if (chunk.final) finalResponse = chunk.final;
    }

    expect(deltas).toHaveLength(0);
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
