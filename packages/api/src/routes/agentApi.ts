/**
 * Agent API v1 Routes
 *
 * Universal API for AI agents and integrations.
 * Authenticated via API keys (Bearer token), no session/CSRF.
 * Mount at /api/v1/ with apiKeyAuth middleware.
 */
import { Router } from "express";
import type { Router as IRouter, Request, Response } from "express";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import multer from "multer";
import { apiKeyAuth, requirePermission, logAgentAction } from "../middleware/apiKeyAuth.js";
import { validateBody } from "../middleware/validate.js";
import {
  createDataSource,
  getDataSource,
  dataSourceBelongsToOrg,
  listDataSources,
  archiveDataSource,
  refreshDocumentCount,
} from "../services/dataSourceStore.js";
import {
  getDocument,
  getDocumentsByDataSource,
  setDocument,
  deleteDocument,
} from "../services/documentStore.js";
import { routedSearch } from "../services/queryRouter.js";
import { rerank, isRerankerAvailable } from "../services/reranker.js";
import { answerStream } from "@edgebric/core/rag";
import { acquireSlot, QueueFullError } from "../services/inferenceQueue.js";
import { isRunning as isInferenceRunning, InferenceError } from "../services/inferenceClient.js";
import { createChatClient } from "../services/chatClient.js";
import { clearChunksForDataset, getChunksForDataset } from "../services/chunkRegistry.js";
import { encryptFile } from "../lib/crypto.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { fileTypeFromBuffer } from "file-type";
import { createWebhook, getWebhook, listWebhooksByOrg, deleteWebhook, type WebhookEvent } from "../services/webhookStore.js";
import { getSourceSummary, upsertSourceSummary } from "../services/sourceSummaryStore.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import type { Document, DataSource, Session } from "@edgebric/types";

export const agentApiRouter: IRouter = Router();

// All agent API routes require API key auth
agentApiRouter.use(apiKeyAuth);

const chatClient = createChatClient();

// ─── Helpers ────────────────────────────────────────────────────────────────

const MAGIC_EXT_MAP: Record<string, Document["type"]> = { pdf: "pdf", docx: "docx" };
const TEXT_EXTENSIONS = new Set(["txt", "md"]);

function sendInferenceUnavailable(res: Response): void {
  res.status(503).json({ error: "LLM inference server not available", code: "INFERENCE_UNAVAILABLE", status: 503 });
}

function handleInferenceFailure(res: Response, err: unknown, context: string): boolean {
  if (!(err instanceof InferenceError)) return false;
  logger.warn({ err }, `${context}: inference backend unavailable`);
  if (!res.headersSent) sendInferenceUnavailable(res);
  return true;
}

/**
 * Get data sources accessible to this API key.
 * If sourceScope is set, only returns sources in that scope.
 */
function getAccessibleSources(req: Request): DataSource[] {
  const orgId = req.apiKey!.orgId;
  const allSources = listDataSources({ type: "organization", orgId });
  const scopeIds = req.apiKeySourceIds;

  if (!scopeIds) return allSources; // "all" scope
  const scopeSet = new Set(scopeIds);
  return allSources.filter((ds) => scopeSet.has(ds.id));
}

/**
 * Resolve dataset names from requested source IDs, intersected with key's scope.
 */
function resolveDatasets(
  requestedSourceIds: string[] | undefined,
  accessibleSources: DataSource[],
): string[] {
  if (!requestedSourceIds || requestedSourceIds.length === 0) {
    return accessibleSources.map((ds) => ds.datasetName);
  }
  const requestedSet = new Set(requestedSourceIds);
  const filtered = accessibleSources.filter((ds) => requestedSet.has(ds.id));
  return filtered.map((ds) => ds.datasetName);
}

/**
 * Check if a source is accessible to the API key.
 * Always verifies org membership to prevent cross-org access.
 */
function isSourceAccessible(sourceId: string, req: Request): boolean {
  const orgId = req.apiKey!.orgId;
  if (!dataSourceBelongsToOrg(sourceId, orgId)) return false;
  const scopeIds = req.apiKeySourceIds;
  if (!scopeIds) return true; // "all" scope, org verified
  return scopeIds.includes(sourceId);
}

