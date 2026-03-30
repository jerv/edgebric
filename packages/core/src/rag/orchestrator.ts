import type { AnswerResponse, AnswerType, Citation, Chunk, Session } from "@edgebric/types";
import { randomUUID } from "crypto";
import { filterQuery } from "./queryFilter.js";
import { buildSystemPrompt, buildGeneralPrompt, NO_ANSWER_RESPONSE } from "./systemPrompt.js";
import { detectAnswerType, validateMarkers } from "./answerAnalysis.js";

// ─── Dependency interfaces ─────────────────────────────────────────────────────
// The orchestrator has no knowledge of Ollama, HTTP, or any specific library.
// Real implementations are injected by the API layer.
// Test implementations are injected by tests.

export interface SearchResult {
  chunkId: string;
  chunk: string;
  similarity: number;
  metadata: Chunk["metadata"];
}

export interface SearchFn {
  /** Search function — embeds the query and returns matching chunks. */
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
  /** When true, restrict to context-only answers (admin toggle off). */
  strict?: boolean;
  /** Max context window size in tokens for the active model. Default 8192. */
  maxContextTokens?: number;
}

// ─── Token estimation ─────────────────────────────────────────────────────────

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessagesTokens(messages: Message[]): number {
  // Each message has ~4 token overhead (role, formatting)
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

// ─── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Core RAG pipeline with answer type routing.
 *
 * Flow:
 * 1. Filter query (person + sensitive term → redirect)
 * 2. Search (hybrid BM25+vector with adaptive top-K, done by caller)
 * 3. If no relevant chunks:
 *    - strict mode → return NO_ANSWER_RESPONSE
 *    - permissive mode → generate from general knowledge
 * 4. Use parent content for LLM context (parent-child retrieval)
 * 5. Build system prompt (strict vs permissive with inline citations)
 * 6. Generate streamed answer
 * 7. Analyze answer for inline citations → determine grounded vs blended
 * 8. Return answer + citations + answerType + confidence signals
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
  const strict = options.strict ?? false;

  // Layer 4: query filter
  const filter = filterQuery(query);
  if (!filter.allowed) {
    const response: AnswerResponse = {
      answer: filter.redirectMessage ?? NO_ANSWER_RESPONSE,
      citations: [],
      hasConfidentAnswer: false,
      answerType: "blocked",
      sessionId: session.id,
    };
    yield { final: response };
    return;
  }

  // Retrieve relevant chunks (search service handles hybrid + reranking)
  const searchResults = await deps.search(query, topK);
  const relevantResults = searchResults.filter((r) => r.similarity >= threshold);

  // ─── No relevant chunks ───────────────────────────────────────────────────

  if (relevantResults.length === 0) {
    if (strict) {
      // Strict mode: dead-end (current behavior)
      const response: AnswerResponse = {
        answer: NO_ANSWER_RESPONSE,
        citations: [],
        hasConfidentAnswer: false,
        answerType: "general",
        sessionId: session.id,
        searchedDatasets: options.datasetNames ?? [options.datasetName],
        candidateCount: options.candidateCount ?? 0,
      };
      yield { final: response };
      return;
    }

    // Permissive mode: answer from general knowledge
    const generalPrompt = buildGeneralPrompt();
    const genContextTokens = estimateTokens(generalPrompt);
    const genMaxContext = options.maxContextTokens ?? 8192;
    const genBudget = genMaxContext - genContextTokens - 1500;

    let genHistory: Message[] = session.messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));
    let genHistoryTokens = estimateMessagesTokens(genHistory);
    let genTruncated = false;
    while (genHistoryTokens > genBudget && genHistory.length > 1) {
      genHistory = genHistory.slice(1);
      genHistoryTokens = estimateMessagesTokens(genHistory);
      genTruncated = true;
    }

    const messages: Message[] = [
      { role: "system", content: generalPrompt },
      ...genHistory,
    ];

    let fullAnswer = "";
    for await (const delta of deps.generate(messages)) {
      fullAnswer += delta;
      yield { delta };
    }

    const response: AnswerResponse = {
      answer: fullAnswer,
      citations: [],
      hasConfidentAnswer: false,
      answerType: "general",
      sessionId: session.id,
      searchedDatasets: options.datasetNames ?? [options.datasetName],
      candidateCount: options.candidateCount ?? 0,
      contextUsage: {
        usedTokens: genContextTokens + genHistoryTokens,
        maxTokens: genMaxContext,
        contextTokens: genContextTokens,
        historyTokens: genHistoryTokens,
        truncated: genTruncated,
      },
    };
    yield { final: response };
    return;
  }

  // ─── Context chunks found ─────────────────────────────────────────────────

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

  // Map similarity scores to match contextChunks ordering
  const chunkScores = contextChunks.map((c) => {
    const result = relevantResults.find((r) => r.chunkId === c.id);
    return result?.similarity ?? 0;
  });

  // Build messages for generation
  const systemPrompt = buildSystemPrompt(contextChunks, { strict, scores: chunkScores });
  const systemMsg: Message = { role: "system", content: systemPrompt };
  const contextTokens = estimateTokens(systemPrompt);

  // Reserve tokens for the model's response (~1500 tokens)
  const maxContext = options.maxContextTokens ?? 8192;
  const reserveForResponse = 1500;
  const budgetForHistory = maxContext - contextTokens - reserveForResponse;

  // Fit conversation history within the token budget, truncating oldest first
  let historyMessages: Message[] = session.messages.map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  let historyTokens = estimateMessagesTokens(historyMessages);
  let truncated = false;

  while (historyTokens > budgetForHistory && historyMessages.length > 1) {
    historyMessages = historyMessages.slice(1);
    historyTokens = estimateMessagesTokens(historyMessages);
    truncated = true;
  }

  const messages: Message[] = [systemMsg, ...historyMessages];
  const usedTokens = contextTokens + historyTokens;

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

  // Determine answer type via inline citation analysis.
  // In strict mode, the model doesn't use [Source N] markers — always grounded.
  let answerType: AnswerType;
  if (modelDeclined) {
    answerType = "grounded"; // Had context, model couldn't answer — still grounded, just low confidence
  } else if (strict) {
    answerType = "grounded";
  } else {
    // Validate markers (strip hallucinated source references)
    fullAnswer = validateMarkers(fullAnswer, citations.length);
    answerType = detectAnswerType(fullAnswer, true);
  }

  const response: AnswerResponse = {
    answer: fullAnswer,
    citations,
    hasConfidentAnswer: !modelDeclined,
    answerType,
    sessionId: session.id,
    searchedDatasets: options.datasetNames ?? [options.datasetName],
    retrievalScore: Math.round(avgSimilarity * 100) / 100,
    ...(options.candidateCount != null && { candidateCount: options.candidateCount }),
    ...(options.hybridBoost != null && { hybridBoost: options.hybridBoost }),
    contextUsage: {
      usedTokens,
      maxTokens: maxContext,
      contextTokens,
      historyTokens,
      truncated,
    },
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
