import { Router } from "express";
import type { Router as IRouter, Response } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { answerStream, splitForSummary, summarizeMessages, buildSummarizedContext } from "@edgebric/core/rag";
import { createMILMClient, createMKBClient } from "@edgebric/edge";
import type { SearchResult, ChatMessage } from "@edgebric/core/rag";
import type { Session, SessionMessage, Citation } from "@edgebric/types";
import { requireOrg } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { logger } from "../lib/logger.js";
import { runtimeEdgeConfig, runtimeChatConfig } from "../config.js";
import { lookupChunk } from "../services/chunkRegistry.js";
import { getAllDocuments, getDocument } from "../services/documentStore.js";
import { listKBs } from "../services/knowledgeBaseStore.js";
import {
  getGroupChat,
  isMember,
  addMessage,
  getRecentMainMessages,
  getThreadMessages,
  getSharedDatasetNames,
  getContextSummary,
  setContextSummary,
} from "../services/groupChatStore.js";

// ─── Clients ──────────────────────────────────────────────────────────────────

const mkb = createMKBClient(runtimeEdgeConfig);
const chatEdgeConfig = {
  get baseUrl() { return runtimeChatConfig.baseUrl; },
  get apiKey() { return runtimeChatConfig.apiKey; },
  get milmModel() { return runtimeChatConfig.model; },
  embeddingModel: runtimeEdgeConfig.embeddingModel,
};
const chatClient = createMILMClient(chatEdgeConfig, "");

// ─── Schemas ──────────────────────────────────────────────────────────────────

const sendMessageSchema = z.object({
  content: z.string().min(1).max(8000),
  threadParentId: z.string().uuid().optional(),
});

// ─── SSE Connections ──────────────────────────────────────────────────────────

/** Map of groupChatId → Set of connected SSE responses */
const sseClients = new Map<string, Set<Response>>();