// ─── Read Endpoints ─────────────────────────────────────────────────────────

const readPermission = requirePermission("read", "read-write", "admin");

/**
 * GET /api/v1/discover
 */
agentApiRouter.get("/discover", readPermission, (req: Request, res: Response) => {
  const sources = getAccessibleSources(req);
  res.json({
    version: "1.0",
    sources: sources.map((s) => ({
      id: s.id, name: s.name, type: s.type, documentCount: s.documentCount,
    })),
    capabilities: ["search", "query", "ask", "upload", "manage", "webhooks", "summaries"],
    endpoints: {
      discover: "GET /api/v1/discover",
      sources: "GET /api/v1/sources",
      documents: "GET /api/v1/sources/:id/documents",
      search: "POST /api/v1/search",
      query: "POST /api/v1/query",
      ask: "POST /api/v1/ask",
      sourceSummary: "GET /api/v1/sources/:id/summary",
      upload: "POST /api/v1/sources/:id/upload",
      createSource: "POST /api/v1/sources",
      deleteDocument: "DELETE /api/v1/documents/:id",
      deleteSource: "DELETE /api/v1/sources/:id",
      jobStatus: "GET /api/v1/jobs/:id",
      webhooks: "POST /api/v1/webhooks",
      deleteWebhook: "DELETE /api/v1/webhooks/:id",
    },
  });
});

/**
 * GET /api/v1/sources
 */
agentApiRouter.get("/sources", readPermission, (req: Request, res: Response) => {
  const sources = getAccessibleSources(req);
  res.json({
    sources: sources.map((s) => ({
      id: s.id, name: s.name, type: s.type,
      documentCount: s.documentCount,
      lastUpdated: s.updatedAt.toISOString(),
    })),
  });
});

/**
 * GET /api/v1/sources/:id/documents
 */
agentApiRouter.get("/sources/:id/documents", readPermission, (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  if (!isSourceAccessible(id, req)) {
    res.status(404).json({ error: "Source not found", code: "NOT_FOUND", status: 404 });
    return;
  }
  const ds = getDataSource(id);
  if (!ds) {
    res.status(404).json({ error: "Source not found", code: "NOT_FOUND", status: 404 });
    return;
  }
  const docs = getDocumentsByDataSource(id);
  res.json({
    documents: docs.map((d) => ({
      id: d.id, name: d.name, type: d.type,
      size: d.pageCount ?? null,
      uploadedAt: d.uploadedAt.toISOString(),
      status: d.status,
    })),
  });
});

/**
 * POST /api/v1/search
 * Ranked chunks with citations, NO LLM synthesis.
 */
const searchSchema = z.object({
  query: z.string().min(1).max(4000),
  sourceIds: z.array(z.string()).optional(),
  topK: z.number().int().min(1).max(50).optional(),
});

