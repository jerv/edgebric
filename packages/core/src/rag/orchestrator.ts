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
  /** Number of candidate chunks found before filtering (for confidence signals). */
  candidateCount?: number;
  /** Whether BM25 keyword search surfaced results that vector missed. */
  hybridBoost?: boolean;
  /** Average retrieval score from search service. */
  retrievalScore?: number;
}

// ─── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Core RAG pipeline.
 *
 * Flow:
 * 1. Filter query (person + sensitive term → redirect)
 * 2. Search (hybrid BM25+vector with adaptive top-K, done by caller)
 * 3. If no relevant chunks → return no-answer response
 * 4. Use parent content for LLM context (parent-child retrieval)
 * 5. Build system prompt with context
 * 6. Generate streamed answer
 * 7. Return answer + citations with confidence signals
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

  // Retrieve relevant chunks (search service handles hybrid + reranking)
  const searchResults = await deps.search(query, topK);
  const relevantResults = searchResults.filter((r) => r.similarity >= threshold);

  if (relevantResults.length === 0) {
    const response: AnswerResponse = {
      answer: NO_ANSWER_RESPONSE,
      citations: [],
      hasConfidentAnswer: false,
      sessionId: session.id,
      searchedDatasets: options.datasetNames ?? [options.datasetName],
      candidateCount: options.candidateCount ?? 0,
    };
    yield { final: response };
    return;
  }

  // Build context chunks — use parent content when available for richer LLM context.
  // Deduplicate: if two child chunks share the same parent, only include the parent once.
  const seenParents = new Set<string>();
  const contextChunks: Chunk[] = [];

  for (const r of relevantResults) {
    const parentContent = r.metadata.parentContent;

    if (parentContent) {
      // Use a hash of the parent content to deduplicate
      const parentKey = `${r.metadata.sourceDocument}:${r.metadata.heading}:${parentContent.slice(0, 100)}`;
      if (seenParents.has(parentKey)) continue;
      seenParents.add(parentKey);

      contextChunks.push({
        id: r.chunkId,
        documentId: r.metadata.sourceDocument,
        content: parentContent, // Use the richer parent content for LLM
        metadata: r.metadata,
        embeddingId: r.chunkId,
      });
    } else {
      // No parent content — use the chunk directly (legacy or small chunks)
      contextChunks.push({
        id: r.chunkId,
        documentId: r.metadata.sourceDocument,
        content: r.chunk,
        metadata: r.metadata,
        embeddingId: r.chunkId,
      });
    }
  }

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

  // Compute retrieval confidence score (average similarity of used chunks)
  const avgSimilarity = relevantResults.length > 0
    ? relevantResults.reduce((sum, r) => sum + r.similarity, 0) / relevantResults.length
    : 0;

  // Build citations from the chunks that were used as context —
  // but only if the model actually used the context to answer.
  // Use the child chunk excerpt (more precise) for citations, not parent content.
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
    retrievalScore: Math.round(avgSimilarity * 100) / 100,
    ...(options.candidateCount != null && { candidateCount: options.candidateCount }),
    ...(options.hybridBoost != null && { hybridBoost: options.hybridBoost }),
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
