/**
 * Chat Client — OpenAI-compatible streaming chat via llama-server.
 *
 * Handles SSE streaming, Qwen /nothink injection, and <think> block filtering.
 * Provides streaming chat completions and tool-calling for the RAG pipeline.
 */
import type { Message } from "@edgebric/core/rag";
import { runtimeChatConfig } from "../config.js";
import type { ToolParameters } from "./toolRunner.js";


export interface ChatClient {
  chatStream(messages: Message[]): AsyncIterable<string>;
  /** Non-streaming call with tool definitions. Returns the assistant message. */
  chatWithTools(
    messages: ToolMessage[],
    tools: Array<{ type: "function"; function: { name: string; description: string; parameters: ToolParameters } }>,
  ): Promise<ToolResponseMessage>;
}

export interface ToolMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> | undefined;
  tool_call_id?: string | undefined;
}

export interface ToolResponseMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> | undefined;
}

/**
 * Create a chat client that calls an OpenAI-compatible /chat/completions endpoint.
 * By default uses llama-server's OpenAI-compatible API.
 */
export function createChatClient(): ChatClient {
  async function* chatStream(messages: Message[]): AsyncIterable<string> {
    // Append /nothink to the last user message to disable Qwen 3.x thinking mode.
    // Thinking roughly doubles token count with no quality benefit for RAG answers.
    const msgs = messages.map((m, i) => {
      if (i === messages.length - 1 && m.role === "user") {
        return { ...m, content: m.content + " /nothink" };
      }
      return m;
    });

    const response = await fetch(`${runtimeChatConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtimeChatConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: runtimeChatConfig.model,
        messages: msgs,
        stream: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Chat inference failed (HTTP ${response.status}): ${body}`);
    }

    if (!response.body) throw new Error("No response body from chat endpoint");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // Safety net: strip any <think>...</think> blocks that slip through
    // despite /nothink. Accumulate only while inside a think block.
    let insideThink = false;
    let thinkBuf = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") return;

          try {
            const parsed = JSON.parse(payload) as {
              choices: Array<{ delta: { content?: string } }>;
            };
            const content = parsed.choices[0]?.delta?.content;
            if (!content) continue;

            if (insideThink) {
              thinkBuf += content;
              if (thinkBuf.includes("</think>")) {
                const after = thinkBuf.slice(thinkBuf.indexOf("</think>") + 8);
                thinkBuf = "";
                insideThink = false;
                if (after) yield after;
              }
              continue;
            }

            // Check if this token starts a think block
            if (content.includes("<think>")) {
              insideThink = true;
              const before = content.slice(0, content.indexOf("<think>"));
              thinkBuf = content.slice(content.indexOf("<think>") + 7);
              if (before) yield before;
              continue;
            }

            yield content;
          } catch {
            // Malformed SSE line — skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Non-streaming chat completion with tool definitions.
   * Used for tool-calling flow where we need the full response
   * to check for tool_calls before deciding what to do next.
   */
  async function chatWithTools(
    messages: ToolMessage[],
    tools: Array<{ type: "function"; function: { name: string; description: string; parameters: ToolParameters } }>,
  ): Promise<ToolResponseMessage> {
    // Inject /nothink for the last user message
    const msgs = messages.map((m, i) => {
      if (m.role === "user" && i === messages.length - 1 && m.content) {
        return { ...m, content: m.content + " /nothink" };
      }
      return m;
    });

    const response = await fetch(`${runtimeChatConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtimeChatConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: runtimeChatConfig.model,
        messages: msgs,
        tools,
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Chat inference failed (HTTP ${response.status}): ${body}`);
    }

    const json = await response.json() as {
      choices: Array<{
        message: {
          role: "assistant";
          content: string | null;
          tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
        };
      }>;
    };

    const msg = json.choices[0]?.message;
    if (!msg) throw new Error("No message in chat completion response");

    // Strip <think> blocks from content if present
    let content = msg.content;
    if (content) {
      content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    }

    return {
      role: "assistant",
      content,
      tool_calls: msg.tool_calls,
    };
  }

  return { chatStream, chatWithTools };
}
