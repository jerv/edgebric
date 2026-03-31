import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { answerStream, filterQuery, splitForSummary, summarizeMessages, buildSummarizedContext } from "@edgebric/core/rag";
import type { ChatMessage } from "@edgebric/core/rag";
import { requireOrg } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { logger } from "../lib/logger.js";
import { isRunning as isOllamaRunning, listRunning as listRunningModels } from "../services/ollamaClient.js";
import { recordAuditEvent } from "../services/auditLog.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import { getAllDocuments, getDocument, getDocumentsByOrg } from "../services/documentStore.js";
import {
  createConversation,
  getConversation,
  getMessages,
  addMessage,
  updateConversationTimestamp,
} from "../services/conversationStore.js";
import { listDataSources, listAccessibleDataSources } from "../services/dataSourceStore.js";
import { broadcastToUser } from "../services/notificationStore.js";
import { routedSearch, type RoutedSearchResult } from "../services/queryRouter.js";
import { rerank, isRerankerAvailable } from "../services/reranker.js";
import type { Session, SessionMessage, PersistedMessage, Citation } from "@edgebric/types";
import { randomUUID } from "crypto";
import { acquireSlot, QueueFullError } from "../services/inferenceQueue.js";

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
  /** Optional node group ID for mesh query targeting (search only nodes in this group). */
  nodeGroupId: z.string().uuid().optional(),
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

// ─── Solo Conversation Summary Cache ─────────────────────────────────────────
// In-memory cache — persists across queries within the same server session.
// Keyed by conversationId → { summary, upToMessageId }.

const soloSummaryCache = new Map<string, { summary: string; upTo: string; oldCount: number }>();

/** Prune solo summary cache entries every 30 minutes. */
setInterval(() => {
  // Keep cache bounded — remove oldest entries if cache exceeds 500
  if (soloSummaryCache.size > 500) {
    const keys = [...soloSummaryCache.keys()];
    for (let i = 0; i < keys.length - 500; i++) {
      soloSummaryCache.delete(keys[i]!);
    }
  }
}, 30 * 60_000).unref();

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

// Chat client — uses Ollama's OpenAI-compatible API for streaming inference.
import { createChatClient } from "../services/ollamaChatClient.js";
const chatClient = createChatClient();

queryRouter.use(requireOrg);

/**
 * Enrich citations with data source name, ID, avatar, freshness, and mesh node attribution.
 * For remote mesh results, the citation includes sourceNodeName from the search results.
 */
