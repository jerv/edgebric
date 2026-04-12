import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { filterQuery, splitForSummary, summarizeMessages, buildSummarizedContext, buildMemoryContext } from "@edgebric/core/rag";
import type { ChatMessage } from "@edgebric/core/rag";
import { requireOrg } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { logger } from "../lib/logger.js";
import { config } from "../config.js";
import { isRunning as isInferenceRunning, listRunning as listRunningModels } from "../services/inferenceClient.js";
import { recordAuditEvent } from "../services/auditLog.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import { getDocument } from "../services/documentStore.js";
import {
  createConversation,
  getConversation,
  getMessages,
  addMessage,
  updateMessage,
  updateConversationTimestamp,
} from "../services/conversationStore.js";
import { listDataSources, listAccessibleDataSources } from "../services/dataSourceStore.js";
import { broadcastToUser } from "../services/notificationStore.js";
import { routedSearch, type RoutedSearchResult } from "../services/queryRouter.js";
import { rerank, isRerankerAvailable } from "../services/reranker.js";
import { getUserGroupIds } from "../services/userMeshGroupStore.js";
import { getUserInOrg } from "../services/userStore.js";
import type { Session, SessionMessage, PersistedMessage, Citation, ExecutionChecklistItem } from "@edgebric/types";
import { MODEL_CATALOG_MAP } from "@edgebric/types";
import { randomUUID } from "crypto";
import { acquireSlot, QueueFullError } from "../services/inferenceQueue.js";
import { registerAllTools } from "../services/tools/index.js";
import { runtimeChatConfig } from "../config.js";
import { isMemoryEnabled, getMemoryDatasetName } from "../services/memoryStore.js";
import { hybridMultiDatasetSearch as memoryHybridSearch } from "../services/searchService.js";
import { processMessageForMemories } from "../services/memoryExtractor.js";
import { isConciseLookupQuery, isDirectMemoryQuery, isSimpleSmallTalk, runOrchestratedChat } from "../services/chatOrchestrator.js";
import { DEFAULT_CHAT_STRICT, DEFAULT_RAG_BEHAVIOR } from "../services/chatDefaults.js";
import { executeTool } from "../services/toolRunner.js";

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
  /** Skip document search entirely — pure LLM chat with no RAG context. */
  skipSearch: z.boolean().optional(),
});

const executeActionSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  tool: z.enum(["save_to_vault", "create_source", "update_source", "rename_document", "delete_document", "delete_source"]),
  arguments: z.record(z.string(), z.unknown()),
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
const soloSummaryRefreshes = new Set<string>();
let embeddingHealthCache: { checkedAt: number; available: boolean } = { checkedAt: 0, available: false };

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

// Chat client — uses llama-server's OpenAI-compatible API for streaming inference.
import { createChatClient } from "../services/chatClient.js";
const chatClient = createChatClient();

// Register all tools on module load
registerAllTools();

/** Check if the active model supports tool calling. */
function isToolUseEnabled(): boolean {
  const tag = runtimeChatConfig.model;
  const catalogEntry = MODEL_CATALOG_MAP.get(tag);
  return catalogEntry?.capabilities?.toolUse === true;
}

queryRouter.post("/actions/execute", requireOrg, validateBody(executeActionSchema), async (req, res) => {
  const { conversationId, messageId, tool, arguments: args } = req.body as z.infer<typeof executeActionSchema>;
  const userEmail = req.session.email ?? "";
  const isAdmin = req.session.isAdmin ?? false;
  const orgId = req.session.orgId;

  const conversation = getConversation(conversationId);
  if (!conversation || conversation.userEmail !== userEmail) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const message = getMessages(conversationId).find((m) => m.id === messageId && m.role === "assistant");
  if (!message) {
    res.status(404).json({ error: "Assistant message not found" });
    return;
  }

  const result = await executeTool(tool, args, {
    userEmail,
    isAdmin,
    orgId,
    allowedSourceIds: listAccessibleDataSources(userEmail, isAdmin, orgId).map((ds) => ds.id),
    allowWeb: true,
    allowMutations: true,
  });

  if (!result.success) {
    res.status(400).json({ error: result.error ?? "Action failed" });
    return;
  }

  const summaryByTool: Record<string, string> = {
    save_to_vault: `Saved as "${String(args["title"] ?? "document")}".`,
    create_source: `Created source "${String((result.data as Record<string, unknown>)["name"] ?? args["name"] ?? "source")}".`,
    update_source: `Updated "${String((result.data as Record<string, unknown>)["name"] ?? args["sourceName"] ?? "source")}".`,
    rename_document: `Renamed to "${String((result.data as Record<string, unknown>)["newName"] ?? args["newName"] ?? "document")}".`,
    delete_document: `Deleted "${String((result.data as Record<string, unknown>)["deleted"] ?? args["documentName"] ?? "document")}".`,
    delete_source: `Deleted "${String((result.data as Record<string, unknown>)["deleted"] ?? args["sourceName"] ?? "source")}".`,
  };

  const summary = summaryByTool[tool] ?? "Action completed.";
  const executionPlan: ExecutionChecklistItem[] = [{
    id: "confirmed-action",
    title: summary,
    status: "completed",
    tool,
    summary,
  }];
  const toolUses = [{
    name: tool,
    arguments: args,
    result: { success: true, summary },
  }];

  updateMessage(messageId, {
    content: summary,
    toolUses,
    executionPlan,
    actionProposal: undefined,
    hasConfidentAnswer: true,
    answerType: "general",
  });
  updateConversationTimestamp(conversationId);

  res.json({
    ok: true,
    answer: summary,
    toolUses,
    executionPlan,
  });
});

