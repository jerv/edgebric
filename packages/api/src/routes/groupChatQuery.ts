import { Router } from "express";
import type { Router as IRouter, Response } from "express";
import { z } from "zod";
import { answerStream, splitForSummary, summarizeMessages, buildSummarizedContext } from "@edgebric/core/rag";
import { createMILMClient, createMKBClient } from "@edgebric/edge";
import type { ChatMessage } from "@edgebric/core/rag";
import type { Session, SessionMessage, Citation } from "@edgebric/types";
import { requireOrg } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { logger } from "../lib/logger.js";
import { acquireSlot, QueueFullError } from "../services/inferenceQueue.js";
import { runtimeEdgeConfig, runtimeChatConfig } from "../config.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import { getDocument } from "../services/documentStore.js";
import { listDataSources } from "../services/dataSourceStore.js";
import { hybridMultiDatasetSearch } from "../services/searchService.js";
import { rerank, isRerankerAvailable } from "../services/reranker.js";
import {
  getGroupChat,
  isMember,
  addMessage,
  getRecentMainMessages,
  getThreadMessages,
  getSharedDatasetNames,
  getContextSummary,
  setContextSummary,
  getMembers,
} from "../services/groupChatStore.js";
import {
  broadcastToUser,
  getGroupChatNotifLevel,
} from "../services/notificationStore.js";

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

export function broadcastToChat(groupChatId: string, event: string, data: unknown): void {
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

// ─── Rate Limiting ───────────────────────────────────────────────────────────

/** Sliding-window rate limiter for bot queries: 10 per user per group chat per minute. */
const BOT_RATE_LIMIT = 10;
const BOT_RATE_WINDOW_MS = 60_000;

/** Map<"email:chatId" → timestamp[]> */
const botQueryTimestamps = new Map<string, number[]>();

/** Prune stale entries every 5 minutes to prevent memory leak. */
setInterval(() => {
  const cutoff = Date.now() - BOT_RATE_WINDOW_MS;
  for (const [key, timestamps] of botQueryTimestamps) {
    const fresh = timestamps.filter((t) => t > cutoff);
    if (fresh.length === 0) botQueryTimestamps.delete(key);
    else botQueryTimestamps.set(key, fresh);
  }
}, 5 * 60_000).unref();

function checkBotRateLimit(email: string, chatId: string): { allowed: boolean; retryAfterMs?: number } {
  const key = `${email}:${chatId}`;
  const now = Date.now();
  const cutoff = now - BOT_RATE_WINDOW_MS;

  const timestamps = (botQueryTimestamps.get(key) ?? []).filter((t) => t > cutoff);

  if (timestamps.length >= BOT_RATE_LIMIT) {
    const oldestInWindow = timestamps[0]!;
    return { allowed: false, retryAfterMs: oldestInWindow + BOT_RATE_WINDOW_MS - now };
  }

  timestamps.push(now);
  botQueryTimestamps.set(key, timestamps);
  return { allowed: true };
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

/** Parse @mentions from message content. Returns set of mentioned member emails. */
function parseMentions(content: string, members: { userEmail: string; userName?: string }[]): Set<string> {
  const mentioned = new Set<string>();
  // Match @FirstName or @"First Last" or @First Last (greedy first+last)
  const mentionRegex = /@"([^"]+)"|@(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(content)) !== null) {
    const name = (match[1] ?? match[2] ?? "").toLowerCase();
    if (name === "bot" || name === "edgebric") continue;
    for (const m of members) {
      const memberName = (m.userName ?? "").toLowerCase();
      const firstName = memberName.split(/\s+/)[0] ?? "";
      if (memberName === name || firstName === name || m.userEmail.toLowerCase().startsWith(name + "@")) {
        mentioned.add(m.userEmail);
      }
    }
  }
  return mentioned;
}

