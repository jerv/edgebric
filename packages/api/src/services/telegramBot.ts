/**
 * Telegram Bot Service — Core bot logic for the Telegram integration.
 *
 * Uses Node.js built-in fetch to call the Telegram Bot API.
 * No external Telegram libraries — the API is simple REST.
 */
import { logger } from "../lib/logger.js";
import { getIntegrationConfig } from "./integrationConfigStore.js";

// ─── Telegram Bot API Types ────────────────────────────────────────────────

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  document?: TelegramDocument;
  entities?: TelegramMessageEntity[];
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessageEntity {
  type: string; // "bot_command" | "mention" | etc.
  offset: number;
  length: number;
}

interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

// ─── Bot API Calls ─────────────────────────────────────────────────────────

function getBotToken(): string {
  const config = getIntegrationConfig();
  const token = config.telegramBotToken;
  if (!token) throw new Error("Telegram bot token not configured");
  return token;
}

function apiUrl(method: string, token?: string): string {
  return `https://api.telegram.org/bot${token ?? getBotToken()}/${method}`;
}

/**
 * Send a text message to a Telegram chat.
 * Supports Markdown V2 formatting.
 */
export async function sendMessage(
  chatId: number,
  text: string,
  opts?: { parseMode?: "MarkdownV2" | "HTML" },
): Promise<void> {
  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: truncateMessage(text),
    };
    if (opts?.parseMode) body.parse_mode = opts.parseMode;

    const res = await fetch(apiUrl("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as TelegramApiResponse;
      logger.warn({ chatId, error: data.description }, "Failed to send Telegram message");

      // If MarkdownV2 fails, retry as plain text
      if (opts?.parseMode) {
        await sendMessage(chatId, text);
        return;
      }
    }
  } catch (err) {
    logger.error({ err, chatId }, "Error sending Telegram message");
  }
}

/**
 * Send a "typing" action indicator.
 */
export async function sendTypingAction(chatId: number): Promise<void> {
  try {
    await fetch(apiUrl("sendChatAction"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Best-effort — don't fail on typing indicator
  }
}

/**
 * Get file info from Telegram (needed to download uploaded files).
 */
export async function getFile(fileId: string): Promise<TelegramFile | null> {
  try {
    const res = await fetch(apiUrl("getFile"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as TelegramApiResponse<TelegramFile>;
    return data.result ?? null;
  } catch {
    return null;
  }
}

/**
 * Download a file from Telegram servers.
 */
export async function downloadFile(filePath: string): Promise<Buffer | null> {
  try {
    const token = getBotToken();
    const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

/**
 * Register (or update) the webhook URL with Telegram.
 */
export async function setWebhook(
  webhookUrl: string,
  secret: string,
  token?: string,
): Promise<{ ok: boolean; description?: string }> {
  const res = await fetch(apiUrl("setWebhook", token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ["message"],
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const data = (await res.json()) as TelegramApiResponse;
  return { ok: data.ok, description: data.description };
}

/**
 * Delete the webhook (disable the bot).
 */
export async function deleteWebhook(token?: string): Promise<{ ok: boolean }> {
  const res = await fetch(apiUrl("deleteWebhook", token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drop_pending_updates: true }),
    signal: AbortSignal.timeout(10_000),
  });

  const data = (await res.json()) as TelegramApiResponse;
  return { ok: data.ok };
}

/**
 * Get current webhook info.
 */
export async function getWebhookInfo(token?: string): Promise<{ url: string; pending_update_count: number } | null> {
  try {
    const res = await fetch(apiUrl("getWebhookInfo", token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as TelegramApiResponse<{ url: string; pending_update_count: number }>;
    return data.result ?? null;
  } catch {
    return null;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Telegram messages have a 4096-char limit. Truncate if necessary. */
function truncateMessage(text: string): string {
  const MAX = 4000; // leave margin
  if (text.length <= MAX) return text;
  return text.slice(0, MAX) + "\n\n[Message truncated]";
}

/**
 * Parse a bot command from a message.
 * Returns { command, args } or null if not a command.
 */
export function parseCommand(message: TelegramMessage): { command: string; args: string } | null {
  if (!message.text || !message.entities) return null;

  const commandEntity = message.entities.find((e) => e.type === "bot_command" && e.offset === 0);
  if (!commandEntity) return null;

  const rawCommand = message.text.slice(commandEntity.offset, commandEntity.offset + commandEntity.length);
  // Strip @botname suffix (e.g., /start@edgebric_bot -> /start)
  const command = rawCommand.split("@")[0]!.slice(1).toLowerCase();
  const args = message.text.slice(commandEntity.offset + commandEntity.length).trim();

  return { command, args };
}

/**
 * Check if Telegram integration is enabled and configured.
 */
export function isTelegramEnabled(): boolean {
  const config = getIntegrationConfig();
  return !!(config.telegramEnabled && config.telegramBotToken);
}
