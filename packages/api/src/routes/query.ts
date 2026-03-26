import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { answerStream, filterQuery } from "@edgebric/core/rag";
import { createMILMClient, createMKBClient } from "@edgebric/edge";
import { requireOrg } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { logger } from "../lib/logger.js";
import { runtimeEdgeConfig, runtimeChatConfig, config } from "../config.js";
import { isRunning as isOllamaRunning, listRunning as listRunningModels } from "../services/ollamaClient.js";
import { recordAuditEvent } from "../services/auditLog.js";
import { getAllDocuments, getDocument, getDocumentsByOrg } from "../services/documentStore.js";
import {
  createConversation,
  getConversation,
  getMessages,
  addMessage,
  updateConversationTimestamp,
} from "../services/conversationStore.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import { listDataSources, listAccessibleDataSources } from "../services/dataSourceStore.js";
import { broadcastToUser } from "../services/notificationStore.js";
import { hybridMultiDatasetSearch } from "../services/searchService.js";
import { rerank, isRerankerAvailable } from "../services/reranker.js";
import type { Session, SessionMessage, PersistedMessage, Citation } from "@edgebric/types";
import { randomUUID } from "crypto";

const queryBodySchema = z.object({
  query: z.string().min(1, "Query cannot be empty").max(4000, "Query too long"),
  conversationId: z.string().optional(),
  private: z.boolean().optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(8000),
  })).max(20).optional(),
  /** Optional data source IDs to restrict search scope. Omit for default (all accessible). */
  dataSourceIds: z.array(z.string().uuid()).max(20).optional(),
});

// ─── Rate Limiting ───────────────────────────────────────────────────────────

const QUERY_RATE_LIMIT = 10;
const QUERY_RATE_WINDOW_MS = 60_000;

/** Map<email → timestamp[]> */
const queryTimestamps = new Map<string, number[]>();

/** Prune stale entries every 5 minutes. */
setInterval(() => {
  const cutoff = Date.now() - QUERY_RATE_WINDOW_MS;
  for (const [key, timestamps] of queryTimestamps) {
    const fresh = timestamps.filter((t) => t > cutoff);
    if (fresh.length === 0) queryTimestamps.delete(key);
    else queryTimestamps.set(key, fresh);
  }
}, 5 * 60_000).unref();

function checkQueryRateLimit(email: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const cutoff = now - QUERY_RATE_WINDOW_MS;
  const timestamps = (queryTimestamps.get(email) ?? []).filter((t) => t > cutoff);

  if (timestamps.length >= QUERY_RATE_LIMIT) {
    const oldestInWindow = timestamps[0]!;
    return { allowed: false, retryAfterMs: oldestInWindow + QUERY_RATE_WINDOW_MS - now };
  }

  timestamps.push(now);
  queryTimestamps.set(email, timestamps);
  return { allowed: true };
}

export const queryRouter: IRouter = Router();

// mkb + embeddings always use mILM
const mkb = createMKBClient(runtimeEdgeConfig);

// Chat uses llama-server (or mILM fallback) via runtimeChatConfig.
// Build an EdgeConfig-compatible proxy so the MILM client reads the right endpoint.
// llama-server uses standard OpenAI paths (/v1/chat/completions) — not mILM's /api/mim/v1.
// CHAT_BASE_URL includes the full base path (e.g. http://127.0.0.1:8080/v1),
// so we pass an empty basePath to avoid doubling it.
const chatEdgeConfig = {
  get baseUrl() { return runtimeChatConfig.baseUrl; },
  get apiKey() { return runtimeChatConfig.apiKey; },
  get milmModel() { return runtimeChatConfig.model; },
  embeddingModel: runtimeEdgeConfig.embeddingModel,
};
const chatClient = createMILMClient(chatEdgeConfig, "");

queryRouter.use(requireOrg);

/** Enrich citations with the data source name, ID, avatar, and freshness based on document lookup. */
function enrichCitationsWithDataSourceName(citations: Citation[]): void {
  if (citations.length === 0) return;
  const dataSources = listDataSources({ type: "organization" });
  const dsMap = new Map(dataSources.map((ds) => [ds.id, ds]));
  for (const citation of citations) {
    const doc = getDocument(citation.documentId);
    if (doc) {
      // Source freshness: include the document's last update time
      citation.documentUpdatedAt = doc.updatedAt instanceof Date
        ? doc.updatedAt.toISOString()
        : String(doc.updatedAt);

      if (doc.dataSourceId) {
        const ds = dsMap.get(doc.dataSourceId);
        if (ds) {
          citation.dataSourceName = ds.name;
          citation.dataSourceId = ds.id;
          if (ds.avatarUrl) citation.dataSourceAvatarUrl = ds.avatarUrl;
        }
      }
    }
  }
}

/**
 * Resolve target dataset names from client-provided data source IDs.
 * Always intersects with the user's accessible set (security: prevents unauthorized access).
 * Falls back to all accessible datasets if no IDs provided.
 */
