/**
 * Context summarizer for group chat conversations.
 *
 * When the conversation context exceeds a token threshold, older messages
 * are summarized into a compressed block. This prevents context window overflow
 * while preserving the key information from the conversation.
 *
 * The summarizer uses the same LLM (via GenerateFn) as the RAG pipeline.
 */

import type { GenerateFn, Message } from "./orchestrator.js";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  authorName?: string;
  content: string;
}

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function messagesToText(messages: ChatMessage[]): string {
  return messages.map((m) => {
    const speaker = m.role === "assistant" ? "Bot" : (m.authorName ?? "User");
    return `${speaker}: ${m.content}`;
  }).join("\n");
}

/**
 * Split messages into "old" (to summarize) and "recent" (to keep verbatim).
 * Takes the oldest ~70% when total exceeds the threshold.
 */
export function splitForSummary(
  messages: ChatMessage[],
  tokenThreshold = 3000,
): { old: ChatMessage[]; recent: ChatMessage[] } {
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  if (totalTokens <= tokenThreshold) {
    return { old: [], recent: messages };
  }

  // Take the oldest 70% of messages
  const splitPoint = Math.floor(messages.length * 0.7);
  return {
    old: messages.slice(0, splitPoint),
    recent: messages.slice(splitPoint),
  };
}

/**
 * Summarize a set of messages into a compressed context block.
 * Uses the LLM to generate a concise summary.
 */
export async function summarizeMessages(
  messages: ChatMessage[],
  generate: GenerateFn,
): Promise<string> {
  if (messages.length === 0) return "";

  const transcript = messagesToText(messages);

  const systemPrompt = `You are a conversation summarizer. Summarize the following group chat conversation into a concise paragraph (max 500 words). Focus on:
- Key questions asked and answers given
- Important facts, decisions, or conclusions reached
- Any unresolved questions or ongoing discussions
- Data source content that was discussed

Do NOT include greetings, small talk, or redundant information. Write in third person past tense.`;

  const promptMessages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Summarize this conversation:\n\n${transcript}` },
  ];

  let summary = "";
  for await (const chunk of generate(promptMessages)) {
    summary += chunk;
  }

  return summary.trim();
}

/**
 * Build the final context for the bot, incorporating a summary of older messages
 * and keeping recent messages verbatim.
 *
 * Returns an array of Message objects ready for the LLM.
 */
export function buildSummarizedContext(
  summary: string,
  recentMessages: ChatMessage[],
): Message[] {
  const context: Message[] = [];

  if (summary) {
    context.push({
      role: "system",
      content: `Summary of earlier conversation:\n${summary}`,
    });
  }

  for (const msg of recentMessages) {
    if (msg.role === "system") continue; // Skip system messages in context
    context.push({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: msg.role === "user" && msg.authorName
        ? `[${msg.authorName}]: ${msg.content}`
        : msg.content,
    });
  }

  return context;
}
