/**
 * Query Router — integrates mesh search into the query pipeline.
 *
 * When mesh is enabled, queries fan out to remote nodes in parallel with
 * the local search. Results are merged by similarity score and deduplicated.
 * When mesh is disabled, this is a passthrough to the local search.
 */
import { isMeshEnabled, getMeshConfig } from "./nodeRegistry.js";
import { searchAllNodes } from "./meshClient.js";
import { hybridMultiDatasetSearch, type HybridSearchResult } from "./searchService.js";
import { logger } from "../lib/logger.js";

export interface RoutedSearchResult extends HybridSearchResult {
  /** Node that produced this result. Null = local. */
  sourceNodeId?: string;
  /** Human-readable node name for citation attribution. */
  sourceNodeName?: string;
}

export interface RoutedSearchResponse {
  results: RoutedSearchResult[];
  candidateCount: number;
  hybridBoost: boolean;
  /** Number of remote nodes that were searched. */
  meshNodesSearched: number;
  /** Number of remote nodes that were unreachable. */
  meshNodesUnavailable: number;
}

/**
 * Search local data sources and, if mesh is enabled, remote nodes too.
 *
 * @param localDatasetNames - dataset names to search locally
 * @param queryText - the user's query
 * @param maxCandidates - max results per source (local + each remote node)
 * @param allowedGroupIds - groups the user can access. Empty = no remote access. Undefined = admin (all groups).
 */
export async function routedSearch(
  localDatasetNames: string[],
  queryText: string,
  maxCandidates = 20,
  allowedGroupIds?: string[],
): Promise<RoutedSearchResponse> {
  const meshEnabled = isMeshEnabled();
  const cfg = meshEnabled ? getMeshConfig() : undefined;

  // Always run local search
  const localPromise = localDatasetNames.length > 0
    ? hybridMultiDatasetSearch(localDatasetNames, queryText, maxCandidates)
    : Promise.resolve({ results: [] as HybridSearchResult[], candidateCount: 0, hybridBoost: false });

  // If mesh is enabled, fan out to remote nodes in the user's allowed groups
  // allowedGroupIds === undefined means admin — search all groups
  // allowedGroupIds === [] means no mesh access
  const meshPromise = meshEnabled && allowedGroupIds?.length !== 0
    ? searchAllNodes(queryText, {
        ...(allowedGroupIds != null && { groupIds: allowedGroupIds }),
        topN: maxCandidates,
      })
    : Promise.resolve({ results: [], nodesSearched: 0, nodesUnavailable: 0 });

  const [localResult, meshResult] = await Promise.all([localPromise, meshPromise]);

  // Convert local results to routed format
  const localRouted: RoutedSearchResult[] = localResult.results.map((r) => ({
    ...r,
    ...(cfg != null && { sourceNodeId: cfg.nodeId, sourceNodeName: cfg.nodeName }),
  }));

  // Convert remote mesh results to HybridSearchResult format
  const remoteRouted: RoutedSearchResult[] = [];
  for (const nodeResponse of meshResult.results) {
    for (const chunk of nodeResponse.chunks) {
      // Parse chunk index from chunkId (format: "{datasetName}-{index}")
      const idxMatch = chunk.chunkId.match(/-(\d+)$/);
      const chunkIndex = idxMatch ? parseInt(idxMatch[1], 10) : 0;

      remoteRouted.push({
        chunkId: chunk.chunkId,
        chunk: chunk.content,
        similarity: chunk.similarity,
        metadata: {
          sourceDocument: "",
          ...(chunk.documentName != null && { documentName: chunk.documentName }),
          sectionPath: chunk.sectionPath ?? [],
          pageNumber: chunk.pageNumber ?? 0,
          heading: chunk.heading ?? "",
          chunkIndex,
        },
        sourceNodeId: nodeResponse.nodeId,
        sourceNodeName: nodeResponse.nodeName,
      });
    }
  }

  // Merge local and remote results, sort by similarity
  const allResults = [...localRouted, ...remoteRouted];
  allResults.sort((a, b) => b.similarity - a.similarity);

  // Deduplicate by chunkId (same document on multiple nodes — keep highest similarity)
  const seen = new Set<string>();
  const deduped: RoutedSearchResult[] = [];
  for (const r of allResults) {
    if (!seen.has(r.chunkId)) {
      seen.add(r.chunkId);
      deduped.push(r);
    }
  }

  // Cap total results
  const capped = deduped.slice(0, maxCandidates);

  if (meshResult.nodesSearched > 0 || meshResult.nodesUnavailable > 0) {
    logger.info(
      {
        localResults: localRouted.length,
        remoteResults: remoteRouted.length,
        totalAfterDedup: capped.length,
        nodesSearched: meshResult.nodesSearched,
        nodesUnavailable: meshResult.nodesUnavailable,
      },
      "Routed search completed (mesh enabled)",
    );
  }

  return {
    results: capped,
    candidateCount: localResult.candidateCount + remoteRouted.length,
    hybridBoost: localResult.hybridBoost,
    meshNodesSearched: meshResult.nodesSearched,
    meshNodesUnavailable: meshResult.nodesUnavailable,
  };
}
