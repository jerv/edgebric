import type { EdgeConfig } from "@edgebric/types";
import type { Message } from "@edgebric/core/rag";

/**
 * Client for mimik mILM (Local LLM inference service).
 *
 * mILM exposes an OpenAI-compatible REST API at localhost:8083/api/mim/v1.
 * Auth is a static API key set when the container is deployed.
 *
 * Endpoints used:
 *   POST /embeddings          — convert text to embedding vector
 *   POST /chat/completions    — generate text (streaming)
 *   POST /models              — register/download a model
 *   GET  /models              — list available models
 */
export interface MILMClient {
  embed(text: string): Promise<number[]>;
  chatStream(messages: Message[]): AsyncIterable<string>;
  downloadModel(modelId: string, huggingFaceUrl: string): Promise<void>;
  listModels(): Promise<MILMModel[]>;
}

export interface MILMModel {
  id: string;
  readyToUse: boolean;
}

export function createMILMClient(config: EdgeConfig, basePath = "/api/mim/v1"): MILMClient {
  const base = `${config.baseUrl}${basePath}`;
  const headers = {
    Authorization: `bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  async function embed(text: string): Promise<number[]> {
    const response = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.embeddingModel,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new MILMError("embed", response.status, await response.text());
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    const embedding = data.data[0]?.embedding;
    if (!embedding) throw new MILMError("embed", 0, "No embedding in response");
    return embedding;
  }

  async function* chatStream(messages: Message[]): AsyncIterable<string> {
    // Append /nothink to the last user message to disable Qwen 3.x thinking mode.
    // Thinking roughly doubles token count with no quality benefit for RAG answers.
    const msgs = messages.map((m, i) => {
      if (i === messages.length - 1 && m.role === "user") {
        return { ...m, content: m.content + " /nothink" };
      }
      return m;
    });

    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.milmModel,
        messages: msgs,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new MILMError("chatStream", response.status, await response.text());
    }

    if (!response.body) throw new MILMError("chatStream", 0, "No response body");

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

            // Filter mILM cold-start tokens
            if (/^<\|(?:loading_model|processing_prompt)\|>/.test(content)) continue;

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

  async function downloadModel(modelId: string, huggingFaceUrl: string): Promise<void> {
    const response = await fetch(`${base}/models`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: modelId,
        object: "model",
        kind: "llm",
        url: huggingFaceUrl,
      }),
    });

    if (!response.ok) {
      throw new MILMError("downloadModel", response.status, await response.text());
    }
  }

  async function listModels(): Promise<MILMModel[]> {
    const response = await fetch(`${base}/models`, { headers });
    if (!response.ok) {
      throw new MILMError("listModels", response.status, await response.text());
    }
    const data = (await response.json()) as {
      data: Array<{ id: string; readyToUse?: boolean }>;
    };
    return data.data.map((m) => ({ id: m.id, readyToUse: m.readyToUse ?? false }));
  }

  return { embed, chatStream, downloadModel, listModels };
}

export class MILMError extends Error {
  constructor(
    public readonly operation: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`mILM ${operation} failed (HTTP ${status}): ${body}`);
    this.name = "MILMError";
  }
}
