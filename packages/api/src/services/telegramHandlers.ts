/**
 * Telegram Command Handlers — processes bot commands and text messages.
 *
 * Routes through Edgebric's existing chat/query pipeline.
 * Vault mode data sources are never sent through Telegram.
 */
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";
import { config } from "../config.js";
import { sendMessage, sendTypingAction, getFile, downloadFile } from "./telegramBot.js";
import type { TelegramMessage } from "./telegramBot.js";
import { getLinkedUserId, verifyLinkCode, requiresLinking } from "./telegramLinking.js";
import { getUser, getUserByEmail } from "./userStore.js";
import { listAccessibleDataSources, listDataSources } from "./dataSourceStore.js";
import { getIntegrationConfig } from "./integrationConfigStore.js";
import { recordAuditEvent } from "./auditLog.js";
import { answer } from "@edgebric/core/rag";
import type { Session, SessionMessage } from "@edgebric/types";
import { createChatClient } from "./chatClient.js";
import { routedSearch } from "./queryRouter.js";
import {
  createConversation,
  getConversation,
  addMessage,
  getMessages,
  updateConversationTimestamp,
} from "./conversationStore.js";
import type { PersistedMessage } from "@edgebric/types";
import { isRunning as isInferenceRunning, listRunning as listRunningModels } from "./inferenceClient.js";
import { acquireSlot, QueueFullError } from "./inferenceQueue.js";

const chatClient = createChatClient();

// ─── Per-chat conversation tracking ────────────────────────────────────────
// Maps Telegram chatId → Edgebric conversationId for continuity.
const telegramConversations = new Map<number, string>();

// ─── Helpers ───────────────────────────────────────────────────────────────

interface ResolvedUser {
  email: string;
  userId: string;
  isAdmin: boolean;
  orgId: string;
}

/**
 * Resolve a Telegram user to an Edgebric user.
 * In solo mode, always returns the solo user.
 * In org mode, requires a linked account.
 */
function resolveUser(telegramUserId: number): ResolvedUser | null {
  if (config.authMode === "none") {
    // Solo mode — use the solo user
    return {
      email: "solo@localhost",
      userId: "solo",
      isAdmin: true,
      orgId: "solo",
    };
  }

  // Org mode — look up linked user
  const edgebricUserId = getLinkedUserId(String(telegramUserId));
  if (!edgebricUserId) return null;

  const user = getUser(edgebricUserId);
  if (!user) return null;

  return {
    email: user.email,
    userId: user.id,
    isAdmin: user.role === "owner" || user.role === "admin",
    orgId: user.orgId,
  };
}

/**
 * Filter out vault-mode data sources. Returns accessible non-vault sources
 * and whether any vault sources were skipped.
 */
function filterVaultSources(
  email: string,
  isAdmin: boolean,
  orgId: string,
): { datasetNames: string[]; vaultSkipped: boolean } {
  const accessible = listAccessibleDataSources(email, isAdmin, orgId);
  const vaultConfig = getIntegrationConfig();
  const vaultEnabled = vaultConfig.vaultModeEnabled ?? false;

  // Filter out personal/vault sources — those should never go through Telegram
  const nonVault = accessible.filter((ds) => ds.type !== "personal");

  // Also filter out sources with allowExternalAccess=false
  // (since Telegram is an external channel)
  // Note: allowExternalAccess is stored as boolean after rowToDataSource conversion
  const filtered = nonVault;

  const vaultSkipped = accessible.length > filtered.length;

  if (filtered.length === 0) {
    return { datasetNames: ["knowledge-base"], vaultSkipped };
  }

  return {
    datasetNames: filtered.map((ds) => ds.datasetName),
    vaultSkipped,
  };
}

// ─── Command Handlers ──────────────────────────────────────────────────────

