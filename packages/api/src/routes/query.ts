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
import { listTargets } from "../services/escalationTargetStore.js";
import { listKBs, listAccessibleKBs } from "../services/knowledgeBaseStore.js";
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

/** Enrich citations with the knowledge base name based on document → KB lookup. */
function enrichCitationsWithKBName(citations: Citation[]): void {
  if (citations.length === 0) return;
  const kbs = listKBs({ type: "organization" });
  const kbMap = new Map(kbs.map((kb) => [kb.id, kb.name]));
  for (const citation of citations) {
    const doc = getDocument(citation.documentId);
    if (doc?.knowledgeBaseId) {
      const name = kbMap.get(doc.knowledgeBaseId);
      if (name) citation.knowledgeBaseName = name;
    }
  }
}

/** Get dataset names accessible to a user. Falls back to legacy "knowledge-base" if no KBs exist. */
function getAccessibleDatasetNames(email: string, isAdmin: boolean, orgId?: string): string[] {
  const kbs = listAccessibleKBs(email, isAdmin, orgId);
  if (kbs.length === 0) return ["knowledge-base"];
  return kbs.map((kb) => kb.datasetName);
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

  // Flatten and enrich
  const allResults = resultSets.flat().map((r) => {
    const stored = lookupChunk(r.chunkId);
    if (stored) return { ...r, metadata: stored };
    const meta = r.metadata;
    if (!meta.documentName && !meta.sourceDocument) {
      const firstDoc = getAllDocuments().find((d) => d.status === "ready");
      if (firstDoc) meta.documentName = firstDoc.name;
    }
    return r;
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
  const { query, conversationId: existingConvId, private: isPrivate, messages: clientMessages } = req.body as z.infer<typeof queryBodySchema>;

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

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const orgId = req.session.orgId;
      const targetNames = listTargets(orgId).map((t) => t.name);
      const datasetNames = getAccessibleDatasetNames(req.session.email ?? "", req.session.isAdmin ?? false, orgId);
      const stream = answerStream(
        query,
        session,
        { datasetName: datasetNames[0]!, datasetNames, topK: 3, similarityThreshold: 0.3, escalationTargetNames: targetNames },
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
      res.end();
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

  // Set up SSE streaming
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const targetNames = listTargets(orgId).map((t) => t.name);
    const datasetNames = getAccessibleDatasetNames(req.session.email ?? "", req.session.isAdmin ?? false, orgId);
    const stream = answerStream(
      query,
      session,
      {
        datasetName: datasetNames[0]!,
        datasetNames,
        topK: 3,
        similarityThreshold: 0.3,
        escalationTargetNames: targetNames,
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
    res.end();
  }
});
