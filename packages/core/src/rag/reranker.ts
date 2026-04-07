/**
 * LLM-based Re-ranking — scores each chunk's relevance to the query.
 *
 * After hybrid search returns top-K chunks, this module uses the LLM to
 * score each chunk on a 1-5 relevance scale. Results are re-sorted by
 * score and trimmed to the top-N most relevant.
 *
 * Cost: 1 extra LLM call per query.
 */
import type { GenerateFn, SearchResult, Message } from "./orchestrator.js";

export interface RerankedResult extends SearchResult {
  /** LLM relevance score (1-5). */
  relevanceScore: number;
}

/**
 * Build the re-ranking prompt. Keeps it simple for small models:
 * present chunks as numbered items, ask for JSON scores.
 */
function buildRerankPrompt(query: string, chunks: SearchResult[]): string {
  const chunkList = chunks
    .map((c, i) => `[${i}] ${c.chunk.slice(0, 400)}`)
    .join("\n\n");

  return `Rate each text chunk's relevance to the query on a scale of 1-5.
1 = completely irrelevant
2 = barely relevant
3 = somewhat relevant
4 = relevant
5 = highly relevant

Query: "${query}"

Chunks:
${chunkList}

Return ONLY a JSON array: [{"index":0,"score":3},{"index":1,"score":5},...]`;
}

interface ScoreEntry {
  index: number;
  score: number;
}

/**
 * Parse the LLM's scoring response into a map of index -> score.
 * Handles malformed output gracefully by falling back to empty scores.
 */
function parseScores(response: string, chunkCount: number): Map<number, number> {
  const scores = new Map<number, number>();

  try {
    // Extract JSON array — handle markdown code blocks
    const jsonMatch = response.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return scores;

    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return scores;

    for (const entry of parsed) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        "index" in entry &&
        "score" in entry
      ) {
        const e = entry as ScoreEntry;
        const idx = typeof e.index === "number" ? e.index : parseInt(String(e.index), 10);
        const score = typeof e.score === "number" ? e.score : parseFloat(String(e.score));

        if (
          !isNaN(idx) &&
          !isNaN(score) &&
          idx >= 0 &&
          idx < chunkCount &&
          score >= 1 &&
          score <= 5
        ) {
          scores.set(idx, score);
        }
      }
    }
  } catch {
    // Parse failed — return empty scores (fall back to original order)
  }

  return scores;
}

/**
 * Re-rank search results using LLM relevance scoring.
 *
 * @param query - The user's query
 * @param results - Search results to re-rank
 * @param generate - LLM generation function
 * @param topN - Number of results to keep after re-ranking (default: 5)
 * @returns Re-ranked and trimmed results with relevance scores
 */
export async function rerankResults(
  query: string,
  results: SearchResult[],
  generate: GenerateFn,
  topN = 5,
): Promise<RerankedResult[]> {
  if (results.length === 0) return [];
  if (results.length === 1) {
    return [{ ...results[0]!, relevanceScore: 3 }];
  }

  const prompt = buildRerankPrompt(query, results);
  const messages: Message[] = [
    { role: "user", content: prompt },
  ];

  let fullResponse = "";
  for await (const delta of generate(messages)) {
    fullResponse += delta;
  }

  const scores = parseScores(fullResponse, results.length);

  // Build re-ranked results — chunks without LLM scores get a default of 3
  const reranked: RerankedResult[] = results.map((result, i) => ({
    ...result,
    relevanceScore: scores.get(i) ?? 3,
  }));

  // Sort by relevance score descending, then by original similarity as tiebreaker
  reranked.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    return b.similarity - a.similarity;
  });

  // Take top N
  return reranked.slice(0, topN);
}
