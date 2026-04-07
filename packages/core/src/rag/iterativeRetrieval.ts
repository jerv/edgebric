/**
 * Iterative Retrieval — performs a second retrieval round when confidence is low.
 *
 * After first retrieval + re-ranking, checks confidence based on relevance scores.
 * If confidence is low (top score <= 2 or fewer than 3 chunks score >= 3),
 * generates reformulated queries and runs another retrieval round.
 *
 * Max 2 retrieval rounds. Cost: 0 extra calls if confident, 2 extra if not
 * (1 for query reformulation + 1 for re-ranking the merged results).
 */
import type { GenerateFn, SearchFn, SearchResult, Message } from "./orchestrator.js";
import type { RerankedResult } from "./reranker.js";
import { rerankResults } from "./reranker.js";

// ─── Confidence Check ─────────────────────────────────────────────────────

/**
 * Determine if first-round results are confident enough to skip iteration.
 *
 * Low confidence if:
 * - Top chunk scores <= 2/5, OR
 * - Fewer than 3 chunks score >= 3/5
 */
export function isConfident(results: RerankedResult[]): boolean {
  if (results.length === 0) return false;

  const topScore = results[0]!.relevanceScore;
  if (topScore <= 2) return false;

  const aboveThreshold = results.filter((r) => r.relevanceScore >= 3).length;
  if (aboveThreshold < 3) return false;

  return true;
}

// ─── Query Reformulation ──────────────────────────────────────────────────

const REFORMULATE_PROMPT = `You are a search query reformulator. The original query didn't find good results. Generate 2-3 alternative search queries using synonyms, related terms, or broader/narrower scope.

Rules:
- Each query should approach the topic from a different angle.
- Use synonyms, related terminology, or rephrase the question.
- Return ONLY a JSON array of strings, nothing else.

Example:
Original: "employee onboarding checklist"
Output: ["new hire orientation steps", "first day procedures for employees", "onboarding requirements"]`;

/**
 * Generate reformulated queries for a second retrieval round.
 * Returns alternative search queries using synonyms and related terms.
 */
export async function reformulateQuery(
  query: string,
  generate: GenerateFn,
): Promise<string[]> {
  const messages: Message[] = [
    { role: "system", content: REFORMULATE_PROMPT },
    { role: "user", content: query },
  ];

  let fullResponse = "";
  for await (const delta of generate(messages)) {
    fullResponse += delta;
  }

  try {
    const jsonMatch = fullResponse.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((q) => q.trim())
      .slice(0, 3);
  } catch {
    return [];
  }
}

// ─── Iterative Retrieval ──────────────────────────────────────────────────

/**
 * Perform iterative retrieval: if first-round results have low confidence,
 * reformulate the query and do a second retrieval + re-rank pass.
 *
 * @param query - Original user query
 * @param firstRoundResults - Already re-ranked results from first round
 * @param search - Search function
 * @param generate - LLM generation function
 * @param topK - Number of candidates to retrieve per search
 * @param topN - Final number of results to keep
 * @returns Final re-ranked results (from round 1 if confident, merged round 1+2 if not)
 */
export async function iterativeRetrieve(
  query: string,
  firstRoundResults: RerankedResult[],
  search: SearchFn,
  generate: GenerateFn,
  topK: number,
  topN = 5,
): Promise<{ results: RerankedResult[]; iterationCount: number }> {
  // Check confidence — skip second round if results are good
  if (isConfident(firstRoundResults)) {
    return { results: firstRoundResults, iterationCount: 1 };
  }

  // Generate reformulated queries
  const reformulated = await reformulateQuery(query, generate);
  if (reformulated.length === 0) {
    // Reformulation failed — keep first-round results
    return { results: firstRoundResults, iterationCount: 1 };
  }

  // Search with reformulated queries
  const secondRoundSearches = await Promise.all(
    reformulated.map((rq) => search(rq, topK)),
  );

  // Collect all first-round chunkIds to track what's new
  const firstRoundIds = new Set(firstRoundResults.map((r) => r.chunkId));

  // Merge second-round results, deduplicating against first round
  const newResults: SearchResult[] = [];
  const seenIds = new Set(firstRoundIds);

  for (const results of secondRoundSearches) {
    for (const result of results) {
      if (!seenIds.has(result.chunkId)) {
        seenIds.add(result.chunkId);
        newResults.push(result);
      }
    }
  }

  if (newResults.length === 0) {
    // No new results from second round
    return { results: firstRoundResults, iterationCount: 2 };
  }

  // Combine first-round and new results, then re-rank everything
  const combinedSearchResults: SearchResult[] = [
    ...firstRoundResults.map(({ relevanceScore: _, ...rest }) => rest),
    ...newResults,
  ];

  const reranked = await rerankResults(query, combinedSearchResults, generate, topN);
  return { results: reranked, iterationCount: 2 };
}