/** Enrich citations with data source names and freshness. */
function enrichCitations(citations: Citation[]): void {
  if (citations.length === 0) return;
  const dataSources = listDataSources({ type: "organization" });
  const dsMap = new Map(dataSources.map((ds) => [ds.id, ds]));
  for (const citation of citations) {
    const doc = getDocument(citation.documentId);
    if (doc) {
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

  // Rate-limit bot queries (non-bot messages pass through freely)
  if (containsBotTag(content)) {
    const rateCheck = checkBotRateLimit(email, chatId);
    if (!rateCheck.allowed) {
      const retrySec = Math.ceil((rateCheck.retryAfterMs ?? BOT_RATE_WINDOW_MS) / 1000);
      res.status(429).json({
        error: `Rate limit exceeded. You can send ${BOT_RATE_LIMIT} @bot queries per minute in this chat. Try again in ${retrySec}s.`,
      });
      return;
    }
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

  // Notify other members via global SSE (for sidebar badges, sounds, etc.)
  const members = getMembers(chatId);
  const mentionedEmails = parseMentions(content, members);
  for (const member of members) {
    if (member.userEmail === email) continue; // don't notify sender
    const level = getGroupChatNotifLevel(chatId, member.userEmail);
    const isMentioned = mentionedEmails.has(member.userEmail);

    if (level === "none" && !isMentioned) continue;
    if (level === "mentions" && !isMentioned) {
      // Still send unread badge update but no notification
      broadcastToUser(member.userEmail, "unread", { groupChatId: chatId });
      continue;
    }

    broadcastToUser(member.userEmail, "unread", { groupChatId: chatId });
    if (isMentioned) {
      broadcastToUser(member.userEmail, "mention", {
        groupChatId: chatId,
        chatName: chat.name,
        authorName: req.session.name ?? email,
        preview: content.slice(0, 100),
      });
    }
  }

  // If no @bot tag, just return the persisted message
  if (!containsBotTag(content)) {
    res.json(userMsg);
    return;
  }

  // Broadcast bot-thinking status to all members (both per-chat and global SSE)
  broadcastToChat(chatId, "bot_thinking", { chatId, thinking: true });
  for (const member of members) {
    broadcastToUser(member.userEmail, "bot_thinking", { chatId, thinking: true });
  }

  // ─── Bot response via SSE ───────────────────────────────────────────────────

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

  // Emit the user message first so the client can render it immediately
  sendEvent("user_message", userMsg);

  try {
    const query = extractQuery(content);
    const gcOrgConfig = getIntegrationConfig();
    const strict = !(gcOrgConfig.generalAnswersEnabled ?? true);

    // Resolve datasets from shared data sources
    const datasetNames = getSharedDatasetNames(chatId);
    if (datasetNames.length === 0) {
      // No data sources shared — bot can't answer
      const botMsg = addMessage({
        groupChatId: chatId,
        role: "assistant",
        content: "No data sources have been shared in this group chat yet. Share a data source so I can help answer questions.",
      });
      sendEvent("done", botMsg);
      broadcastToChat(chatId, "message", botMsg);
      res.end();
      return;
    }

    // Build context from recent messages, with summarization for long conversations
    let contextMessages: ReturnType<typeof getRecentMainMessages>;
    let mainChatSummary = "";

    if (threadParentId) {
      // Thread context: parent message + all replies (with summarization if long)
      contextMessages = getThreadMessages(threadParentId);

      // Also inject a summary of recent main chat so the bot has broader awareness
      // (e.g., if someone says "which ones?" in a thread, the bot needs main chat context)
      const mainChatMessages = getRecentMainMessages(chatId, 20);
      if (mainChatMessages.length > 0) {
        const mainChatMsgs: ChatMessage[] = mainChatMessages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => {
            const cm: ChatMessage = { role: m.role as "user" | "assistant", content: m.content };
            if (m.authorName) cm.authorName = m.authorName;
            return cm;
          });

        // Use cached main chat summary if available, otherwise generate one
        const cached = getContextSummary(chatId);
        if (cached) {
          mainChatSummary = cached.summary;
        } else if (mainChatMsgs.length > 3) {
          try {
            mainChatSummary = await summarizeMessages(mainChatMsgs, (msgs) => chatClient.chatStream(msgs));
            if (mainChatSummary) {
              setContextSummary(chatId, mainChatSummary, mainChatMessages[mainChatMessages.length - 1]!.id);
            }
          } catch (err) {
            logger.warn({ err }, "Main chat summarization for thread context failed");
          }
        }
      }
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
      const cached = threadParentId ? null : getContextSummary(chatId); // Don't reuse main chat cache for threads
      if (cached) {
        summary = cached.summary;
      } else {
        try {
          summary = await summarizeMessages(old, (msgs) => chatClient.chatStream(msgs));
          if (summary && contextMessages.length > 0 && !threadParentId) {
            setContextSummary(chatId, summary, contextMessages[contextMessages.length - 1]!.id);
          }
        } catch (err) {
          logger.warn({ err }, "Context summarization failed, using recent messages only");
        }
      }
    }

    // For threads, prepend main chat awareness as additional summary context
    const combinedSummary = threadParentId && mainChatSummary
      ? `Recent main chat context:\n${mainChatSummary}\n\n${summary ? `Thread conversation summary:\n${summary}` : ""}`
      : summary;

    // Build session messages from summarized context
    const summarizedContext = buildSummarizedContext(combinedSummary, recent);
    const sessionMessages: SessionMessage[] = summarizedContext
      .slice(-12)
      .map((m) => ({ role: m.role as SessionMessage["role"], content: m.content }));
    sessionMessages.push({ role: "user", content: query });

    const session: Session = {
      id: chatId,
      createdAt: chat.createdAt,
      messages: sessionMessages,
    };

    // Hybrid BM25+vector search with optional reranking
    const { results: searchResults, candidateCount, hybridBoost } = await hybridMultiDatasetSearch(
      mkb,
      datasetNames,
      query,
      20,
    );

    // Optional cross-encoder reranking
    if (isRerankerAvailable() && searchResults.length > 1) {
      const reranked = await rerank(
        query,
        searchResults.map((r) => ({
          chunkId: r.chunkId,
          text: r.chunk,
          originalScore: r.similarity,
        })),
      );
      const rerankedMap = new Map(reranked.map((r) => [r.chunkId, r.rerankerScore]));
      searchResults.sort((a, b) => (rerankedMap.get(b.chunkId) ?? 0) - (rerankedMap.get(a.chunkId) ?? 0));
    }

    // Acquire inference slot — waits if all slots busy
    const abortController = new AbortController();
    req.on("close", () => abortController.abort());
    let releaseSlotFn: (() => void) | undefined;
    try {
      releaseSlotFn = await acquireSlot(
        chatId,
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

    try {
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
          enrichCitations(chunk.final.citations);

          // Persist bot message
          const botMsgOpts: Parameters<typeof addMessage>[0] = {
            groupChatId: chatId,
            role: "assistant",
            content: chunk.final.answer,
            hasConfidentAnswer: chunk.final.hasConfidentAnswer,
            ...(chunk.final.answerType != null && { answerType: chunk.final.answerType }),
          };
          if (threadParentId) botMsgOpts.threadParentId = threadParentId;
          if (chunk.final.citations.length > 0) botMsgOpts.citations = chunk.final.citations;
          const botMsg = addMessage(botMsgOpts);

          sendEvent("done", { ...botMsg, contextUsage: chunk.final.contextUsage });
          broadcastToChat(chatId, "message", botMsg);
        }
      }
    } finally {
      releaseSlotFn?.();
    }
  } catch (err) {
    sendEvent("error", { message: "An error occurred. Please try again." });
    logger.error({ err }, "Group chat query error");
  } finally {
    broadcastToChat(chatId, "bot_thinking", { chatId, thinking: false });
    // Notify all members via global SSE (thinking off + unread badges)
    for (const member of members) {
      broadcastToUser(member.userEmail, "bot_thinking", { chatId, thinking: false });
      if (member.userEmail === email) continue;
      broadcastToUser(member.userEmail, "unread", { groupChatId: chatId });
    }
    try { res.end(); } catch { /* already closed */ }
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
