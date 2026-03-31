import { Router } from "express";
import type { Router as IRouter } from "express";
import { requireOrg } from "../middleware/auth.js";
import { config } from "../config.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";

export const vaultRouter: IRouter = Router();

vaultRouter.use(requireOrg);

function ollamaUrl(): string {
  return config.ollama.baseUrl;
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
    const resp = await fetch(`${ollamaUrl()}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      res.json({ connected: false, models: [] });
      return;
    }
    const data = (await resp.json()) as { models?: Array<{ name: string; size?: number }> };
    res.json({ connected: true, models: data.models ?? [] });
  } catch {
    res.json({ connected: false, models: [] });
  }
});

/**
 * POST /api/vault/embed
 * Proxy an embedding request to the local AI engine.
 * Avoids CORS issues from browser-direct requests.
 */
vaultRouter.post("/embed", async (req, res) => {
  const integrations = getIntegrationConfig();
  if (!integrations.vaultModeEnabled) {
    res.status(403).json({ error: "Vault mode is not enabled" });
    return;
  }

  const { model, prompt } = req.body as { model?: string; prompt?: string };
  if (!model || !prompt) {
    res.status(400).json({ error: "model and prompt are required" });
    return;
  }

  try {
    const resp = await fetch(`${ollamaUrl()}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      res.status(resp.status).json({ error: `Embedding failed: ${resp.status}` });
      return;
    }
    const data = (await resp.json()) as { embedding: number[] };
    res.json(data);
  } catch {
    res.status(502).json({ error: "Could not reach AI engine" });
  }
});

/**
 * POST /api/vault/chat
 * Proxy a streaming chat request to the local AI engine.
 * Pipes the response as-is (NDJSON stream) so the client can parse it identically.
 */
vaultRouter.post("/chat", async (req, res) => {
  const integrations = getIntegrationConfig();
  if (!integrations.vaultModeEnabled) {
    res.status(403).json({ error: "Vault mode is not enabled" });
    return;
  }

  const { model, messages, stream } = req.body as {
    model?: string;
    messages?: Array<{ role: string; content: string }>;
    stream?: boolean;
  };
  if (!model || !messages) {
    res.status(400).json({ error: "model and messages are required" });
    return;
  }

  try {
    const resp = await fetch(`${ollamaUrl()}/api/chat`, {
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
