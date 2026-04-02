import { logger } from "../lib/logger.js";

/**
 * Cross-encoder reranking service.
 *
 * Reranks candidate chunks by computing fine-grained query-document relevance
 * scores. This catches cases where vector cosine similarity ranks chunks
 * incorrectly due to semantic overlap (very common in HR/policy documents).
 *
 * Current implementation: uses the chat LLM to score relevance.
 * This is slower than a dedicated cross-encoder model but requires no
 * additional dependencies. Can be upgraded to ONNX MiniLM later.
 *
 * Pipeline: retrieve 20 candidates → rerank → keep top-K for LLM context.
 */

interface RerankerCandidate {
  chunkId: string;
  text: string;
  originalScore: number;
}

interface RerankedResult {
  chunkId: string;
  text: string;
  originalScore: number;
  rerankerScore: number;
}

type GenerateFn = (prompt: string) => Promise<string>;

let _generateFn: GenerateFn | null = null;
let _enabled = true;

/**
 * Initialize the reranker with an LLM generate function.
 * Call this once at startup when the inference server is available.
 */
export function initReranker(generateFn: GenerateFn): void {
  _generateFn = generateFn;
  _enabled = true;
  logger.info("Reranker initialized (LLM-based scoring)");
}

export function isRerankerAvailable(): boolean {
  return _enabled && _generateFn !== null;
}

/**
 * Rerank candidates by LLM-scored relevance.
 *
 * Uses a single batched prompt that asks the LLM to score all candidates
 * at once (much faster than individual calls). Falls back to original
 * ordering if reranking fails.
 */
export async function rerank(
  query: string,
  candidates: RerankerCandidate[],
): Promise<RerankedResult[]> {
  if (!_enabled || !_generateFn || candidates.length <= 1) {
    return candidates.map((c) => ({ ...c, rerankerScore: c.originalScore }));
  }

  try {
    // Build a batch scoring prompt
    const passages = candidates
      .slice(0, 20) // Cap at 20 to keep prompt size reasonable
      .map((c, i) => `[${i + 1}] ${c.text.slice(0, 200)}`)
      .join("\n");

    const prompt = `Given the query: "${query.slice(0, 200)}"

Rate the relevance of each passage on a scale of 1-10 (10 = highly relevant).
Return ONLY a comma-separated list of scores in order, nothing else.

Passages:
${passages}

Scores:`;

    const response = await _generateFn(prompt);

    // Parse scores from response
    const scoreStrings = response.trim().replace(/[[\]]/g, "").split(/[,\s]+/);
    const scores = scoreStrings.map((s) => {
      const n = parseFloat(s);
      return isNaN(n) ? 5 : Math.max(1, Math.min(10, n));
    });

    // Map scores back to candidates
    const reranked: RerankedResult[] = candidates.map((c, i) => ({
      ...c,
      rerankerScore: (scores[i] ?? 5) / 10, // Normalize to 0-1
    }));

    // Sort by reranker score descending
    reranked.sort((a, b) => b.rerankerScore - a.rerankerScore);
    return reranked;
  } catch (err) {
    logger.warn({ err }, "Reranker failed, using original ordering");
    return candidates.map((c) => ({ ...c, rerankerScore: c.originalScore }));
  }
}
