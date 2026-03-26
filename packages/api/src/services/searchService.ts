import type { SearchResult } from "@edgebric/core/rag";
import type { MKBClient } from "@edgebric/edge";
import { lookupChunk } from "./chunkRegistry.js";
import { getSqlite } from "../db/index.js";
import { logger } from "../lib/logger.js";

// ─── BM25 Search via FTS5 ────────────────────────────────────────────────────

interface BM25Result {
  chunkId: string;
  /** FTS5 rank — negative float, lower = better match. */
  rank: number;
}

/**
 * Full-text keyword search using SQLite FTS5 (BM25 scoring).
 * Catches exact terms, policy names, acronyms that vector search misses.
 */
function bm25Search(query: string, limit: number): BM25Result[] {
  try {
    const sqlite = getSqlite();
    // FTS5 MATCH query — escape double quotes in user input
    const escaped = query.replace(/"/g, '""');
    const stmt = sqlite.prepare(
      `SELECT chunk_id, rank FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?`,
    );
    return stmt.all(`"${escaped}"`, limit) as BM25Result[];
  } catch (err) {
    // FTS5 table may not exist on first run or query syntax error — degrade gracefully
    logger.debug({ err }, "BM25 search failed, falling back to vector-only");
    return [];
  }
}

// ─── Reciprocal Rank Fusion ──────────────────────────────────────────────────

const RRF_K = 60; // Standard RRF constant

interface RankedResult extends SearchResult {
  /** Combined RRF score (higher = better). */
  rrfScore: number;
  /** True if this result was found by BM25 but not vector search. */
  bm25Only: boolean;
}

/**
 * Merge vector search and BM25 results using Reciprocal Rank Fusion.
 * RRF is rank-based (no need to normalize scores across different systems).
 */
function reciprocalRankFusion(
  vectorResults: SearchResult[],
  bm25Results: BM25Result[],
  allChunkTexts: Map<string, string>,
): RankedResult[] {
  // Build rank maps (1-indexed)
  const vectorRanks = new Map<string, number>();
  vectorResults.forEach((r, i) => vectorRanks.set(r.chunkId, i + 1));

  const bm25Ranks = new Map<string, number>();
  bm25Results.forEach((r, i) => bm25Ranks.set(r.chunkId, i + 1));

  // Collect all unique chunk IDs
  const allChunkIds = new Set([
    ...vectorRanks.keys(),
    ...bm25Ranks.keys(),
  ]);

  const merged: RankedResult[] = [];

  for (const chunkId of allChunkIds) {
    const vRank = vectorRanks.get(chunkId);
    const bRank = bm25Ranks.get(chunkId);

    const rrfScore =
      (vRank ? 1 / (RRF_K + vRank) : 0) +
      (bRank ? 1 / (RRF_K + bRank) : 0);

    // Find the full SearchResult if it came from vector search
    const vectorHit = vectorResults.find((r) => r.chunkId === chunkId);

    if (vectorHit) {
      merged.push({ ...vectorHit, rrfScore, bm25Only: false });
    } else {
      // BM25-only result — construct a SearchResult from chunk registry
      const stored = lookupChunk(chunkId);
      if (!stored) continue; // Orphaned chunk, skip

      merged.push({
        chunkId,
        chunk: allChunkTexts.get(chunkId) ?? "",
        similarity: 0, // No vector score available
        metadata: stored,
        rrfScore,
        bm25Only: true,
      });
    }
  }

  // Sort by RRF score descending
  merged.sort((a, b) => b.rrfScore - a.rrfScore);
  return merged;
}

// ─── Adaptive Top-K ──────────────────────────────────────────────────────────

/**
 * Determine how many results to keep based on score gap analysis.
 * Instead of fixed top-K, find the natural "elbow" in the score distribution.
 */
export function adaptiveTopK(
  scores: number[],
  minK = 3,
  maxK = 10,
  defaultK = 5,
  gapThreshold = 0.05,
): number {
  if (scores.length <= minK) return scores.length;

  const limit = Math.min(scores.length, maxK);

  // Find the largest gap in the top scores
  let maxGap = 0;
  let maxGapIndex = -1;

  for (let i = 0; i < limit - 1; i++) {
    const gap = scores[i]! - scores[i + 1]!;
    if (gap > maxGap) {
      maxGap = gap;
      maxGapIndex = i;
    }
  }

  // If there's a clear gap, cut after it
  if (maxGap > gapThreshold && maxGapIndex >= 0) {
    return Math.max(minK, Math.min(maxGapIndex + 1, maxK));
  }

  // No clear gap — use default
  return Math.min(defaultK, scores.length);
}

// ─── Main Search Pipeline ────────────────────────────────────────────────────

export interface HybridSearchResult extends SearchResult {
  /** Combined RRF score when hybrid search is used. */
  rrfScore?: number;
  /** True if BM25 keyword search found results that vector search missed. */
  hybridBoost?: boolean;
}

/**
 * Search across multiple mKB datasets with hybrid BM25+vector retrieval.
 *
 * Pipeline:
 * 1. Fan out vector search to all datasets in parallel
 * 2. Run BM25 keyword search via FTS5 in parallel
 * 3. Merge with Reciprocal Rank Fusion
 * 4. Enrich with chunk metadata from registry
 * 5. Apply adaptive top-K
 */
export async function hybridMultiDatasetSearch(
  mkb: MKBClient,
  datasetNames: string[],
  queryText: string,
  maxCandidates = 20,
): Promise<{ results: HybridSearchResult[]; candidateCount: number; hybridBoost: boolean }> {
  // 1. Vector search across all datasets (in parallel)
  const vectorPromise = Promise.all(
    datasetNames.map(async (ds) => {
      try {
        return await mkb.search(ds, queryText, maxCandidates);
      } catch {
        return [];
      }
    }),
  );

  // 2. BM25 search (synchronous, sub-millisecond)
  const bm25Results = bm25Search(queryText, maxCandidates);

  const vectorResultSets = await vectorPromise;

  // Flatten and enrich vector results with metadata
  const vectorResults = vectorResultSets.flat().flatMap((r) => {
    const stored = lookupChunk(r.chunkId);
    if (stored) return [{ ...r, metadata: stored }];
    return []; // Orphaned chunk — skip
  });

  // Sort vector results by similarity
  vectorResults.sort((a, b) => b.similarity - a.similarity);

  // Build a map of chunk texts for BM25-only results
  const chunkTexts = new Map<string, string>();
  for (const r of vectorResults) {
    chunkTexts.set(r.chunkId, r.chunk);
  }

  // 3. Merge with RRF
  let finalResults: HybridSearchResult[];
  let hybridBoost = false;

  if (bm25Results.length > 0) {
    const merged = reciprocalRankFusion(vectorResults, bm25Results, chunkTexts);
    hybridBoost = merged.some((r) => r.bm25Only);
    finalResults = merged.map((r) => ({
      chunkId: r.chunkId,
      chunk: r.chunk,
      similarity: r.similarity,
      metadata: r.metadata,
      rrfScore: r.rrfScore,
      hybridBoost: r.bm25Only,
    }));
  } else {
    // No BM25 results — use vector-only (graceful degradation)
    finalResults = vectorResults.slice(0, maxCandidates);
  }

  const candidateCount = finalResults.length;

  // 4. Apply adaptive top-K based on score distribution
  const scores = finalResults.map((r) => r.rrfScore ?? r.similarity);
  const k = adaptiveTopK(scores);
  finalResults = finalResults.slice(0, k);

  return { results: finalResults, candidateCount, hybridBoost };
}
