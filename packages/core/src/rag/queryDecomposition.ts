/**
 * Query Decomposition — detects complex queries and breaks them into sub-queries.
 *
 * Complex queries (comparative, multi-part, multi-entity) are decomposed into
 * 2-4 sub-queries using the LLM. Each sub-query is searched independently,
 * and results are merged and deduplicated before context assembly.
 *
 * Simple queries pass through unchanged — no extra LLM call.
 */
import type { GenerateFn, SearchFn, SearchResult, Message } from "./orchestrator.js";

// ─── Complexity Detection (heuristic, no LLM call) ────────────────────────

/** Words/phrases that signal a comparative or multi-part query. */
const COMPARISON_PATTERNS = [
  /\bvs\.?\b/i,
  /\bversus\b/i,
  /\bcompare\b/i,
  /\bcomparison\b/i,
  /\bdifference(?:s)?\s+between\b/i,
  /\bhow\s+(?:does|do|is|are)\s+.+\s+(?:differ|compare)\b/i,
  /\bwhich\s+(?:is|are)\s+(?:better|worse|faster|cheaper|more|less)\b/i,
];

/** Conjunctions joining distinct topics (e.g., "X and also Y", "X as well as Y"). */
const MULTI_TOPIC_PATTERNS = [
  /\band\s+also\b/i,
  /\bas\s+well\s+as\b/i,
  /\bin\s+addition\s+to\b/i,
  /\bplus\b/i,
  /\balong\s+with\b/i,
];

/**
 * Detect whether a query is complex enough to warrant decomposition.
 *
 * Returns true for:
 * - Comparative queries (vs, compare, difference between)
 * - Multi-part questions (conjunctions joining distinct topics)
 * - Multiple question marks (multiple questions in one)
 */
export function isComplexQuery(query: string): boolean {
  // Multiple question marks = multiple questions
  const questionMarks = (query.match(/\?/g) ?? []).length;
  if (questionMarks >= 2) return true;

  // Comparison patterns
  for (const pattern of COMPARISON_PATTERNS) {
    if (pattern.test(query)) return true;
  }

  // Multi-topic conjunctions
  for (const pattern of MULTI_TOPIC_PATTERNS) {
    if (pattern.test(query)) return true;
  }

  return false;
}

// ─── LLM-based Decomposition ──────────────────────────────────────────────

const DECOMPOSE_PROMPT = `You are a search query decomposer. Break the user's complex question into 2-4 simple, independent sub-queries that can each be searched separately.

Rules:
- Each sub-query should be a standalone search query (not a sentence fragment).
- Each sub-query should target a single topic or entity.
- Return ONLY a JSON array of strings, nothing else.
- If the query is already simple, return a single-element array with the original query.

Example:
User: "How does our PTO policy compare to the parental leave policy?"
Output: ["PTO policy details", "parental leave policy details"]

Example:
User: "What is the onboarding process and what benefits do new hires get?"
Output: ["onboarding process for new hires", "benefits for new hires"]`;

/**
 * Decompose a complex query into sub-queries using the LLM.
 * Returns the original query wrapped in an array if decomposition fails.
 */
export async function decomposeQuery(
  query: string,
  generate: GenerateFn,
): Promise<string[]> {
  const messages: Message[] = [
    { role: "system", content: DECOMPOSE_PROMPT },
    { role: "user", content: query },
  ];

  let fullResponse = "";
  for await (const delta of generate(messages)) {
    fullResponse += delta;
  }

  // Parse JSON array from response
  try {
    // Extract JSON array — handle models that wrap in markdown code blocks
    const jsonMatch = fullResponse.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return [query];

    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return [query];

    const subQueries = parsed
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((q) => q.trim())
      .slice(0, 4); // Cap at 4 sub-queries

    return subQueries.length > 0 ? subQueries : [query];
  } catch {
    // Parse failed — fall back to original query
    return [query];
  }
}

// ─── Search with Decomposition ─────────────────────────────────────────────

/**
 * Run search across multiple sub-queries, merging and deduplicating results.
 * Results are deduplicated by chunkId, keeping the highest similarity score.
 */
export async function searchWithDecomposition(
  query: string,
  search: SearchFn,
  generate: GenerateFn,
  topK: number,
): Promise<{ results: SearchResult[]; subQueries: string[] }> {
  const subQueries = await decomposeQuery(query, generate);

  if (subQueries.length <= 1) {
    // Single query — no decomposition needed, just search normally
    const results = await search(subQueries[0] ?? query, topK);
    return { results, subQueries };
  }

  // Search each sub-query independently
  const allResults = await Promise.all(
    subQueries.map((sq) => search(sq, topK)),
  );

  // Merge and deduplicate by chunkId, keeping highest similarity
  const bestByChunk = new Map<string, SearchResult>();
  for (const results of allResults) {
    for (const result of results) {
      const existing = bestByChunk.get(result.chunkId);
      if (!existing || result.similarity > existing.similarity) {
        bestByChunk.set(result.chunkId, result);
      }
    }
  }

  // Sort by similarity descending
  const merged = [...bestByChunk.values()].sort(
    (a, b) => b.similarity - a.similarity,
  );

  return { results: merged, subQueries };
}
