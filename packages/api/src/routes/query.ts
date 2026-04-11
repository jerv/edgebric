import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { answerStream, filterQuery, splitForSummary, summarizeMessages, buildSummarizedContext, buildMemoryContext } from "@edgebric/core/rag";
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
  updateConversationTimestamp,
} from "../services/conversationStore.js";
import { listDataSources, listAccessibleDataSources } from "../services/dataSourceStore.js";
import { broadcastToUser } from "../services/notificationStore.js";
import { routedSearch, type RoutedSearchResult } from "../services/queryRouter.js";
import { rerank, isRerankerAvailable } from "../services/reranker.js";
import { getUserGroupIds } from "../services/userMeshGroupStore.js";
import { getUserInOrg } from "../services/userStore.js";
import type { Session, SessionMessage, PersistedMessage, Citation } from "@edgebric/types";
import { MODEL_CATALOG_MAP } from "@edgebric/types";
import { randomUUID } from "crypto";
import { acquireSlot, QueueFullError } from "../services/inferenceQueue.js";
import { buildToolDefinitions, executeTool, parseToolCalls, listTools } from "../services/toolRunner.js";
import type { ToolMessage } from "../services/chatClient.js";
import type { ToolContext } from "../services/toolRunner.js";
import { registerAllTools } from "../services/tools/index.js";
import { runtimeChatConfig } from "../config.js";
import { isMemoryEnabled, getMemoryDatasetName, saveMemory } from "../services/memoryStore.js";
import { hybridMultiDatasetSearch as memoryHybridSearch } from "../services/searchService.js";
import { extractExplicitMemoryRequest, processMessageForMemories } from "../services/memoryExtractor.js";

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
  /** Per-request AI behavior overrides (from user's chat settings). */
  aiBehavior: z.object({
    decompose: z.boolean().optional(),
    rerank: z.boolean().optional(),
    iterativeRetrieval: z.boolean().optional(),
    generalAnswers: z.boolean().optional(),
  }).optional(),
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