agentApiRouter.post("/search", readPermission, validateBody(searchSchema), async (req: Request, res: Response) => {
  const { query, sourceIds, topK } = req.body;
  const accessibleSources = getAccessibleSources(req);
  const datasetNames = resolveDatasets(sourceIds, accessibleSources);

  if (datasetNames.length === 0) {
    res.json({ results: [], message: "No relevant documents found" });
    logAgentAction(req, "api.search", "search", undefined, { resultCount: 0 });
    return;
  }

  try {
    const maxCandidates = topK ?? 10;
    // Pass empty groupIds to prevent unscoped mesh search — API keys have no mesh group assignment
    const accessibleDSIds = accessibleSources.map((ds) => ds.id);
    const { results } = await routedSearch(datasetNames, query, maxCandidates, [], accessibleDSIds);

    let finalResults = results;
    if (isRerankerAvailable() && results.length > 1) {
      const reranked = await rerank(
        query,
        results.map((r) => ({ chunkId: r.chunkId, text: r.chunk, originalScore: r.similarity })),
      );
      const rerankedMap = new Map(reranked.map((r) => [r.chunkId, r.rerankerScore]));
      finalResults = [...results].sort((a, b) => (rerankedMap.get(b.chunkId) ?? 0) - (rerankedMap.get(a.chunkId) ?? 0));
    }

    const dsMap = new Map(accessibleSources.map((ds) => [ds.datasetName, ds]));
    const mapped = finalResults.slice(0, maxCandidates).map((r) => {
      const dsName = r.chunkId.replace(/-\d+$/, "");
      const ds = dsMap.get(dsName);
      return {
        content: r.chunk,
        relevanceScore: Math.min(1, Math.max(0, r.similarity)),
        citation: {
          documentName: r.metadata.documentName ?? r.metadata.sourceDocument,
          page: r.metadata.pageNumber,
          section: r.metadata.sectionPath?.join(" > ") ?? r.metadata.heading ?? "",
          sourceId: ds?.id ?? null,
          sourceName: ds?.name ?? null,
        },
      };
    });

    res.json(mapped.length === 0
      ? { results: [], message: "No relevant documents found" }
      : { results: mapped });
    logAgentAction(req, "api.search", "search", undefined, { resultCount: mapped.length });
  } catch (err) {
    if (handleInferenceFailure(res, err, "Agent API search")) return;
    logger.error({ err }, "Agent API search failed");
    res.status(500).json({ error: "Search failed", code: "SEARCH_ERROR", status: 500 });
  }
});

/**
 * POST /api/v1/query
 * Full RAG with local LLM synthesis.
 */
const querySchema = z.object({
  query: z.string().min(1).max(4000),
  sourceIds: z.array(z.string()).optional(),
  stream: z.boolean().optional(),
});

