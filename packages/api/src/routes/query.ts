import { Router } from "express";
import type { Router as IRouter } from "express";
import { answerStream, filterQuery } from "@edgebric/core/rag";
import { createMILMClient, createMKBClient } from "@edgebric/edge";
import type { SearchResult } from "@edgebric/core/rag";
import { requireAuth } from "../middleware/auth.js";
import { runtimeEdgeConfig, runtimeChatConfig } from "../config.js";
import { lookupChunk } from "../services/chunkRegistry.js";
import { getAllDocuments } from "../services/documentStore.js";
import {
  createConversation,
  getConversation,
  getMessages,
  addMessage,
  updateConversationTimestamp,
} from "../services/conversationStore.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import type { Session, SessionMessage, PersistedMessage } from "@edgebric/types";
import { randomUUID } from "crypto";

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

queryRouter.use(requireAuth);

// Returns whether the system has at least one ready document to query against.
queryRouter.get("/status", (_req, res) => {
  const hasDocuments = getAllDocuments().some((d) => d.status === "ready");
  res.json({ ready: hasDocuments });
});

queryRouter.post("/", async (req, res) => {
  const { query, conversationId: existingConvId } = req.body as {
    query?: string;
    conversationId?: string;
    private?: boolean;
    messages?: Array<{ role: "user" | "assistant"; content: string }>;
  };
  const isPrivate = !!(req.body as { private?: boolean }).private;
  const clientMessages = (req.body as { messages?: Array<{ role: "user" | "assistant"; content: string }> }).messages;

  if (!query?.trim()) {
    res.status(400).json({ error: "query is required" });
    return;
  }

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
      const stream = answerStream(
        query,
        session,
        { datasetName: "knowledge-base", topK: 3, similarityThreshold: 0.3 },
        {
          search: async (queryText, topK): Promise<SearchResult[]> => {
            const raw = await mkb.search("knowledge-base", queryText, topK);
            return raw.map((r) => {
              const stored = lookupChunk(r.chunkId);
              if (stored) return { ...r, metadata: stored };
              const meta = r.metadata;
              if (!meta.documentName && !meta.sourceDocument) {
                const firstDoc = getAllDocuments().find((d) => d.status === "ready");
                if (firstDoc) meta.documentName = firstDoc.name;
              }
              return r;
            });
          },
          generate: (messages) => chatClient.chatStream(messages),
        },
      );

      for await (const chunk of stream) {
        if (chunk.delta) sendEvent("delta", { delta: chunk.delta });
        if (chunk.final) {
          // No DB writes — just send the final response
          sendEvent("done", { ...chunk.final, private: true });
        }
      }
    } catch (err) {
      sendEvent("error", { message: "An error occurred. Please try again." });
      console.error("Private query error:", err);
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
  let conversation = existingConvId ? getConversation(existingConvId) : undefined;
  if (!conversation) {
    conversation = createConversation(userEmail, userName);
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
    const stream = answerStream(
      query,
      session,
      {
        datasetName: "knowledge-base",
        topK: 3,
        similarityThreshold: 0.3,
      },
      {
        search: async (queryText, topK): Promise<SearchResult[]> => {
          const raw = await mkb.search("knowledge-base", queryText, topK);
          // Enrich results with chunk metadata from our registry
          // (mKB v1.3.0 doesn't persist chunk metadata)
          return raw.map((r) => {
            const stored = lookupChunk(r.chunkId);
            if (stored) return { ...r, metadata: stored };
            // Fallback for chunks not in registry (e.g. old test data):
            // try to get a reasonable documentName from the metadata mKB returned
            const meta = r.metadata;
            if (!meta.documentName && !meta.sourceDocument) {
              // Best effort: use the first ready document's name
              const firstDoc = getAllDocuments().find((d) => d.status === "ready");
              if (firstDoc) meta.documentName = firstDoc.name;
            }
            return r;
          });
        },
        generate: (messages) => chatClient.chatStream(messages),
      },
    );

    for await (const chunk of stream) {
      if (chunk.delta) {
        sendEvent("delta", { delta: chunk.delta });
      }
      if (chunk.final) {
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
    console.error("Query error:", err);
  } finally {
    res.end();
  }
});