function resolveTargetDatasets(
  requestedDSIds: string[] | undefined,
  email: string,
  isAdmin: boolean,
  orgId?: string,
): string[] {
  const accessibleDS = listAccessibleDataSources(email, isAdmin, orgId);
  if (accessibleDS.length === 0) return ["knowledge-base"];

  // No filter requested — search all accessible data sources (default behavior)
  if (!requestedDSIds || requestedDSIds.length === 0) {
    return accessibleDS.map((ds) => ds.datasetName);
  }

  // Intersect requested IDs with accessible set
  const requestedSet = new Set(requestedDSIds);
  const filtered = accessibleDS.filter((ds) => requestedSet.has(ds.id));

  // If intersection is empty (user requested data sources they can't access), return empty
  // This will produce a "no results" response rather than silently searching everything
  if (filtered.length === 0) return [];

  return filtered.map((ds) => ds.datasetName);
}

/**
 * Search across multiple mKB datasets with hybrid BM25+vector retrieval,
 * optional cross-encoder reranking, and adaptive top-K.
 */
async function searchWithHybrid(
  datasetNames: string[],
  queryText: string,
): Promise<{ results: import("../services/searchService.js").HybridSearchResult[]; candidateCount: number; hybridBoost: boolean }> {
  const { results, candidateCount, hybridBoost } = await hybridMultiDatasetSearch(
    mkb,
    datasetNames,
    queryText,
    20, // Retrieve 20 candidates for reranking/adaptive-K
  );

  // Optional cross-encoder reranking
  if (isRerankerAvailable() && results.length > 1) {
    const reranked = await rerank(
      queryText,
      results.map((r) => ({
        chunkId: r.chunkId,
        text: r.chunk,
        originalScore: r.similarity,
      })),
    );
    // Re-sort results by reranker score
    const rerankedMap = new Map(reranked.map((r) => [r.chunkId, r.rerankerScore]));
    results.sort((a, b) => (rerankedMap.get(b.chunkId) ?? 0) - (rerankedMap.get(a.chunkId) ?? 0));
  }

  return { results, candidateCount, hybridBoost };
}

// Returns whether the system has at least one ready document to query against.
queryRouter.get("/status", (req, res) => {
  const docs = req.session.orgId ? getDocumentsByOrg(req.session.orgId) : getAllDocuments();
  const hasDocuments = docs.some((d) => d.status === "ready");
  res.json({ ready: hasDocuments });
});