agentApiRouter.post("/query", readPermission, validateBody(querySchema), async (req: Request, res: Response) => {
  const { query, sourceIds, stream: useStream } = req.body;
  const accessibleSources = getAccessibleSources(req);
  const datasetNames = resolveDatasets(sourceIds, accessibleSources);

  if (datasetNames.length === 0) {
    if (useStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ type: "done", answer: "No relevant documents found.", citations: [] })}\n\n`);
      res.end();
    } else {
      res.json({ answer: "No relevant documents found.", citations: [] });
    }
    logAgentAction(req, "api.query", "query");
    return;
  }

  let releaseSlot: (() => void) | undefined;

  try {
    const running = await isInferenceRunning();
    if (!running) {
      sendInferenceUnavailable(res);
      return;
    }

    const accessibleDSIdsQ = accessibleSources.map((ds) => ds.id);
    const { results: searchResults, candidateCount, hybridBoost } = await routedSearch(datasetNames, query, 20, [], accessibleDSIdsQ);

    let finalResults = searchResults;
    if (isRerankerAvailable() && searchResults.length > 1) {
      const reranked = await rerank(
        query,
        searchResults.map((r) => ({ chunkId: r.chunkId, text: r.chunk, originalScore: r.similarity })),
      );
      const rerankedMap = new Map(reranked.map((r) => [r.chunkId, r.rerankerScore]));
      finalResults = [...searchResults].sort((a, b) => (rerankedMap.get(b.chunkId) ?? 0) - (rerankedMap.get(a.chunkId) ?? 0));
    }

    try {
      releaseSlot = await acquireSlot(`api-${req.apiKey!.id}`, "low");
    } catch (err) {
      if (err instanceof QueueFullError) {
        res.status(503).json({ error: "Inference queue full, try again later", code: "QUEUE_FULL", status: 503 });
        return;
      }
      throw err;
    }

    // Build session for RAG orchestrator
    const session: Session = {
      id: randomUUID(),
      createdAt: new Date(),
      messages: [{ role: "user", content: query }],
    };

    const dsMap = new Map(accessibleSources.map((ds) => [ds.datasetName, ds]));
    const citations = finalResults.slice(0, 8).map((r) => {
      const dsName = r.chunkId.replace(/-\d+$/, "");
      const ds = dsMap.get(dsName);
      return {
        documentName: r.metadata.documentName ?? r.metadata.sourceDocument,
        page: r.metadata.pageNumber,
        section: r.metadata.sectionPath?.join(" > ") ?? r.metadata.heading ?? "",
        sourceId: ds?.id ?? null,
        sourceName: ds?.name ?? null,
      };
    });

    // Use the RAG orchestrator
    const agentOrgConfig = getIntegrationConfig();
    const ragStream = answerStream(
      query,
      session,
      {
        datasetName: datasetNames[0] ?? "default",
        datasetNames,
        topK: 10,
        similarityThreshold: 0.3,
        candidateCount,
        hybridBoost,
        decompose: agentOrgConfig.ragDecompose ?? false,
        rerank: agentOrgConfig.ragRerank ?? false,
        iterativeRetrieval: agentOrgConfig.ragIterativeRetrieval ?? false,
      },
      {
        search: async () => finalResults,
        generate: (messages) => chatClient.chatStream(messages),
      },
    );

    if (useStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      for await (const chunk of ragStream) {
        if (chunk.delta) {
          res.write(`data: ${JSON.stringify({ type: "delta", text: chunk.delta })}\n\n`);
        }
        if (chunk.final) {
          res.write(`data: ${JSON.stringify({ type: "done", answer: chunk.final.answer, citations })}\n\n`);
        }
      }
      res.end();
    } else {
      let answer = "";
      for await (const chunk of ragStream) {
        if (chunk.delta) answer += chunk.delta;
        if (chunk.final) answer = chunk.final.answer;
      }
      res.json({ answer, citations });
    }

    logAgentAction(req, "api.query", "query", undefined, { resultCount: citations.length });
  } catch (err) {
    if (handleInferenceFailure(res, err, "Agent API query")) return;
    logger.error({ err }, "Agent API query failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "Query failed", code: "QUERY_ERROR", status: 500 });
    }
  } finally {
    releaseSlot?.();
  }
});

// ─── POST /api/v1/ask ──────────────────────────────────────────────────────
// Simplified "just answer my question" endpoint — auto-selects sources.

const askSchema = z.object({
  question: z.string().min(1).max(4000),
});

agentApiRouter.post("/ask", readPermission, validateBody(askSchema), async (req: Request, res: Response) => {
  const { question } = req.body;
  const accessibleSources = getAccessibleSources(req);
  const datasetNames = accessibleSources.map((ds) => ds.datasetName);

  if (datasetNames.length === 0) {
    res.json({ answer: "No sources available to search.", citations: [], sourcesSearched: [] });
    logAgentAction(req, "api.ask", "query");
    return;
  }

  let releaseSlot: (() => void) | undefined;

  try {
    const running = await isInferenceRunning();
    if (!running) {
      sendInferenceUnavailable(res);
      return;
    }

    const accessibleDSIdsA = accessibleSources.map((ds) => ds.id);
    const { results: searchResults, candidateCount, hybridBoost } = await routedSearch(datasetNames, question, 20, [], accessibleDSIdsA);

    let finalResults = searchResults;
    if (isRerankerAvailable() && searchResults.length > 1) {
      const reranked = await rerank(
        question,
        searchResults.map((r) => ({ chunkId: r.chunkId, text: r.chunk, originalScore: r.similarity })),
      );
      const rerankedMap = new Map(reranked.map((r) => [r.chunkId, r.rerankerScore]));
      finalResults = [...searchResults].sort((a, b) => (rerankedMap.get(b.chunkId) ?? 0) - (rerankedMap.get(a.chunkId) ?? 0));
    }

    try {
      releaseSlot = await acquireSlot(`api-ask-${req.apiKey!.id}`, "low");
    } catch (err) {
      if (err instanceof QueueFullError) {
        res.status(503).json({ error: "Inference queue full, try again later", code: "QUEUE_FULL", status: 503 });
        return;
      }
      throw err;
    }

    const session: Session = {
      id: randomUUID(),
      createdAt: new Date(),
      messages: [{ role: "user", content: question }],
    };

    const dsMap = new Map(accessibleSources.map((ds) => [ds.datasetName, ds]));
    const citations = finalResults.slice(0, 8).map((r) => {
      const dsName = r.chunkId.replace(/-\d+$/, "");
      const ds = dsMap.get(dsName);
      return {
        documentName: r.metadata.documentName ?? r.metadata.sourceDocument,
        page: r.metadata.pageNumber,
        section: r.metadata.sectionPath?.join(" > ") ?? r.metadata.heading ?? "",
        sourceId: ds?.id ?? null,
        sourceName: ds?.name ?? null,
      };
    });

    // Track which sources were actually searched
    const searchedSourceIds = new Set<string>();
    for (const r of finalResults) {
      const dsName = r.chunkId.replace(/-\d+$/, "");
      const ds = dsMap.get(dsName);
      if (ds) searchedSourceIds.add(ds.id);
    }
    const sourcesSearched = accessibleSources
      .filter((ds) => searchedSourceIds.has(ds.id))
      .map((ds) => ({ id: ds.id, name: ds.name }));

    const citeCheckConfig = getIntegrationConfig();
    const ragStream = answerStream(
      question,
      session,
      {
        datasetName: datasetNames[0] ?? "default",
        datasetNames,
        topK: 10,
        similarityThreshold: 0.3,
        candidateCount,
        hybridBoost,
        decompose: citeCheckConfig.ragDecompose ?? false,
        rerank: citeCheckConfig.ragRerank ?? false,
        iterativeRetrieval: citeCheckConfig.ragIterativeRetrieval ?? false,
      },
      {
        search: async () => finalResults,
        generate: (messages) => chatClient.chatStream(messages),
      },
    );

    let answer = "";
    for await (const chunk of ragStream) {
      if (chunk.delta) answer += chunk.delta;
      if (chunk.final) answer = chunk.final.answer;
    }

    res.json({ answer, citations, sourcesSearched });
    logAgentAction(req, "api.ask", "query", undefined, { resultCount: citations.length });
  } catch (err) {
    if (handleInferenceFailure(res, err, "Agent API /ask")) return;
    logger.error({ err }, "Agent API /ask failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "Query failed", code: "QUERY_ERROR", status: 500 });
    }
  } finally {
    releaseSlot?.();
  }
});

// ─── GET /api/v1/sources/:id/summary ───────────────────────────────────────
// AI-generated summary of a source's contents.

agentApiRouter.get("/sources/:id/summary", readPermission, async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  if (!isSourceAccessible(id, req)) {
    res.status(404).json({ error: "Source not found", code: "NOT_FOUND", status: 404 });
    return;
  }
  const ds = getDataSource(id);
  if (!ds) {
    res.status(404).json({ error: "Source not found", code: "NOT_FOUND", status: 404 });
    return;
  }

  // Check cache — regenerate if source was updated since last summary
  const cached = getSourceSummary(id);
  if (cached && cached.sourceUpdatedAt === ds.updatedAt.toISOString()) {
    res.json({ summary: cached.summary, documentCount: cached.documentCount, topTopics: cached.topTopics });
    return;
  }

  // Gather top chunks from this source's dataset
  const allChunks = getChunksForDataset(ds.datasetName);
  if (allChunks.length === 0) {
    res.json({ summary: "This source has no documents yet.", documentCount: ds.documentCount, topTopics: [] });
    return;
  }

  // Check if inference is available
  const running = await isInferenceRunning();
  if (!running) {
    sendInferenceUnavailable(res);
    return;
  }

  let releaseSlot: (() => void) | undefined;
  try {
    try {
      releaseSlot = await acquireSlot(`api-summary-${id}`, "low");
    } catch (err) {
      if (err instanceof QueueFullError) {
        res.status(503).json({ error: "Inference queue full, try again later", code: "QUEUE_FULL", status: 503 });
        return;
      }
      throw err;
    }

    // Take up to 15 representative chunks (spread evenly across the dataset)
    const step = Math.max(1, Math.floor(allChunks.length / 15));
    const sampleChunks = allChunks.filter((_, i) => i % step === 0).slice(0, 15);
    const context = sampleChunks.map((c) => c.content).join("\n\n---\n\n");

    const systemPrompt = `You are a helpful assistant. Given sample excerpts from a document collection, provide:
1. A concise 2-3 sentence summary of what this collection contains
2. A list of 3-5 top topics covered

Respond in JSON format: {"summary": "...", "topTopics": ["topic1", "topic2", ...]}`;

    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: `Here are sample excerpts from the "${ds.name}" collection:\n\n${context}` },
    ];

    let rawResponse = "";
    for await (const token of chatClient.chatStream(messages)) {
      rawResponse += token;
    }

    // Parse the JSON from the LLM response
    let summary = rawResponse.trim();
    let topTopics: string[] = [];

    try {
      // Try to extract JSON from the response
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { summary?: string; topTopics?: string[] };
        if (parsed.summary) summary = parsed.summary;
        if (Array.isArray(parsed.topTopics)) topTopics = parsed.topTopics;
      }
    } catch {
      // If JSON parsing fails, use the raw response as summary
    }

    // Cache the result
    const summaryRecord = {
      dataSourceId: id,
      summary,
      topTopics,
      documentCount: ds.documentCount,
      generatedAt: new Date().toISOString(),
      sourceUpdatedAt: ds.updatedAt.toISOString(),
    };
    upsertSourceSummary(summaryRecord);

    res.json({ summary, documentCount: ds.documentCount, topTopics });
    logAgentAction(req, "api.summary", "data_source", id);
  } catch (err) {
    if (handleInferenceFailure(res, err, "Agent API source summary")) return;
    logger.error({ err }, "Agent API source summary failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "Summary generation failed", code: "SUMMARY_ERROR", status: 500 });
    }
  } finally {
    releaseSlot?.();
  }
});

// ─── Write Endpoints ────────────────────────────────────────────────────────

const writePermission = requirePermission("read-write", "admin");

// ─── Webhook Management ────────────────────────────────────────────────────

const webhookSchema = z.object({
  url: z.string().url().max(2000),
  events: z.array(z.enum(["ingestion.complete", "ingestion.failed"])).min(1),
});

agentApiRouter.post("/webhooks", writePermission, validateBody(webhookSchema), (req: Request, res: Response) => {
  const { url, events } = req.body;
  const orgId = req.apiKey!.orgId;

  const webhook = createWebhook({
    url,
    events: events as WebhookEvent[],
    orgId,
    apiKeyId: req.apiKey!.id,
  });

  logAgentAction(req, "api.webhook_create", "webhook", webhook.id, { url, events });
  res.status(201).json({ webhookId: webhook.id, url: webhook.url, events: webhook.events });
});

agentApiRouter.get("/webhooks", readPermission, (req: Request, res: Response) => {
  const orgId = req.apiKey!.orgId;
  const hooks = listWebhooksByOrg(orgId);
  res.json({
    webhooks: hooks.map((h) => ({
      id: h.id,
      url: h.url,
      events: h.events,
      createdAt: h.createdAt,
    })),
  });
});

agentApiRouter.delete("/webhooks/:id", writePermission, (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const hook = getWebhook(id);

  if (!hook || hook.orgId !== req.apiKey!.orgId) {
    res.status(404).json({ error: "Webhook not found", code: "NOT_FOUND", status: 404 });
    return;
  }

  deleteWebhook(id);
  logAgentAction(req, "api.webhook_delete", "webhook", id);
  res.json({ deleted: true });
});


const createSourceSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

agentApiRouter.post("/sources", writePermission, validateBody(createSourceSchema), (req: Request, res: Response) => {
  const { name, description } = req.body;
  const orgId = req.apiKey!.orgId;
  const ds = createDataSource({
    name, description,
    ownerId: `apikey:${req.apiKey!.name}`,
    orgId,
  });
  logAgentAction(req, "api.source_create", "data_source", ds.id, { name });
  res.status(201).json({
    source: {
      id: ds.id, name: ds.name, type: ds.type,
      documentCount: ds.documentCount,
      lastUpdated: ds.updatedAt.toISOString(),
    },
  });
});

const upload = multer({
  dest: path.join(config.dataDir, "uploads"),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".docx", ".txt", ".md"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${ext}`));
  },
});