async function refreshSoloSummary(
  conversationId: string,
  oldMessages: ChatMessage[],
  upToMessageId: string,
): Promise<void> {
  if (oldMessages.length === 0 || soloSummaryRefreshes.has(conversationId)) return;
  soloSummaryRefreshes.add(conversationId);

  let releaseSlotFn: (() => void) | undefined;
  try {
    releaseSlotFn = await acquireSlot(`solo-summary-${conversationId}`, "low");
    const summary = await summarizeMessages(oldMessages, (msgs) => chatClient.chatStream(msgs));
    if (summary) {
      soloSummaryCache.set(conversationId, {
        summary,
        upTo: upToMessageId,
        oldCount: oldMessages.length,
      });
    }
  } catch (err) {
    logger.warn({ err, conversationId }, "Solo conversation summary refresh failed");
  } finally {
    releaseSlotFn?.();
    soloSummaryRefreshes.delete(conversationId);
  }
}

/**
 * Build memory context for the current user's query, if memory is enabled.
 * Returns a formatted string to prepend to the system prompt, or empty string.
 */
async function getMemoryContextBlock(query: string, orgId?: string, userEmail?: string): Promise<string> {
  if (!isMemoryEnabled() || !userEmail) return "";
  const memoryDataset = getMemoryDatasetName(orgId, userEmail);
  if (!memoryDataset) return "";

  // Cache embedding health briefly so simple chats don't keep paying a network round-trip.
  const now = Date.now();
  if (now - embeddingHealthCache.checkedAt > 5_000) {
    const { isEmbeddingRunning } = await import("../services/inferenceClient.js");
    embeddingHealthCache = {
      checkedAt: now,
      available: await isEmbeddingRunning(),
    };
  }
  if (!embeddingHealthCache.available) return "";

  try {
    return await buildMemoryContext(query, async (q, topK) => {
      const { results } = await memoryHybridSearch([memoryDataset], q, topK);
      return results.map((r) => ({
        content: r.chunk,
        category: r.metadata.heading ?? "fact",
        confidence: r.similarity,
      }));
    });
  } catch {
    // Memory search failure should never block the main query
    return "";
  }
}

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
  allowedGroupIds?: string[],
  allowedDataSourceIds?: string[],
): Promise<{ results: RoutedSearchResult[]; candidateCount: number; hybridBoost: boolean; meshNodesSearched: number; meshNodesUnavailable: number }> {
  const { results, candidateCount, hybridBoost, meshNodesSearched, meshNodesUnavailable } = await routedSearch(
    datasetNames,
    queryText,
    20, // Retrieve 20 candidates for reranking/adaptive-K
    allowedGroupIds,
    allowedDataSourceIds,
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

// Returns whether the system is ready for chat and whether a model is loaded.
// Chat is always available — documents are optional (RAG enhances answers but isn't required).
queryRouter.get("/status", async (req, res) => {
  const serverUp = await isInferenceRunning();
  let modelLoaded = false;
  if (serverUp) {
    try {
      const running = await listRunningModels();
      modelLoaded = running.size > 0;
    } catch {
      modelLoaded = false;
    }
  }
  res.json({ ready: true, modelLoaded });
});

queryRouter.post("/", validateBody(queryBodySchema), async (req, res) => {
  const { query, conversationId: existingConvId, private: isPrivate, messages: clientMessages, dataSourceIds, skipSearch } = req.body as z.infer<typeof queryBodySchema>;

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

  // Check that the inference server has a model loaded — fail early with a
  // clear message instead of a cryptic connection error during generation.
  const serverUp = await isInferenceRunning();
  if (!serverUp) {
    // SSE error so the chat UI can display it inline
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(`event: error\ndata: ${JSON.stringify({ message: "The AI engine is not running. Start or load a model from Manage Models." })}\n\n`);
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
  // Anonymize actor when private mode is active to avoid leaking user identity
  recordAuditEvent({
    eventType: "query.execute",
    actorEmail: isPrivate ? "anonymous" : req.session.email,
    actorIp: isPrivate ? undefined : req.ip,
    details: { dsCount: dataSourceIds?.length ?? 0, hasConversation: !!existingConvId },
  });

  const orgConfig = getIntegrationConfig();
  const strict = DEFAULT_CHAT_STRICT;
  const { decompose: useDecompose, rerank: useRerank, iterativeRetrieval: useIterativeRetrieval } = DEFAULT_RAG_BEHAVIOR;

  // Resolve mesh group access: admins get undefined (all groups), users get their assigned groups
  const isAdmin = req.session.isAdmin ?? false;
  let allowedGroupIds: string[] | undefined;
  if (!isAdmin) {
    const user = getUserInOrg(req.session.email ?? "", req.session.orgId ?? "");
    allowedGroupIds = user ? getUserGroupIds(user.id) : [];
  }

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
      const shouldSkipRetrieval = skipSearch === true;
      const datasetNames = shouldSkipRetrieval ? [] : resolveTargetDatasets(dataSourceIds, req.session.email ?? "", req.session.isAdmin ?? false, orgId);
      // Forward accessible data source IDs for server-side ACL enforcement on mesh nodes
      const accessibleDSIds = shouldSkipRetrieval ? [] : listAccessibleDataSources(req.session.email ?? "", req.session.isAdmin ?? false, orgId).map((ds) => ds.id);

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

      const result = await runOrchestratedChat({
        label: "private-query",
        query,
        session,
        strict,
        ...(skipSearch !== undefined ? { skipSearch } : {}),
        allowDirectMemoryActions: false,
        allowToolPlanning: isToolUseEnabled(),
        sendEvent,
      search: {
        ...(datasetNames[0] ? { datasetName: datasetNames[0] } : {}),
        datasetNames,
        useDecompose,
        useRerank,
        useIterativeRetrieval,
        execute: async (searchQuery) => shouldSkipRetrieval
          ? { results: [], candidateCount: 0, hybridBoost: false, meshNodesSearched: 0, meshNodesUnavailable: 0 }
          : await searchWithHybrid(datasetNames, searchQuery, allowedGroupIds, accessibleDSIds),
      },
        toolContext: {
          userEmail: req.session.email ?? "anonymous",
          isAdmin,
          orgId,
          allowedSourceIds: accessibleDSIds,
          allowWeb: true,
          allowMutations: false,
        },
      });

      if (result.citations.length > 0) {
        enrichCitationsWithDataSourceName(result.citations, result.searchResults as RoutedSearchResult[] | undefined);
      }
      sendEvent("done", { ...result, private: true, sessionId: session.id });
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
    } else if (allMessages.length > 0) {
      void refreshSoloSummary(conversation.id, old, allMessages[allMessages.length - 1]!.id);
    }
  }

  const summarizedContext = buildSummarizedContext(summary, recent);
  let sessionMessages: SessionMessage[] = summarizedContext
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

  // ─── Tool Use Mode ───────────────────────────────────────────────────────
  // When the active model supports tool calling, use the tool loop instead of
  // the standard RAG pipeline. The model autonomously decides which tools to
  // call (search_knowledge, web_search, etc.) based on the user's query.

  let releaseSlotFn: (() => void) | undefined;
  try {
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

    const shouldSkipRetrieval = skipSearch === true;
    const datasetNames = shouldSkipRetrieval ? [] : resolveTargetDatasets(dataSourceIds, req.session.email ?? "", req.session.isAdmin ?? false, orgId);
    const accessibleDSIds = shouldSkipRetrieval ? [] : listAccessibleDataSources(req.session.email ?? "", req.session.isAdmin ?? false, orgId).map((ds) => ds.id);
    const shouldLoadMemoryContext = !isSimpleSmallTalk(query)
      && !isDirectMemoryQuery(query)
      && !isConciseLookupQuery(query);
    const memoryContextBlock = shouldLoadMemoryContext
      ? await getMemoryContextBlock(query, orgId, userEmail)
      : "";

    const result = await runOrchestratedChat({
      label: "solo-query",
      query,
      session,
      strict,
      ...(skipSearch !== undefined ? { skipSearch } : {}),
      allowDirectMemoryActions: true,
      memoryContextBlock,
      allowToolPlanning: isToolUseEnabled(),
      sendEvent,
      search: {
        ...(datasetNames[0] ? { datasetName: datasetNames[0] } : {}),
        datasetNames,
        useDecompose,
        useRerank,
        useIterativeRetrieval,
        execute: async (searchQuery) => shouldSkipRetrieval
          ? { results: [], candidateCount: 0, hybridBoost: false, meshNodesSearched: 0, meshNodesUnavailable: 0 }
          : await searchWithHybrid(datasetNames, searchQuery, allowedGroupIds, accessibleDSIds),
      },
      toolContext: {
        userEmail,
        isAdmin,
        orgId,
        allowedSourceIds: accessibleDSIds,
        allowWeb: true,
        allowMutations: true,
      },
    });

    if (result.citations.length > 0) {
      enrichCitationsWithDataSourceName(result.citations, result.searchResults as RoutedSearchResult[] | undefined);
    }

    const assistantMsgId = randomUUID();
    const assistantMsg: PersistedMessage = {
      id: assistantMsgId,
      conversationId: conversation.id,
      role: "assistant",
      content: result.answer,
      citations: result.citations,
      hasConfidentAnswer: result.hasConfidentAnswer,
      ...(result.answerType != null && { answerType: result.answerType }),
      ...(result.toolUses && result.toolUses.length > 0 && { toolUses: result.toolUses }),
      ...(result.executionPlan && result.executionPlan.length > 0 && { executionPlan: result.executionPlan }),
      ...(result.actionProposal && { actionProposal: result.actionProposal }),
      createdAt: new Date(),
    };
    addMessage(assistantMsg);
    updateConversationTimestamp(conversation.id);

    sendEvent("done", {
      ...result,
      sessionId: conversation.id,
      conversationId: conversation.id,
      messageId: assistantMsgId,
    });

    void processMessageForMemories(query, orgId, userEmail);
  } catch (err) {
    sendEvent("error", { message: "An error occurred. Please try again." });
    logger.error({ err }, "Query error");
  } finally {
    releaseSlotFn?.();
    broadcastToUser(userEmail, "bot_thinking", { chatId: conversation.id, thinking: false });
    try { res.end(); } catch { /* already closed */ }
  }
});

// ─── File Upload Query ──────────────────────────────────────────────────────
// POST /api/query/with-file — multipart form data with file + query text.
// For images: included as-is in chat request (if model has vision).
// For documents: text extracted inline and included as context.

const fileUpload = multer({
  dest: path.join(config.dataDir, "uploads", "chat"),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".docx", ".txt", ".md"];
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${ext}`));
  },
});

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const DOC_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md"]);

queryRouter.post("/with-file", requireOrg, fileUpload.single("file"), async (req, res) => {
  const query = (req.body.query as string ?? "").trim();
  if (!query) {
    res.status(400).json({ error: "Query is required" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const isDocument = DOC_EXTENSIONS.has(ext);

  let augmentedQuery = query;
  let imageBase64: string | undefined;

  try {
    if (isImage) {
      // Read image as base64 for vision models
      const imageBuffer = await fs.readFile(req.file.path);
      imageBase64 = imageBuffer.toString("base64");
    } else if (isDocument) {
      // Extract text from document
      const { extractDocument } = await import("../jobs/extractors.js");
      const docType = ext.slice(1) as "pdf" | "docx" | "txt" | "md";
      const { markdown } = await extractDocument(req.file.path, docType);
      // Truncate to ~8000 chars to fit in context
      const truncated = markdown.length > 8000 ? markdown.slice(0, 8000) + "\n\n[...document truncated...]" : markdown;
      // Sanitize filename to prevent prompt structure injection
      const safeName = req.file.originalname.replace(/[\n\r\t"]/g, "_").slice(0, 100);
      augmentedQuery = `The user has attached a document "${safeName}".\n\n<attached_document>\n${truncated}\n</attached_document>\n\nUser's question: ${query}`;
    }

    // Clean up the uploaded file
    await fs.unlink(req.file.path).catch(() => {});

    // For now, return the augmented query info. The frontend will use this
    // with the regular /api/query endpoint (sending the extracted text as part of the query).
    res.json({
      augmentedQuery,
      fileType: isImage ? "image" : "document",
      fileName: req.file.originalname,
      // Image base64 is only returned for vision-capable models (frontend checks capabilities first)
      ...(imageBase64 && { imageBase64: `data:image/${ext.slice(1)};base64,${imageBase64}` }),
    });
  } catch (err) {
    logger.error({ err }, "File upload query processing failed");
    // Clean up on error
    await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: "Failed to process uploaded file" });
  }
});