queryRouter.post("/", validateBody(queryBodySchema), async (req, res) => {
  const { query, conversationId: existingConvId, private: isPrivate, messages: clientMessages, dataSourceIds } = req.body as z.infer<typeof queryBodySchema>;

  // Rate limit: 10 queries per minute per user
  const rateLimitEmail = req.session.email;
  if (rateLimitEmail) {
    const rateCheck = checkQueryRateLimit(rateLimitEmail);
    if (!rateCheck.allowed) {
      const retrySec = Math.ceil((rateCheck.retryAfterMs ?? QUERY_RATE_WINDOW_MS) / 1000);
      res.status(429).json({
        error: `Rate limit exceeded. You can send ${QUERY_RATE_LIMIT} queries per minute. Try again in ${retrySec}s.`,
      });
      return;
    }
  }

  const filterResult = filterQuery(query);
  if (!filterResult.allowed) {
    res.status(200).json({ blocked: true, message: filterResult.redirectMessage });
    return;
  }

  // Check that Ollama has a model loaded — fail early with a clear message
  // instead of a cryptic connection error during generation.
  const ollamaUp = await isOllamaRunning();
  if (!ollamaUp) {
    // SSE error so the chat UI can display it inline
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(`event: error\ndata: ${JSON.stringify({ message: "The AI engine is not running. Please contact your administrator." })}\n\n`);
    res.end();
    return;
  }

  try {
    const running = await listRunningModels();
    if (running.size === 0) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
      res.write(`event: error\ndata: ${JSON.stringify({ message: "No AI model is loaded. An admin needs to load a model from Settings." })}\n\n`);
      res.end();
      return;
    }
  } catch {
    // Could not check running models — proceed anyway and let the generation
    // call fail with a more specific error if needed.
  }

  // Audit: log query execution (no query text — privacy)
  recordAuditEvent({
    eventType: "query.execute",
    actorEmail: req.session.email,
    actorIp: req.ip,
    details: { dsCount: dataSourceIds?.length ?? 0, hasConversation: !!existingConvId },
  });

  // ─── Private Mode: process query but don't log anything ────────────────────
  if (isPrivate) {
    const orgConfig = getIntegrationConfig();
    if (!orgConfig.privateModeEnabled) {
      res.status(403).json({ error: "Private mode is not enabled" });
      return;
    }

    // Build ephemeral session from client-provided messages (no DB access)
    const sessionMessages: SessionMessage[] = (clientMessages ?? []).slice(-4).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    // Add current query to session
    sessionMessages.push({ role: "user", content: query });

    const session: Session = {
      id: randomUUID(),
      createdAt: new Date(),
      messages: sessionMessages,
    };

    // Set up SSE and run RAG — same pipeline, zero DB writes
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let clientDisconnected = false;
    const sendEvent = (event: string, data: unknown) => {
      if (clientDisconnected) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        clientDisconnected = true;
      }
    };
    req.on("close", () => { clientDisconnected = true; });

    try {
      const orgId = req.session.orgId;
      const datasetNames = resolveTargetDatasets(dataSourceIds, req.session.email ?? "", req.session.isAdmin ?? false, orgId);
      const { results: searchResults, candidateCount, hybridBoost } = await searchWithHybrid(datasetNames, query);
      const stream = answerStream(
        query,
        session,
        { datasetName: datasetNames[0]!, datasetNames, topK: 10, similarityThreshold: 0.3, candidateCount, hybridBoost },
        {
          search: async () => searchResults,
          generate: (messages) => chatClient.chatStream(messages),
        },
      );

      for await (const chunk of stream) {
        if (chunk.delta) sendEvent("delta", { delta: chunk.delta });
        if (chunk.final) {
          enrichCitationsWithDataSourceName(chunk.final.citations);
          // No DB writes — just send the final response
          sendEvent("done", { ...chunk.final, private: true });
        }
      }
    } catch {
      sendEvent("error", { message: "An error occurred. Please try again." });
      // Intentionally suppress error details — private mode must leave no trace in logs
      logger.error("Private query error");
    } finally {
      try { res.end(); } catch { /* already closed */ }
    }
    return;
  }

  // ─── Standard Mode: normal persistent flow ─────────────────────────────────

  // Get or create persistent conversation
  const userEmail = req.session.email;
  if (!userEmail) {
    // Session predates the email-storage change — force re-login
    res.status(401).json({ error: "Session expired. Please sign in again." });
    return;
  }
  const userName = req.session.name;
  const orgId = req.session.orgId;
  let conversation = existingConvId ? getConversation(existingConvId) : undefined;
  // Verify ownership — prevent accessing another user's conversation
  if (conversation && conversation.userEmail !== userEmail) {
    conversation = undefined; // Start a new conversation instead
  }
  if (!conversation) {
    conversation = createConversation(userEmail, userName, orgId);
  }

  // Save user message to DB
  const userMsgId = randomUUID();
  const userMsg: PersistedMessage = {
    id: userMsgId,
    conversationId: conversation.id,
    role: "user",
    content: query,
    createdAt: new Date(),
  };
  addMessage(userMsg);

  // Build session from last N persisted messages for multi-turn RAG context
  const recentMessages = getMessages(conversation.id).slice(-4);
  const session: Session = {
    id: conversation.id,
    createdAt: conversation.createdAt,
    messages: recentMessages.map((m) => {
      const sm: SessionMessage = { role: m.role, content: m.content };
      if (m.citations) sm.citations = m.citations;
      return sm;
    }),
  };

  // Broadcast thinking state to sidebar
  broadcastToUser(userEmail, "bot_thinking", { chatId: conversation.id, thinking: true });

  // Set up SSE streaming
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let clientDisconnected = false;
  const sendEvent = (event: string, data: unknown) => {
    if (clientDisconnected) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      clientDisconnected = true;
    }
  };
  req.on("close", () => { clientDisconnected = true; });

  try {
    const datasetNames = resolveTargetDatasets(dataSourceIds, req.session.email ?? "", req.session.isAdmin ?? false, orgId);
    const { results: searchResults, candidateCount, hybridBoost } = await searchWithHybrid(datasetNames, query);
    const stream = answerStream(
      query,
      session,
      {
        datasetName: datasetNames[0]!,
        datasetNames,
        topK: 10,
        similarityThreshold: 0.3,
        candidateCount,
        hybridBoost,
      },
      {
        search: async () => searchResults,
        generate: (messages) => chatClient.chatStream(messages),
      },
    );

    for await (const chunk of stream) {
      if (chunk.delta) {
        sendEvent("delta", { delta: chunk.delta });
      }
      if (chunk.final) {
        enrichCitationsWithDataSourceName(chunk.final.citations);

        // Save assistant message to DB
        const assistantMsgId = randomUUID();
        const assistantMsg: PersistedMessage = {
          id: assistantMsgId,
          conversationId: conversation.id,
          role: "assistant",
          content: chunk.final.answer,
          citations: chunk.final.citations,
          hasConfidentAnswer: chunk.final.hasConfidentAnswer,
          createdAt: new Date(),
        };
        addMessage(assistantMsg);
        updateConversationTimestamp(conversation.id);

        // Emit done event with conversation + message IDs
        sendEvent("done", {
          ...chunk.final,
          conversationId: conversation.id,
          messageId: assistantMsgId,
        });
      }
    }
  } catch (err) {
    sendEvent("error", { message: "An error occurred. Please try again." });
    logger.error({ err }, "Query error");
  } finally {
    broadcastToUser(userEmail, "bot_thinking", { chatId: conversation.id, thinking: false });
    try { res.end(); } catch { /* already closed */ }
  }
});