function broadcastToChat(groupChatId: string, event: string, data: unknown): void {
  const clients = sseClients.get(groupChatId);
  if (!clients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BOT_TAG_REGEX = /@(?:bot|edgebric)\b/i;

function containsBotTag(content: string): boolean {
  return BOT_TAG_REGEX.test(content);
}

/** Strip @bot/@edgebric from the message to get the actual query. */
function extractQuery(content: string): string {
  return content.replace(BOT_TAG_REGEX, "").trim();
}

/** Search across multiple mKB datasets, merge by similarity. */
async function multiDatasetSearch(
  datasetNames: string[],
  queryText: string,
  topK: number,
): Promise<SearchResult[]> {
  const resultSets = await Promise.all(
    datasetNames.map(async (ds) => {
      try {
        return await mkb.search(ds, queryText, topK);
      } catch {
        return [];
      }
    }),
  );

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

  allResults.sort((a, b) => b.similarity - a.similarity);
  return allResults.slice(0, topK);
}

/** Enrich citations with KB names. */
function enrichCitations(citations: Citation[]): void {
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

// ─── Router ───────────────────────────────────────────────────────────────────

export const groupChatQueryRouter: IRouter = Router();
groupChatQueryRouter.use(requireOrg);

// POST /api/group-chats/:id/send — send a message (and optionally trigger bot)
groupChatQueryRouter.post("/:id/send", validateBody(sendMessageSchema), async (req, res) => {
  const email = req.session.email!;
  const chatId = req.params["id"] as string;
  const { content, threadParentId } = req.body as z.infer<typeof sendMessageSchema>;

  // Validate membership and chat status
  const chat = getGroupChat(chatId);
  if (!chat) {
    res.status(404).json({ error: "Group chat not found" });
    return;
  }
  if (!isMember(chatId, email)) {
    res.status(403).json({ error: "You are not a member of this group chat" });
    return;
  }
  if (chat.status !== "active") {
    res.status(409).json({ error: "This group chat is no longer active" });
    return;
  }

  // Persist user message
  const msgOpts: Parameters<typeof addMessage>[0] = {
    groupChatId: chatId,
    authorEmail: email,
    role: "user",
    content,
  };
  if (threadParentId) msgOpts.threadParentId = threadParentId;
  if (req.session.name) msgOpts.authorName = req.session.name;
  const userMsg = addMessage(msgOpts);

  // Broadcast to connected clients
  broadcastToChat(chatId, "message", userMsg);

  // If no @bot tag, just return the persisted message
  if (!containsBotTag(content)) {
    res.json(userMsg);
    return;
  }

  // ─── Bot response via SSE ───────────────────────────────────────────────────

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Emit the user message first so the client can render it immediately
  sendEvent("user_message", userMsg);

  try {
    const query = extractQuery(content);

    // Resolve datasets from shared KBs
    const datasetNames = getSharedDatasetNames(chatId);
    if (datasetNames.length === 0) {
      // No KBs shared — bot can't answer
      const botMsg = addMessage({
        groupChatId: chatId,
        role: "assistant",
        content: "No sources have been shared in this group chat yet. Share a source so I can help answer questions.",
      });
      sendEvent("done", botMsg);
      broadcastToChat(chatId, "message", botMsg);
      res.end();
      return;
    }

    // Build context from recent messages, with summarization for long conversations
    let contextMessages: ReturnType<typeof getRecentMainMessages>;
    if (threadParentId) {
      contextMessages = getThreadMessages(threadParentId);
    } else {
      contextMessages = getRecentMainMessages(chatId, 40);
    }

    // Convert to ChatMessage format for summarizer
    const chatMsgs: ChatMessage[] = contextMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const cm: ChatMessage = { role: m.role as "user" | "assistant", content: m.content };
        if (m.authorName) cm.authorName = m.authorName;
        return cm;
      });

    // Split into old (to summarize) and recent (keep verbatim)
    const { old, recent } = splitForSummary(chatMsgs, 3000);

    // Get or generate summary for old messages
    let summary = "";
    if (old.length > 0) {
      const cached = getContextSummary(chatId);
      if (cached) {
        summary = cached.summary;
      } else {
        try {
          summary = await summarizeMessages(old, (msgs) => chatClient.chatStream(msgs));
          if (summary && contextMessages.length > 0) {
            setContextSummary(chatId, summary, contextMessages[contextMessages.length - 1]!.id);
          }
        } catch (err) {
          logger.warn({ err }, "Context summarization failed, using recent messages only");
        }
      }
    }

    // Build session messages from summarized context
    const summarizedContext = buildSummarizedContext(summary, recent);
    const sessionMessages: SessionMessage[] = summarizedContext
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-10)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    sessionMessages.push({ role: "user", content: query });

    const session: Session = {
      id: chatId,
      createdAt: chat.createdAt,
      messages: sessionMessages,
    };

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
        enrichCitations(chunk.final.citations);

        // Persist bot message
        const botMsgOpts: Parameters<typeof addMessage>[0] = {
          groupChatId: chatId,
          role: "assistant",
          content: chunk.final.answer,
          hasConfidentAnswer: chunk.final.hasConfidentAnswer,
        };
        if (threadParentId) botMsgOpts.threadParentId = threadParentId;
        if (chunk.final.citations.length > 0) botMsgOpts.citations = chunk.final.citations;
        const botMsg = addMessage(botMsgOpts);

        sendEvent("done", botMsg);
        broadcastToChat(chatId, "message", botMsg);
      }
    }
  } catch (err) {
    sendEvent("error", { message: "An error occurred. Please try again." });
    logger.error({ err }, "Group chat query error");
  } finally {
    res.end();
  }
});

// GET /api/group-chats/:id/stream — SSE stream for real-time updates
groupChatQueryRouter.get("/:id/stream", (req, res) => {
  const email = req.session.email!;
  const chatId = req.params["id"] as string;

  const chat = getGroupChat(chatId);
  if (!chat) {
    res.status(404).json({ error: "Group chat not found" });
    return;
  }
  if (!isMember(chatId, email)) {
    res.status(403).json({ error: "You are not a member of this group chat" });
    return;
  }

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Register this client
  if (!sseClients.has(chatId)) {
    sseClients.set(chatId, new Set());
  }
  sseClients.get(chatId)!.add(res);

  // Send initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ chatId })}\n\n`);

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(":heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 30_000);

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    const clients = sseClients.get(chatId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) sseClients.delete(chatId);
    }
  });
});
