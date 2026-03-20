import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { answerStream, filterQuery } from "@edgebric/core/rag";
import { createMILMClient, createMKBClient } from "@edgebric/edge";
import type { SearchResult } from "@edgebric/core/rag";
import { requireOrg } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { logger } from "../lib/logger.js";
import { runtimeEdgeConfig, runtimeChatConfig } from "../config.js";
import { lookupChunk } from "../services/chunkRegistry.js";
import { getAllDocuments, getDocument, getDocumentsByOrg } from "../services/documentStore.js";
import {
  createConversation,
  getConversation,
  getMessages,
  addMessage,
  updateConversationTimestamp,
} from "../services/conversationStore.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import { listKBs, listAccessibleKBs } from "../services/knowledgeBaseStore.js";
import { broadcastToUser } from "../services/notificationStore.js";
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
  /** Optional KB IDs to restrict search scope. Omit for default (all accessible org KBs). */
  knowledgeBaseIds: z.array(z.string().uuid()).max(20).optional(),
});

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

/** Enrich citations with the knowledge base name, ID, and avatar based on document → KB lookup. */
function enrichCitationsWithKBName(citations: Citation[]): void {
  if (citations.length === 0) return;
  const kbs = listKBs({ type: "organization" });
  const kbMap = new Map(kbs.map((kb) => [kb.id, kb]));
  for (const citation of citations) {
    const doc = getDocument(citation.documentId);
    if (doc?.knowledgeBaseId) {
      const kb = kbMap.get(doc.knowledgeBaseId);
      if (kb) {
        citation.knowledgeBaseName = kb.name;
        citation.knowledgeBaseId = kb.id;
        if (kb.avatarUrl) citation.knowledgeBaseAvatarUrl = kb.avatarUrl;
      }
    }
  }
}

/**
 * Resolve target dataset names from client-provided KB IDs.
 * Always intersects with the user's accessible set (security: prevents unauthorized KB access).
 * Falls back to all accessible datasets if no IDs provided.
 */
function resolveTargetDatasets(
  requestedKBIds: string[] | undefined,
  email: string,
  isAdmin: boolean,
  orgId?: string,
): string[] {
  const accessibleKBs = listAccessibleKBs(email, isAdmin, orgId);
  if (accessibleKBs.length === 0) return ["knowledge-base"];

  // No filter requested — search all accessible KBs (default behavior)
  if (!requestedKBIds || requestedKBIds.length === 0) {
    return accessibleKBs.map((kb) => kb.datasetName);
  }

  // Intersect requested IDs with accessible set
  const requestedSet = new Set(requestedKBIds);
  const filtered = accessibleKBs.filter((kb) => requestedSet.has(kb.id));

  // If intersection is empty (user requested KBs they can't access), return empty
  // This will produce a "no results" response rather than silently searching everything
  if (filtered.length === 0) return [];

  return filtered.map((kb) => kb.datasetName);
}

/**
 * Search across multiple mKB datasets, merge results by similarity score,
 * and enrich with chunk metadata from our registry.
 */
async function multiDatasetSearch(
  datasetNames: string[],
  queryText: string,
  topK: number,
): Promise<SearchResult[]> {
  // Fan out to all datasets in parallel
  const resultSets = await Promise.all(
    datasetNames.map(async (ds) => {
      try {
        return await mkb.search(ds, queryText, topK);
      } catch {
        // Dataset may not exist yet or be empty — don't fail the whole query
        return [];
      }
    }),
  );

  // Flatten, enrich, and filter out orphaned chunks (deleted documents)
  const allResults = resultSets.flat().flatMap((r) => {
    const stored = lookupChunk(r.chunkId);
    if (stored) return [{ ...r, metadata: stored }];
    // No registry entry → chunk belongs to a deleted document; skip it
    return [];
  });

  // Sort by similarity (descending) and take top-K
  allResults.sort((a, b) => b.similarity - a.similarity);
  return allResults.slice(0, topK);
}

// Returns whether the system has at least one ready document to query against.
queryRouter.get("/status", (req, res) => {
  const docs = req.session.orgId ? getDocumentsByOrg(req.session.orgId) : getAllDocuments();
  const hasDocuments = docs.some((d) => d.status === "ready");
  res.json({ ready: hasDocuments });
});

queryRouter.post("/", validateBody(queryBodySchema), async (req, res) => {
  const { query, conversationId: existingConvId, private: isPrivate, messages: clientMessages, knowledgeBaseIds } = req.body as z.infer<typeof queryBodySchema>;

  const filterResult = filterQuery(query);
  if (!filterResult.allowed) {
    res.status(200).json({ blocked: true, message: filterResult.redirectMessage });
    return;
  }

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
      const datasetNames = resolveTargetDatasets(knowledgeBaseIds, req.session.email ?? "", req.session.isAdmin ?? false, orgId);
      const stream = answerStream(
        query,
        session,
        { datasetName: datasetNames[0]!, datasetNames, topK: 3, similarityThreshold: 0.3 },
        {
          search: (queryText, topK) => multiDatasetSearch(datasetNames, queryText, topK),
          generate: (messages) => chatClient.chatStream(messages),
        },
      );

      for await (const chunk of stream) {
        if (chunk.delta) sendEvent("delta", { delta: chunk.delta });
        if (chunk.final) {
          enrichCitationsWithKBName(chunk.final.citations);
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
    const datasetNames = resolveTargetDatasets(knowledgeBaseIds, req.session.email ?? "", req.session.isAdmin ?? false, orgId);
    const stream = answerStream(
      query,
      session,
      {
        datasetName: datasetNames[0]!,
        datasetNames,
        topK: 3,
        similarityThreshold: 0.3,
      },
      {
        search: (queryText, topK) => multiDatasetSearch(datasetNames, queryText, topK),
        generate: (messages) => chatClient.chatStream(messages),
      },
    );

    for await (const chunk of stream) {
      if (chunk.delta) {
        sendEvent("delta", { delta: chunk.delta });
      }
      if (chunk.final) {
        enrichCitationsWithKBName(chunk.final.citations);

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