export async function handleCommand(
  message: TelegramMessage,
  command: string,
  args: string,
): Promise<void> {
  const chatId = message.chat.id;
  const telegramUserId = message.from?.id;

  switch (command) {
    case "start":
      await handleStart(chatId);
      break;
    case "help":
      await handleHelp(chatId);
      break;
    case "ask":
      if (!args) {
        await sendMessage(chatId, "Usage: /ask <your question>\n\nOr just send a message directly.");
        return;
      }
      await handleTextQuery(chatId, args, telegramUserId);
      break;
    case "sources":
      await handleSources(chatId, telegramUserId);
      break;
    case "status":
      await handleStatus(chatId);
      break;
    case "link":
      await handleLink(chatId, args, telegramUserId, message.from?.username);
      break;
    default:
      await sendMessage(chatId, `Unknown command: /${command}\n\nSend /help for available commands.`);
  }
}

async function handleStart(chatId: number): Promise<void> {
  const lines = [
    "Welcome to Edgebric!",
    "",
    "I can answer questions using your organization's knowledge base.",
    "",
    "Just send me a message with your question, or use /ask <question>.",
    "",
    "PRIVACY NOTE: Messages sent through this bot transit Telegram's servers. " +
    "For fully private operation, use the Edgebric app directly. " +
    "Vault mode data sources are never accessible through Telegram.",
  ];

  if (requiresLinking()) {
    lines.push(
      "",
      "To get started, link your Edgebric account:",
      "1. Open the Edgebric app",
      "2. Go to Account settings",
      "3. Click 'Link Telegram Account' to get a code",
      "4. Send /link <code> here",
    );
  }

  await sendMessage(chatId, lines.join("\n"));
}

async function handleHelp(chatId: number): Promise<void> {
  const lines = [
    "Available commands:",
    "",
    "/ask <question> — Ask a question",
    "/sources — List available data sources",
    "/status — Server health info",
    "/help — Show this help",
  ];

  if (requiresLinking()) {
    lines.push("/link <code> — Link your Telegram account to Edgebric");
  }

  lines.push("", "You can also just send a message directly to ask a question.");

  await sendMessage(chatId, lines.join("\n"));
}

async function handleLink(
  chatId: number,
  code: string,
  telegramUserId: number | undefined,
  telegramUsername: string | undefined,
): Promise<void> {
  if (!requiresLinking()) {
    await sendMessage(chatId, "Account linking is not needed in solo mode. Just send your question!");
    return;
  }

  if (!telegramUserId) {
    await sendMessage(chatId, "Could not identify your Telegram account.");
    return;
  }

  if (!code.trim()) {
    await sendMessage(chatId,
      "Usage: /link <code>\n\n" +
      "To get a link code:\n" +
      "1. Open the Edgebric app\n" +
      "2. Go to Account settings\n" +
      "3. Click 'Link Telegram Account'"
    );
    return;
  }

  const result = verifyLinkCode(String(telegramUserId), code.trim(), telegramUsername);

  if (result.success) {
    const user = getUser(result.userId);
    recordAuditEvent({
      eventType: "telegram.link",
      actorEmail: user?.email,
      details: { telegramUserId, telegramUsername },
    });
    await sendMessage(chatId,
      `Account linked successfully! You're connected as ${user?.name ?? user?.email ?? "unknown"}.\n\nSend me a question to get started.`
    );
  } else {
    await sendMessage(chatId, result.error);
  }
}

async function handleSources(chatId: number, telegramUserId: number | undefined): Promise<void> {
  if (!telegramUserId) {
    await sendMessage(chatId, "Could not identify your account.");
    return;
  }

  const user = resolveUser(telegramUserId);
  if (!user) {
    await sendUnlinkedMessage(chatId);
    return;
  }

  const accessible = listAccessibleDataSources(user.email, user.isAdmin, user.orgId);
  // Filter out personal/vault sources
  const visible = accessible.filter((ds) => ds.type !== "personal");

  if (visible.length === 0) {
    await sendMessage(chatId, "No data sources are available.");
    return;
  }

  const lines = ["Available data sources:", ""];
  for (const ds of visible) {
    const docCount = ds.documentCount;
    lines.push(`- ${ds.name} (${docCount} document${docCount !== 1 ? "s" : ""})`);
    if (ds.description) lines.push(`  ${ds.description}`);
  }

  await sendMessage(chatId, lines.join("\n"));
}