agentApiRouter.post("/sources/:id/upload", writePermission, upload.single("file"), async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  if (!isSourceAccessible(id, req)) {
    res.status(404).json({ error: "Source not found", code: "NOT_FOUND", status: 404 });
    return;
  }
  const ds = getDataSource(id);
  if (!ds) {
    res.status(404).json({ error: "Source not found", code: "NOT_FOUND", status: 404 });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded", code: "NO_FILE", status: 400 });
    return;
  }

  const claimedExt = path.extname(req.file.originalname).toLowerCase().slice(1);
  const header = Buffer.alloc(4100);
  const fd = await fs.open(req.file.path, "r");
  try { await fd.read(header, 0, 4100, 0); } finally { await fd.close(); }
  const detected = await fileTypeFromBuffer(header);

  let fileType: Document["type"] = claimedExt as Document["type"];
  if (detected) {
    const canonical = MAGIC_EXT_MAP[detected.ext];
    if (canonical) {
      if (canonical !== claimedExt) {
        await fs.unlink(req.file.path).catch(() => {});
        res.status(400).json({
          error: "File type mismatch", code: "FILE_TYPE_MISMATCH", status: 400,
          details: `Extension is .${claimedExt} but content is ${detected.mime}`,
        });
        return;
      }
      fileType = canonical;
    }
  } else if (!TEXT_EXTENSIONS.has(claimedExt)) {
    await fs.unlink(req.file.path).catch(() => {});
    res.status(400).json({ error: "File type mismatch", code: "FILE_TYPE_MISMATCH", status: 400 });
    return;
  }

  encryptFile(req.file.path);

  const jobId = randomUUID();
  const doc: Document = {
    id: randomUUID(),
    name: req.file.originalname,
    type: fileType,
    classification: "policy",
    uploadedAt: new Date(),
    updatedAt: new Date(),
    status: "processing",
    sectionHeadings: [],
    storageKey: req.file.path,
    dataSourceId: ds.id,
  };

  setDocument(doc);
  refreshDocumentCount(ds.id);
  logAgentAction(req, "api.upload", "document", doc.id, {
    name: doc.name, type: doc.type, sourceId: ds.id, sourceName: ds.name,
  });

  res.status(202).json({
    document: { id: doc.id, name: doc.name, status: "processing" },
    jobId,
  });

  void import("../jobs/ingestDocument.js").then(({ ingestDocument }) =>
    ingestDocument(doc, { datasetName: ds.datasetName }),
  );
});