function isSimpleSmallTalk(query: string): boolean {
  const normalized = query.trim().toLowerCase().replace(/[.!?]+$/g, "");
  return [
    "hi",
    "hello",
    "hey",
    "hey there",
    "yo",
    "good morning",
    "good afternoon",
    "good evening",
    "thanks",
    "thank you",
    "ok",
    "okay",
    "cool",
    "sounds good",
    "who are you",
    "what can you do",
    "help",
  ].includes(normalized);
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

const MAX_TOOL_ROUNDS = 5;

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
 * Tool use information for UI transparency — tracks which tools were called
 * and their results during a single query.
 */
export interface ToolUseInfo {
  name: string;
  arguments: Record<string, unknown>;
  result: { success: boolean; summary: string };
}

/**
 * Run the tool-calling loop: send messages with tool definitions to the model,
 * execute any tool calls, feed results back, repeat until the model produces
 * a final text response or we hit the max rounds.
 */
async function runToolLoop(
  messages: ToolMessage[],
  ctx: ToolContext,
  sendEvent: (event: string, data: unknown) => void,
): Promise<{ answer: string; toolUses: ToolUseInfo[] }> {
  const tools = buildToolDefinitions();
  const toolUses: ToolUseInfo[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await chatClient.chatWithTools(messages, tools);

    const toolCalls = parseToolCalls(response);

    if (toolCalls.length === 0) {
      // Model produced a final text response — we're done
      return { answer: response.content ?? "", toolUses };
    }

    // Add the assistant message with tool_calls to conversation
    messages.push({
      role: "assistant",
      content: response.content,
      tool_calls: response.tool_calls,
    });

    // Execute each tool call and add results as tool messages
    for (const tc of toolCalls) {
      const result = await executeTool(tc.name, tc.arguments, ctx);

      // Summarize result for UI transparency
      const summary = result.success
        ? summarizeToolResult(tc.name, result.data)
        : `Error: ${result.error}`;

      toolUses.push({
        name: tc.name,
        arguments: tc.arguments,
        result: { success: result.success, summary },
      });

      // Send tool use event to client for real-time transparency
      sendEvent("tool_use", {
        tool: tc.name,
        success: result.success,
        summary,
      });

      // Add tool result message for the model
      const resultContent = result.success
        ? JSON.stringify(result.data)
        : JSON.stringify({ error: result.error });

      messages.push({
        role: "tool",
        content: resultContent,
        tool_call_id: tc.id,
      });
    }
  }

  // Hit max rounds — return whatever we have
  return { answer: "I've gathered information using multiple tools. Let me summarize what I found.", toolUses };
}

/** Create a short human-readable summary of a tool result for the UI. */
function summarizeToolResult(toolName: string, data: unknown): string {
  if (!data || typeof data !== "object") return "Done";
  const d = data as Record<string, unknown>;

  switch (toolName) {
    case "search_knowledge":
      return `${d["resultCount"] ?? 0} results found`;
    case "list_sources":
      return `${d["sourceCount"] ?? 0} sources`;
    case "list_documents":
      return `${d["documentCount"] ?? 0} documents`;
    case "web_search":
      return `${d["resultCount"] ?? 0} web results`;
    case "read_url":
      return `Fetched ${d["contentLength"] ?? 0} chars${d["truncated"] ? " (truncated)" : ""}`;
    case "cite_check":
      return `${d["evidenceCount"] ?? 0} evidence items, verdict: ${d["verdict"] ?? "unknown"}`;
    case "find_related":
      return `${(d["related"] as unknown[])?.length ?? 0} related documents`;
    case "save_to_vault":
      return `Saved "${d["title"]}"`;
    case "create_source":
      return `Created "${d["name"]}"`;
    case "upload_document":
      return `Uploaded "${d["filename"]}"`;
    case "delete_document":
      return `Deleted "${d["deleted"]}"`;
    case "delete_source":
      return `Deleted "${d["deleted"]}", ${d["documentsDeleted"]} documents removed`;
    case "save_memory":
      return `Saved memory: "${(d["content"] as string)?.slice(0, 50) ?? ""}"`;
    case "list_memories":
      return `${d["count"] ?? 0} memories`;
    case "delete_memory":
      return `Deleted memory ${d["deleted"]}`;
    default:
      return "Done";
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
  // If the chat server's /health is OK, a model is loaded — no need to check /slots
  // (which can fail when the model is busy generating a response).
  const modelLoaded = await isInferenceRunning();
  res.json({ ready: true, modelLoaded });
});

queryRouter.post("/", validateBody(queryBodySchema), async (req, res) => {
  const { query, conversationId: existingConvId, private: isPrivate, messages: clientMessages, dataSourceIds, skipSearch, aiBehavior } = req.body as z.infer<typeof queryBodySchema>;

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
  // Anonymize actor when private mode is active to avoid leaking user identity
  recordAuditEvent({
    eventType: "query.execute",
    actorEmail: isPrivate ? "anonymous" : req.session.email,
    actorIp: isPrivate ? undefined : req.ip,
    details: { dsCount: dataSourceIds?.length ?? 0, hasConversation: !!existingConvId },
  });

  // Determine strict mode (admin toggle: general answers)
  const orgConfig = getIntegrationConfig();
  // Per-request overrides from user's AI behavior settings, fallback to org config
  const strict = aiBehavior?.generalAnswers !== undefined
    ? !aiBehavior.generalAnswers
    : !(orgConfig.generalAnswersEnabled ?? true);
  const useDecompose = aiBehavior?.decompose ?? orgConfig.ragDecompose ?? false;
  const useRerank = aiBehavior?.rerank ?? orgConfig.ragRerank ?? false;
  const useIterativeRetrieval = aiBehavior?.iterativeRetrieval ?? orgConfig.ragIterativeRetrieval ?? false;
  const skipRetrievalForSimpleChat = isSimpleSmallTalk(query);

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
      const shouldSkipRetrieval = skipSearch || skipRetrievalForSimpleChat;
      const datasetNames = shouldSkipRetrieval ? [] : resolveTargetDatasets(dataSourceIds, req.session.email ?? "", req.session.isAdmin ?? false, orgId);
      // Forward accessible data source IDs for server-side ACL enforcement on mesh nodes
      const accessibleDSIds = shouldSkipRetrieval ? [] : listAccessibleDataSources(req.session.email ?? "", req.session.isAdmin ?? false, orgId).map((ds) => ds.id);
      const { results: searchResults, candidateCount, hybridBoost, meshNodesSearched, meshNodesUnavailable } = shouldSkipRetrieval
        ? { results: [] as Awaited<ReturnType<typeof searchWithHybrid>>["results"], candidateCount: 0, hybridBoost: false, meshNodesSearched: 0, meshNodesUnavailable: 0 }
        : await searchWithHybrid(datasetNames, query, allowedGroupIds, accessibleDSIds);

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
        {
          datasetName: datasetNames[0]!, datasetNames, topK: 10, similarityThreshold: 0.3, candidateCount, hybridBoost, strict,
          decompose: useDecompose,
          rerank: useRerank,
          iterativeRetrieval: useIterativeRetrieval,
        },
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

  const explicitMemory = isMemoryEnabled() ? extractExplicitMemoryRequest(query) : null;
  if (explicitMemory) {
    broadcastToUser(userEmail, "bot_thinking", { chatId: conversation.id, thinking: true });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      await saveMemory({
        content: explicitMemory.content,
        category: explicitMemory.category,
        confidence: 1,
        source: "explicit",
        orgId,
        userId: userEmail,
      });

      const answer = "I'll remember that.";
      const assistantMsgId = randomUUID();
      const assistantMsg: PersistedMessage = {
        id: assistantMsgId,
        conversationId: conversation.id,
        role: "assistant",
        content: answer,
        hasConfidentAnswer: true,
        answerType: "general",
        createdAt: new Date(),
      };
      addMessage(assistantMsg);
      updateConversationTimestamp(conversation.id);

      res.write(`event: done\ndata: ${JSON.stringify({
        answer,
        citations: [],
        hasConfidentAnswer: true,
        sessionId: conversation.id,
        conversationId: conversation.id,
        messageId: assistantMsgId,
        answerType: "general",
      })}\n\n`);
    } catch (err) {
      logger.warn({ err, conversationId: conversation.id }, "Direct memory save failed");
      res.write(`event: error\ndata: ${JSON.stringify({ message: "Failed to save memory. Please try again." })}\n\n`);
    } finally {
      broadcastToUser(userEmail, "bot_thinking", { chatId: conversation.id, thinking: false });
      try { res.end(); } catch { /* already closed */ }
    }
    return;
  }

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
    if (!skipRetrievalForSimpleChat && isToolUseEnabled() && listTools().length > 0) {
      // Acquire inference slot
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

      // Build tool messages from conversation history
      const toolMessages: ToolMessage[] = [];

      // Fetch memory context (if enabled)
      const memoryBlock = await getMemoryContextBlock(query, orgId, userEmail);

      // System prompt for tool-using model
      const toolSystemPrompt = skipSearch
        ? [
            "You are a helpful AI assistant. Answer the user's question directly using your general knowledge.",
            "Do not search documents or knowledge bases — the user has chosen to chat without sources.",
            "When the user asks you to remember something, use the save_memory tool.",
            memoryBlock,
          ].filter(Boolean).join("\n\n")
        : [
            "You are a helpful AI assistant with access to tools for searching knowledge bases, managing documents, and browsing the web.",
            "Use tools when the user's question requires information from documents, the web, or data management.",
            "For simple questions that don't need tools (greetings, math, general knowledge), answer directly without calling tools.",
            strict ? "You must only answer from information found via tools — do not use general knowledge." : "",
            "Always cite your sources when using information from search results.",
            "When the user asks you to remember something, use the save_memory tool.",
            memoryBlock,
          ].filter(Boolean).join("\n\n");

      toolMessages.push({ role: "system", content: toolSystemPrompt });

      // Add conversation history
      for (const m of sessionMessages) {
        toolMessages.push({ role: m.role as "user" | "assistant", content: m.content });
      }

      const toolCtx: ToolContext = {
        userEmail: userEmail,
        isAdmin,
        orgId,
      };

      const { answer, toolUses } = await runToolLoop(toolMessages, toolCtx, sendEvent);

      // Stream the final answer character by character for progressive UI
      const CHUNK_SIZE = 20;
      for (let i = 0; i < answer.length; i += CHUNK_SIZE) {
        sendEvent("delta", { delta: answer.slice(i, i + CHUNK_SIZE) });
      }

      // Save assistant message
      const assistantMsgId = randomUUID();
      const assistantMsg: PersistedMessage = {
        id: assistantMsgId,
        conversationId: conversation.id,
        role: "assistant",
        content: answer,
        hasConfidentAnswer: true,
        answerType: toolUses.length > 0 ? "grounded" : "general",
        createdAt: new Date(),
      };
      if (toolUses.length > 0) assistantMsg.toolUses = toolUses;
      addMessage(assistantMsg);
      updateConversationTimestamp(conversation.id);

      sendEvent("done", {
        answer,
        citations: [],
        hasConfidentAnswer: true,
        sessionId: conversation.id,
        conversationId: conversation.id,
        messageId: assistantMsgId,
        answerType: toolUses.length > 0 ? "grounded" : "general",
        toolUses,
      });

      // Post-response: extract memories from user message (async, no latency impact)
      void processMessageForMemories(query, orgId, userEmail);
    } else {
      // ─── Standard RAG Pipeline (no tool use) ────────────────────────────

      const shouldSkipRetrieval = skipSearch || skipRetrievalForSimpleChat;
      if (!shouldSkipRetrieval) {
        const memoryCtxBlock = await getMemoryContextBlock(query, orgId, userEmail);
        if (memoryCtxBlock) {
          sessionMessages = [{ role: "system", content: memoryCtxBlock }, ...sessionMessages];
          session.messages = sessionMessages;
        }
      }

      const datasetNames = shouldSkipRetrieval ? [] : resolveTargetDatasets(dataSourceIds, req.session.email ?? "", req.session.isAdmin ?? false, orgId);
      const accessibleDSIdsStd = shouldSkipRetrieval ? [] : listAccessibleDataSources(req.session.email ?? "", req.session.isAdmin ?? false, orgId).map((ds) => ds.id);
      const { results: searchResults, candidateCount, hybridBoost, meshNodesSearched, meshNodesUnavailable } = shouldSkipRetrieval
        ? { results: [] as Awaited<ReturnType<typeof searchWithHybrid>>["results"], candidateCount: 0, hybridBoost: false, meshNodesSearched: 0, meshNodesUnavailable: 0 }
        : await searchWithHybrid(datasetNames, query, allowedGroupIds, accessibleDSIdsStd);

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
          decompose: useDecompose,
          rerank: useRerank,
          iterativeRetrieval: useIterativeRetrieval,
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

          // Post-response: extract memories from user message (async, no latency impact)
          void processMessageForMemories(query, orgId, userEmail);
        }
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