async function handleStatus(chatId: number): Promise<void> {
  let inferenceStatus = "unavailable";
  let modelName = "none";

  try {
    const running = await isInferenceRunning();
    if (running) {
      inferenceStatus = "running";
      const models = await listRunningModels();
      if (models.size > 0) {
        modelName = [...models].join(", ");
      }
    }
  } catch {
    // Leave as unavailable
  }

  const orgSources = listDataSources({ type: "organization" });
  const totalDocs = orgSources.reduce((sum, ds) => sum + ds.documentCount, 0);

  const lines = [
    "Edgebric Status:",
    "",
    `AI Engine: ${inferenceStatus}`,
    `Model: ${modelName}`,
    `Data Sources: ${orgSources.length}`,
    `Documents: ${totalDocs}`,
  ];

  await sendMessage(chatId, lines.join("\n"));
}

// ─── Text Query Handler ───────────────────────────────────────────────────

export async function handleTextQuery(
  chatId: number,
  text: string,
  telegramUserId: number | undefined,
): Promise<void> {
  if (!telegramUserId) {
    await sendMessage(chatId, "Could not identify your account.");
    return;
  }

  const user = resolveUser(telegramUserId);
  if (!user) {
    await sendUnlinkedMessage(chatId);
    return;
  }

  // Check inference server
  const serverUp = await isInferenceRunning();
  if (!serverUp) {
    await sendMessage(chatId, "The AI engine is not running. Please try again later.");
    return;
  }

  try {
    const running = await listRunningModels();
    if (running.size === 0) {
      await sendMessage(chatId, "No AI model is loaded. An admin needs to load a model from Settings.");
      return;
    }
  } catch {
    // Proceed anyway
  }

  // Show typing indicator
  await sendTypingAction(chatId);

  // Audit
  recordAuditEvent({
    eventType: "telegram.query",
    actorEmail: user.email,
    details: { source: "telegram", telegramUserId },
  });

  // Get or create a conversation for this Telegram chat
  let conversationId = telegramConversations.get(chatId);
  let conversation = conversationId ? getConversation(conversationId) : undefined;

  if (!conversation) {
    conversation = createConversation(user.email, undefined, user.orgId);
    telegramConversations.set(chatId, conversation.id);
  }

  // Save user message
  const userMsgId = randomUUID();
  const userMsg: PersistedMessage = {
    id: userMsgId,
    conversationId: conversation.id,
    role: "user",
    content: text,
    createdAt: new Date(),
  };
  addMessage(userMsg);

  // Build session from recent conversation history
  const allMessages = getMessages(conversation.id);
  const sessionMessages: SessionMessage[] = allMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-6) // Keep last 6 messages for context
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const session: Session = {
    id: conversation.id,
    createdAt: conversation.createdAt,
    messages: sessionMessages,
  };

  // Resolve datasets (filter out vault sources)
  const { datasetNames, vaultSkipped } = filterVaultSources(user.email, user.isAdmin, user.orgId);

  // Determine strict mode
  const orgConfig = getIntegrationConfig();
  const strict = !(orgConfig.generalAnswersEnabled ?? true);

  let releaseSlotFn: (() => void) | undefined;

  try {
    // Search
    const { results: searchResults, candidateCount, hybridBoost } = await routedSearch(
      datasetNames,
      text,
      10,
    );

    // Acquire inference slot
    const abortController = new AbortController();
    try {
      releaseSlotFn = await acquireSlot(
        conversation.id,
        "normal",
        () => {}, // No queue position callback for Telegram
        abortController.signal,
      );
    } catch (err) {
      if (err instanceof QueueFullError) {
        await sendMessage(chatId, "The system is busy. Please try again in a moment.");
        return;
      }
      throw err;
    }

    // Run RAG pipeline (non-streaming)
    const result = await answer(
      text,
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

    // Build response
    let responseText = result.answer;

    // Add citations if present
    if (result.citations.length > 0) {
      const uniqueSources = new Map<string, string>();
      for (const c of result.citations) {
        if (c.documentName && !uniqueSources.has(c.documentName)) {
          uniqueSources.set(c.documentName, c.documentName);
        }
      }
      if (uniqueSources.size > 0) {
        responseText += "\n\nSources: " + [...uniqueSources.values()].join(", ");
      }
    }

    // Add vault warning if applicable
    if (vaultSkipped) {
      responseText += "\n\n(Note: Some data sources are in vault mode and can only be accessed through the Edgebric app.)";
    }

    // Save assistant message
    const assistantMsgId = randomUUID();
    const assistantMsg: PersistedMessage = {
      id: assistantMsgId,
      conversationId: conversation.id,
      role: "assistant",
      content: result.answer,
      citations: result.citations,
      hasConfidentAnswer: result.hasConfidentAnswer,
      answerType: result.answerType ?? undefined,
      source: "ai",
      createdAt: new Date(),
    };
    addMessage(assistantMsg);
    updateConversationTimestamp(conversation.id);

    await sendMessage(chatId, responseText);
  } catch (err) {
    logger.error({ err, chatId }, "Telegram query error");
    await sendMessage(chatId, "An error occurred while processing your question. Please try again.");
  } finally {
    releaseSlotFn?.();
  }
}