agentApiRouter.get("/jobs/:id", readPermission, (req: Request, res: Response) => {
  res.json({
    jobId: req.params["id"] as string,
    status: "processing",
    progress: "Check document status via /sources/:id/documents",
  });
});

agentApiRouter.delete("/documents/:id", writePermission, (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const doc = getDocument(id);
  if (!doc) {
    res.status(404).json({ error: "Document not found", code: "NOT_FOUND", status: 404 });
    return;
  }
  if (!doc.dataSourceId || !isSourceAccessible(doc.dataSourceId, req)) {
    res.status(404).json({ error: "Document not found", code: "NOT_FOUND", status: 404 });
    return;
  }
  deleteDocument(id);
  if (doc.storageKey) fs.unlink(doc.storageKey).catch(() => {});
  if (doc.dataSourceId) refreshDocumentCount(doc.dataSourceId);
  logAgentAction(req, "api.delete", "document", id, { name: doc.name });
  res.json({ deleted: true });
});

agentApiRouter.delete("/sources/:id", requirePermission("admin"), (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  if (!isSourceAccessible(id, req)) {
    res.status(404).json({ error: "Source not found", code: "NOT_FOUND", status: 404 });
    return;
  }
  const ds = getDataSource(id);
  if (!ds) {
    res.status(404).json({ error: "Source not found", code: "NOT_FOUND", status: 404 });
    return;
  }
  clearChunksForDataset(ds.datasetName);
  const docs = getDocumentsByDataSource(id);
  for (const doc of docs) {
    deleteDocument(doc.id);
    if (doc.storageKey) fs.unlink(doc.storageKey).catch(() => {});
  }
  archiveDataSource(id);
  logAgentAction(req, "api.source_delete", "data_source", id, { name: ds.name });
  res.json({ deleted: true });
});
