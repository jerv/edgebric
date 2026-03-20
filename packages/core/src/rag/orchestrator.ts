import type { AnswerResponse, Citation, Chunk, Session } from "@edgebric/types";
import { randomUUID } from "crypto";
import { filterQuery } from "./queryFilter.js";
import { buildSystemPrompt, NO_ANSWER_RESPONSE } from "./systemPrompt.js";

// ─── Dependency interfaces ─────────────────────────────────────────────────────
// The orchestrator has no knowledge of mimik, HTTP, or any specific library.
// Real implementations are injected by the API layer.
// Test implementations are injected by tests.

export interface SearchResult {
  chunkId: string;
  chunk: string;
  similarity: number;
  metadata: Chunk["metadata"];
}

export interface SearchFn {
  /** Query text — mKB embeds it internally via GEN_AI_EMBEDDING_URI. */
  (query: string, topK: number): Promise<SearchResult[]>;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface GenerateFn {
  (messages: Message[]): AsyncIterable<string>;
}

export interface OrchestratorDeps {
  search: SearchFn;
  generate: GenerateFn;
}

export interface RAGOptions {
  topK?: number;
  /** Primary dataset name (backward compat). */
  datasetName: string;
  /** All datasets being searched. Defaults to [datasetName] if not provided. */
  datasetNames?: string[];
  /** Minimum similarity score to consider a chunk relevant (0–1). */
  similarityThreshold?: number;
}

// ─── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Core RAG pipeline.
 *
 * Flow:
 * 1. Filter query (person + sensitive term → redirect)
 * 2. Embed query
 * 3. Retrieve top-k chunks
 * 4. If no relevant chunks → return no-answer response
 * 5. Build system prompt with context
 * 6. Generate streamed answer
 * 7. Return answer + citations
 *
 * All I/O is injected via deps — this function is pure business logic.
 */
export async function* answerStream(
  query: string,
  session: Session,
  options: RAGOptions,
  deps: OrchestratorDeps,
): AsyncIterable<{ delta?: string; final?: AnswerResponse }> {
  const topK = options.topK ?? 5;
  const threshold = options.similarityThreshold ?? 0.3;

  // Layer 4: query filter
  const filter = filterQuery(query);
  if (!filter.allowed) {
    const response: AnswerResponse = {
      answer: filter.redirectMessage ?? NO_ANSWER_RESPONSE,
      citations: [],
      hasConfidentAnswer: false,
      sessionId: session.id,
    };
    yield { final: response };
    return;
  }

  // Retrieve relevant chunks (mKB handles embedding internally)
  const searchResults = await deps.search(query, topK);
  const relevantResults = searchResults.filter((r) => r.similarity >= threshold);

  if (relevantResults.length === 0) {
    const response: AnswerResponse = {
      answer: NO_ANSWER_RESPONSE,
      citations: [],
      hasConfidentAnswer: false,
      sessionId: session.id,
      searchedDatasets: options.datasetNames ?? [options.datasetName],
    };
    yield { final: response };
    return;
  }

  // Build context chunks from search results
  const contextChunks: Chunk[] = relevantResults.map((r) => ({
    id: r.chunkId,
    documentId: r.metadata.sourceDocument,
    content: r.chunk,
    metadata: r.metadata,
    embeddingId: r.chunkId,
  }));

  // Build messages for generation
  const systemPrompt = buildSystemPrompt(contextChunks);
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    // Callers manage context window (solo chat: last 4, group chat: summarized + last 10)
    ...session.messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    })),
  ];

  // Stream the answer
  let fullAnswer = "";
  for await (const delta of deps.generate(messages)) {
    fullAnswer += delta;
    yield { delta };
  }

  // Detect if the model declined to answer from context (said it couldn't find info).
  const noAnswerPattern = /couldn'?t find a clear answer|not (?:found|covered|mentioned|addressed) in (?:the |any )?(?:current |provided |available )?(?:documentation|documents|context|policy)/i;
  const modelDeclined = noAnswerPattern.test(fullAnswer);

  // Build citations from the chunks that were used as context —
  // but only if the model actually used the context to answer.
  const citations: Citation[] = modelDeclined
    ? []
    : relevantResults.map((r) => ({
        documentId: r.metadata.sourceDocument,
        documentName: r.metadata.documentName ?? r.metadata.sourceDocument,
        sectionPath: r.metadata.sectionPath,
        pageNumber: r.metadata.pageNumber,
        excerpt: r.chunk.slice(0, 300),
      }));

  const response: AnswerResponse = {
    answer: fullAnswer,
    citations,
    hasConfidentAnswer: !modelDeclined,
    sessionId: session.id,
    searchedDatasets: options.datasetNames ?? [options.datasetName],
  };

  yield { final: response };
}

/** Convenience wrapper for non-streaming use in tests. */
export async function answer(
  query: string,
  session: Session,
  options: RAGOptions,
  deps: OrchestratorDeps,
): Promise<AnswerResponse> {
  let result: AnswerResponse | undefined;
  for await (const chunk of answerStream(query, session, options, deps)) {
    if (chunk.final) result = chunk.final;
  }
  if (!result) throw new Error("answerStream produced no final result");
  return result;
}

export function createSession(): Session {
  return {
    id: randomUUID(),
    createdAt: new Date(),
    messages: [],
  };
}
