import type { EdgeConfig, EmbeddedChunk } from "@edgebric/types";
import type { SearchResult } from "@edgebric/core/rag";

/**
 * Client for mimik mKB (Knowledge Base / vector store service).
 *
 * mKB stores pre-computed embeddings and answers semantic similarity queries.
 * It does NOT compute embeddings itself — call mILM /embeddings first.
 *
 * Endpoints:
 *   POST   /datasets                          — create a dataset
 *   GET    /datasets                          — list datasets
 *   DELETE /datasets/{name}                   — delete a dataset
 *   POST   /datasets/{name}/chunks            — upload embedded chunks
 *   POST   /search                            — semantic similarity search
 *   GET    /chunks/{chunkId}                  — retrieve a specific chunk
 */
export interface MKBClient {
  createDataset(name: string): Promise<void>;
  listDatasets(): Promise<string[]>;
  deleteDataset(name: string): Promise<void>;
  uploadChunks(datasetName: string, chunks: EmbeddedChunk[]): Promise<void>;
  search(datasetName: string, embedding: number[], topN: number): Promise<SearchResult[]>;
}

export function createMKBClient(config: EdgeConfig): MKBClient {
  const base = `${config.baseUrl}/api/mkb/v1`;
  const headers = {
    Authorization: `bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  async function createDataset(name: string): Promise<void> {
    const response = await fetch(`${base}/datasets`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        datasetName: name,
        model: config.embeddingModel,
      }),
    });
    if (!response.ok) {
      throw new MKBError("createDataset", response.status, await response.text());
    }
  }

  async function listDatasets(): Promise<string[]> {
    const response = await fetch(`${base}/datasets`, { headers });
    if (!response.ok) {
      throw new MKBError("listDatasets", response.status, await response.text());
    }
    const data = (await response.json()) as { datasets: Array<{ datasetName: string }> };
    return data.datasets.map((d) => d.datasetName);
  }

  async function deleteDataset(name: string): Promise<void> {
    const response = await fetch(`${base}/datasets/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers,
    });
    if (!response.ok) {
      throw new MKBError("deleteDataset", response.status, await response.text());
    }
  }

  async function uploadChunks(datasetName: string, chunks: EmbeddedChunk[]): Promise<void> {
    // mKB expects a multipart file upload with a JSON file of chunks.
    // Format confirmed from SwaggerHub spec:
    //   POST /datasets/{name}/chunks
    //   Content-Type: multipart/form-data
    //   [file: JSON array of { chunkId, chunk, embedding }]

    const chunkPayload = chunks.map((c) => ({
      chunkId: c.id,
      chunk: c.content,
      embedding: c.embedding,
      // Store metadata as JSON string in the chunk text — retrieved with the chunk
      metadata: c.metadata,
    }));

    const blob = new Blob([JSON.stringify(chunkPayload)], { type: "application/json" });
    const formData = new FormData();
    formData.append("file", blob, "chunks.json");

    const response = await fetch(`${base}/datasets/${encodeURIComponent(datasetName)}/chunks`, {
      method: "POST",
      headers: { Authorization: `bearer ${config.apiKey}` }, // No Content-Type — let FormData set boundary
      body: formData,
    });

    if (!response.ok) {
      throw new MKBError("uploadChunks", response.status, await response.text());
    }
  }

  async function search(
    datasetName: string,
    embedding: number[],
    topN: number,
  ): Promise<SearchResult[]> {
    const response = await fetch(`${base}/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        datasetName,
        embedding,
        topN,
      }),
    });

    if (!response.ok) {
      throw new MKBError("search", response.status, await response.text());
    }

    const data = (await response.json()) as Array<{
      chunkId: string;
      chunk: string;
      similarity: number;
      metadata?: Record<string, unknown>;
    }>;

    return data.map((r) => ({
      chunkId: r.chunkId,
      chunk: r.chunk,
      similarity: r.similarity,
      metadata: (r.metadata as SearchResult["metadata"]) ?? {
        sourceDocument: "",
        sectionPath: [],
        pageNumber: 0,
        heading: "",
        chunkIndex: 0,
      },
    }));
  }

  return { createDataset, listDatasets, deleteDataset, uploadChunks, search };
}

export class MKBError extends Error {
  constructor(
    public readonly operation: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`mKB ${operation} failed (HTTP ${status}): ${body}`);
    this.name = "MKBError";
  }
}