function enrichCitationsWithDataSourceName(
  citations: Citation[],
  searchResults?: RoutedSearchResult[],
): void {
  if (citations.length === 0) return;
  const dataSources = listDataSources({ type: "organization" });
  const dsMap = new Map(dataSources.map((ds) => [ds.id, ds]));

  // Build chunkId → node attribution map from routed search results
  const chunkNodeMap = new Map<string, { nodeId: string; nodeName: string }>();
  if (searchResults) {
    for (const r of searchResults) {
      if (r.sourceNodeId && r.sourceNodeName) {
        chunkNodeMap.set(r.chunkId, { nodeId: r.sourceNodeId, nodeName: r.sourceNodeName });
      }
    }
  }

  for (const citation of citations) {
    const doc = citation.documentId ? getDocument(citation.documentId) : undefined;
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

    // Add mesh node attribution if this citation came from a remote node
    if (citation.chunkId) {
      const nodeInfo = chunkNodeMap.get(citation.chunkId);
      if (nodeInfo) {
        citation.sourceNodeName = nodeInfo.nodeName;
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
 * Search with hybrid BM25+vector retrieval, optional cross-encoder
 * reranking, adaptive top-K, and mesh fan-out.
 */
async function searchWithHybrid(
  datasetNames: string[],
  queryText: string,
  meshGroupId?: string,
): Promise<{ results: RoutedSearchResult[]; candidateCount: number; hybridBoost: boolean; meshNodesSearched: number; meshNodesUnavailable: number }> {
  const { results, candidateCount, hybridBoost, meshNodesSearched, meshNodesUnavailable } = await routedSearch(
    datasetNames,
    queryText,
    20, // Retrieve 20 candidates for reranking/adaptive-K
    meshGroupId,
  );

  // Optional cross-encoder reranking (local results only — remote results already ranked)
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

  return { results, candidateCount, hybridBoost, meshNodesSearched, meshNodesUnavailable };
}

// Returns whether the system has at least one ready document to query against
// and whether a chat model is loaded in memory.
queryRouter.get("/status", async (req, res) => {
  const docs = req.session.orgId ? getDocumentsByOrg(req.session.orgId) : getAllDocuments();
  const hasDocuments = docs.some((d) => d.status === "ready");

  let modelLoaded = false;
  try {
    const ollamaUp = await isOllamaRunning();
    if (ollamaUp) {
      const running = await listRunningModels();
      modelLoaded = running.size > 0;
    }
  } catch {
    // If we can't check, assume not loaded
  }

  res.json({ ready: hasDocuments, modelLoaded });
});

queryRouter.post("/", validateBody(queryBodySchema), async (req, res) => {
  const { query, conversationId: existingConvId, private: isPrivate, messages: clientMessages, dataSourceIds, nodeGroupId } = req.body as z.infer<typeof queryBodySchema>;

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

  // Determine strict mode (admin toggle: general answers)
  const orgConfig = getIntegrationConfig();
  const strict = !(orgConfig.generalAnswersEnabled ?? true);

  // ─── Private Mode: process query but don't log anything ────────────────────
  if (isPrivate) {
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

    let releaseSlotFn: (() => void) | undefined;
    try {
      const orgId = req.session.orgId;
      const datasetNames = resolveTargetDatasets(dataSourceIds, req.session.email ?? "", req.session.isAdmin ?? false, orgId);
      const { results: searchResults, candidateCount, hybridBoost, meshNodesSearched, meshNodesUnavailable } = await searchWithHybrid(datasetNames, query, nodeGroupId);

      // Acquire inference slot
      const abortController = new AbortController();
      req.on("close", () => abortController.abort());
      try {
        releaseSlotFn = await acquireSlot(
          session.id,
          "high",
          (position) => sendEvent("queued", { position }),
          abortController.signal,
        );
      } catch (err) {
        if (err instanceof QueueFullError) {
          sendEvent("error", { message: "The system is busy. Please try again in a moment." });
          try { res.end(); } catch { /* already closed */ }
          return;
        }
        throw err;
      }

      const stream = answerStream(
        query,
        session,
        { datasetName: datasetNames[0]!, datasetNames, topK: 10, similarityThreshold: 0.3, candidateCount, hybridBoost, strict },
        {
          search: async () => searchResults,
          generate: (messages) => chatClient.chatStream(messages),
        },
      );

      for await (const chunk of stream) {
        if (chunk.delta) sendEvent("delta", { delta: chunk.delta });
        if (chunk.final) {
          enrichCitationsWithDataSourceName(chunk.final.citations, searchResults);
          // No DB writes — just send the final response
          sendEvent("done", { ...chunk.final, private: true, meshNodesSearched, meshNodesUnavailable });
        }
      }
    } catch {
      sendEvent("error", { message: "An error occurred. Please try again." });
      // Intentionally suppress error details — private mode must leave no trace in logs
      logger.error("Private query error");
    } finally {
      releaseSlotFn?.();
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

  // Build session with conversation summarization (same pipeline as group chat)
  const allMessages = getMessages(conversation.id);
  const chatMsgs: ChatMessage[] = allMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const { old, recent } = splitForSummary(chatMsgs, 3000);

  let summary = "";
  if (old.length > 0) {
    const cached = soloSummaryCache.get(conversation.id);
    if (cached && cached.oldCount === old.length) {
      summary = cached.summary;
    } else {
      try {
        summary = await summarizeMessages(old, (msgs) => chatClient.chatStream(msgs));
        if (summary && allMessages.length > 0) {
          soloSummaryCache.set(conversation.id, {
            summary,
            upTo: allMessages[allMessages.length - 1]!.id,
            oldCount: old.length,
          });
        }
      } catch (err) {
        logger.warn({ err }, "Solo conversation summarization failed, using recent messages only");
      }
    }
  }

  const summarizedContext = buildSummarizedContext(summary, recent);
  const sessionMessages: SessionMessage[] = summarizedContext
    .slice(-12)
    .map((m) => ({ role: m.role as SessionMessage["role"], content: m.content }));

  const session: Session = {
    id: conversation.id,
    createdAt: conversation.createdAt,
    messages: sessionMessages,
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

  // Search runs outside the inference queue — doesn't need the LLM
  let releaseSlotFn: (() => void) | undefined;
  try {
    const datasetNames = resolveTargetDatasets(dataSourceIds, req.session.email ?? "", req.session.isAdmin ?? false, orgId);
    const { results: searchResults, candidateCount, hybridBoost, meshNodesSearched, meshNodesUnavailable } = await searchWithHybrid(datasetNames, query, nodeGroupId);

    // Acquire inference slot — waits if all slots busy, sends queue position via SSE
    const abortController = new AbortController();
    req.on("close", () => abortController.abort());
    try {
      releaseSlotFn = await acquireSlot(
        conversation.id,
        "high",
        (position) => sendEvent("queued", { position }),
        abortController.signal,
      );
    } catch (err) {
      if (err instanceof QueueFullError) {
        sendEvent("error", { message: "The system is busy. Please try again in a moment." });
        try { res.end(); } catch { /* already closed */ }
        return;
      }
      throw err;
    }

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
        strict,
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
        enrichCitationsWithDataSourceName(chunk.final.citations, searchResults);

        // Save assistant message to DB
        const assistantMsgId = randomUUID();
        const assistantMsg: PersistedMessage = {
          id: assistantMsgId,
          conversationId: conversation.id,
          role: "assistant",
          content: chunk.final.answer,
          citations: chunk.final.citations,
          hasConfidentAnswer: chunk.final.hasConfidentAnswer,
          ...(chunk.final.answerType != null && { answerType: chunk.final.answerType }),
          createdAt: new Date(),
        };
        addMessage(assistantMsg);
        updateConversationTimestamp(conversation.id);

        // Emit done event with conversation + message IDs + mesh info
        sendEvent("done", {
          ...chunk.final,
          conversationId: conversation.id,
          messageId: assistantMsgId,
          meshNodesSearched,
          meshNodesUnavailable,
        });
      }
    }
  } catch (err) {
    sendEvent("error", { message: "An error occurred. Please try again." });
    logger.error({ err }, "Query error");
  } finally {
    releaseSlotFn?.();
    broadcastToUser(userEmail, "bot_thinking", { chatId: conversation.id, thinking: false });
    try { res.end(); } catch { /* already closed */ }
  }
});