// ─── Document Handler ──────────────────────────────────────────────────────

export async function handleDocument(
  message: TelegramMessage,
): Promise<void> {
  const chatId = message.chat.id;
  const telegramUserId = message.from?.id;

  if (!telegramUserId) {
    await sendMessage(chatId, "Could not identify your account.");
    return;
  }

  const user = resolveUser(telegramUserId);
  if (!user) {
    await sendUnlinkedMessage(chatId);
    return;
  }

  const doc = message.document;
  if (!doc) {
    await sendMessage(chatId, "No document found in the message.");
    return;
  }

  // Check file size (20MB limit)
  if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
    await sendMessage(chatId, "File is too large (max 20MB). Please use the Edgebric app for larger files.");
    return;
  }

  // Check file type
  const fileName = doc.file_name ?? "document";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const allowedTypes = ["pdf", "docx", "txt", "md"];
  if (!allowedTypes.includes(ext)) {
    await sendMessage(chatId,
      `Unsupported file type: .${ext}\n\nSupported types: ${allowedTypes.map(t => `.${t}`).join(", ")}`
    );
    return;
  }

  await sendTypingAction(chatId);

  try {
    // Get file info from Telegram
    const fileInfo = await getFile(doc.file_id);
    if (!fileInfo?.file_path) {
      await sendMessage(chatId, "Could not retrieve the file from Telegram. Please try again.");
      return;
    }

    // Download the file
    const fileBuffer = await downloadFile(fileInfo.file_path);
    if (!fileBuffer) {
      await sendMessage(chatId, "Failed to download the file. Please try again.");
      return;
    }

    // Save to temp location and ingest
    const fs = await import("fs/promises");
    const path = await import("path");
    const os = await import("os");

    const tmpDir = path.join(os.tmpdir(), "edgebric-telegram");
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpPath = path.join(tmpDir, `${randomUUID()}-${fileName}`);
    await fs.writeFile(tmpPath, fileBuffer);

    try {
      // Use the document extraction to get text
      const { extractDocument } = await import("../jobs/extractors.js");
      const docType = ext as "pdf" | "docx" | "txt" | "md";
      const { markdown } = await extractDocument(tmpPath, docType);

      // Ask the user about the content
      const truncated = markdown.length > 3000
        ? markdown.slice(0, 3000) + "\n\n[...document truncated...]"
        : markdown;

      const caption = message.text ?? "";
      const query = caption
        ? `The user uploaded a document "${fileName}" with this question: ${caption}`
        : `The user uploaded a document "${fileName}". Please summarize its contents.`;

      // Use the document content as context for the query
      const contextQuery = `${query}\n\n<uploaded_document>\n${truncated}\n</uploaded_document>`;

      await handleTextQuery(chatId, contextQuery, telegramUserId);
    } finally {
      // Clean up temp file
      await fs.unlink(tmpPath).catch(() => {});
    }
  } catch (err) {
    logger.error({ err, chatId }, "Telegram document processing error");
    await sendMessage(chatId, "Failed to process the document. Please try again or use the Edgebric app.");
  }
}

// ─── Shared Helpers ────────────────────────────────────────────────────────

async function sendUnlinkedMessage(chatId: number): Promise<void> {
  await sendMessage(chatId,
    "Please link your account first.\n\n" +
    "Go to Account settings in the Edgebric app to get a link code, " +
    "then send /link <code> here."
  );
}
