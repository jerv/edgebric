import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { requireOrg } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { config } from "../config.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";

export const vaultRouter: IRouter = Router();

vaultRouter.use(requireOrg);

function chatServerUrl(): string {
  return config.inference.chatBaseUrl;
}

function embeddingServerUrl(): string {
  return config.inference.embeddingBaseUrl;
}

/**
 * GET /api/vault/engine-status
 * Check if the local AI engine is reachable and return installed models.
 * Non-admin — any authenticated user with vault mode enabled can call this.
 */
vaultRouter.get("/engine-status", async (req, res) => {
  const integrations = getIntegrationConfig();
  if (!integrations.vaultModeEnabled) {
    res.status(403).json({ error: "Vault mode is not enabled" });
    return;
  }

  try {
    const resp = await fetch(`${chatServerUrl()}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      res.json({ connected: false, models: [] });
      return;
    }
    // llama-server loads one model at a time; report the active model
    const activeModel = config.chat.model;
    res.json({ connected: true, models: activeModel ? [{ name: activeModel }] : [] });
  } catch {
    res.json({ connected: false, models: [] });
  }
});

/**
 * POST /api/vault/embed
 * Proxy an embedding request to the local AI engine.
 * Avoids CORS issues from browser-direct requests.
 */
const embedSchema = z.object({
  model: z.string().min(1).max(200),
  prompt: z.string().min(1).max(50000),
});

vaultRouter.post("/embed", validateBody(embedSchema), async (req, res) => {
  const integrations = getIntegrationConfig();
  if (!integrations.vaultModeEnabled) {
    res.status(403).json({ error: "Vault mode is not enabled" });
    return;
  }

  const { prompt } = req.body as z.infer<typeof embedSchema>;

  try {
    const resp = await fetch(`${embeddingServerUrl()}/v1/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: prompt, model: "embedding" }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      res.status(resp.status).json({ error: `Embedding failed: ${resp.status}` });
      return;
    }
    const data = (await resp.json()) as { data: Array<{ embedding: number[] }> };
    // Return in legacy format for backward compat with vault client
    res.json({ embedding: data.data?.[0]?.embedding ?? [] });
  } catch {
    res.status(502).json({ error: "Could not reach AI engine" });
  }
});

/**
 * POST /api/vault/chat
 * Proxy a streaming chat request to the local AI engine.
 * Pipes the response as-is (NDJSON stream) so the client can parse it identically.
 */
const chatSchema = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().max(100000),
  })).min(1).max(100),
  stream: z.boolean().optional().default(true),
});

vaultRouter.post("/chat", validateBody(chatSchema), async (req, res) => {
  const integrations = getIntegrationConfig();
  if (!integrations.vaultModeEnabled) {
    res.status(403).json({ error: "Vault mode is not enabled" });
    return;
  }

  const { model, messages, stream } = req.body as z.infer<typeof chatSchema>;

  try {
    const resp = await fetch(`${chatServerUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: stream ?? true }),
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) {
      res.status(resp.status).json({ error: `Chat failed: ${resp.status}` });
      return;
    }

    // Stream the response body through to the client
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");

    const reader = resp.body?.getReader();
    if (!reader) {
      res.status(502).json({ error: "No response body from AI engine" });
      return;
    }

    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    };

    req.on("close", () => {
      reader.cancel().catch(() => {});
    });

    await pump();
  } catch {
    if (!res.headersSent) {
      res.status(502).json({ error: "Could not reach AI engine" });
    } else {
      res.end();
    }
  }
});
