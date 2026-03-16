import { Router } from "express";
import type { Router as IRouter } from "express";
import { spawn, exec } from "child_process";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { z } from "zod";
import { config, runtimeChatConfig } from "../config.js";
import { logger } from "../lib/logger.js";
import { requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";

const modelIdSchema = z.object({
  modelId: z.string().min(1, "modelId is required").transform((s) => s.trim()),
});

export const modelsRouter: IRouter = Router();

modelsRouter.use(requireAdmin);

const CHAT_BASE = config.chat.baseUrl;
const CHAT_KEY = config.chat.apiKey;

// Repo root = four levels up from packages/api/src/routes/
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

// Directory where GGUF files live. Override with LLAMA_MODEL_DIR env var.
const MODEL_DIR =
  process.env["LLAMA_MODEL_DIR"] ??
  join(REPO_ROOT, "scripts/binaries/mim-OE-ai/.edge/.edge-mcm/containers/912e9964-953a-41a3-a3d4-45594a196471-mim-v1/cache");

// Static registry of models we expose in the UI.
// filename: the .gguf file in MODEL_DIR
// id: the ID llama-server reports (matches filename)
const KNOWN_MODELS: Array<{ id: string; filename: string }> = [
  { id: "qwen3.5-4b.gguf", filename: "qwen3.5-4b.gguf" },
  { id: "qwen3.5-9b.gguf", filename: "qwen3.5-9b.gguf" },
];

// Track in-progress load so the UI can show a loading state
let loadingModelId: string | null = null;

async function listLlamaModels(): Promise<Array<{ id: string; readyToUse: boolean }>> {
  const res = await fetch(`${CHAT_BASE}/models`, {
    headers: { Authorization: `Bearer ${CHAT_KEY}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`llama-server models failed: ${res.status}`);
  const data = (await res.json()) as { data: Array<{ id: string }> };
  return data.data.map((m) => ({ id: m.id, readyToUse: true }));
}

// GET /api/admin/models
// Returns known models with readyToUse=true for the currently loaded one,
// plus which model is active and whether a load is in progress.
modelsRouter.get("/", async (_req, res) => {
  let loadedIds: string[] = [];
  try {
    const live = await listLlamaModels();
    loadedIds = live.map((m) => m.id);
  } catch {
    // llama-server not reachable — no models ready
  }

  const models = KNOWN_MODELS.map((m) => ({
    id: m.id,
    readyToUse: loadedIds.includes(m.id),
    onDisk: existsSync(`${MODEL_DIR}/${m.filename}`),
    loading: loadingModelId === m.id,
  }));

  res.json({ models, activeModel: runtimeChatConfig.model, loadingModelId });
});

// PUT /api/admin/models/active — hot-swap model name in runtimeChatConfig (no restart)
modelsRouter.put("/active", validateBody(modelIdSchema), (req, res) => {
  const { modelId } = req.body as z.infer<typeof modelIdSchema>;
  const known = KNOWN_MODELS.find((m) => m.id === modelId);
  if (!known) {
    res.status(400).json({ error: "Unknown model" });
    return;
  }
  runtimeChatConfig.model = known.id;
  logger.info({ model: runtimeChatConfig.model }, "Active chat model switched");
  res.json({ activeModel: runtimeChatConfig.model });
});

// POST /api/admin/models/stop — kill llama-server
modelsRouter.post("/stop", async (_req, res) => {
  logger.info("Stopping llama-server");
  await new Promise<void>((resolve) => {
    exec("pkill -f 'llama-server.*8080'", () => resolve());
  });
  loadingModelId = null;
  res.json({ ok: true });
});

// POST /api/admin/models/restart — restart llama-server with current model
modelsRouter.post("/restart", async (_req, res) => {
  const currentModel = runtimeChatConfig.model;
  const known = KNOWN_MODELS.find((m) => m.id === currentModel);
  if (!known) {
    res.status(400).json({ error: "No known model to restart" });
    return;
  }
  const modelPath = `${MODEL_DIR}/${known.filename}`;
  if (!existsSync(modelPath)) {
    res.status(404).json({ error: "Model file not found on disk" });
    return;
  }
  if (loadingModelId) {
    res.status(409).json({ error: "A model is already loading" });
    return;
  }

  loadingModelId = known.id;
  logger.info({ modelId: known.id }, "Restarting llama-server");

  await new Promise<void>((resolve) => {
    exec("pkill -f 'llama-server.*8080'", () => resolve());
  });
  await new Promise((r) => setTimeout(r, 1500));
  res.json({ loading: true, modelId: known.id });

  const port = "8080";
  const child = spawn(
    "llama-server",
    ["--model", modelPath, "--port", port, "--host", "127.0.0.1", "-ngl", "99", "--ctx-size", "4096", "--log-disable"],
    { detached: true, stdio: "ignore" },
  );
  child.unref();

  const deadline = Date.now() + 120_000;
  const poll = async () => {
    if (Date.now() > deadline) {
      logger.error({ modelId: known.id }, "Timed out waiting for llama-server restart");
      loadingModelId = null;
      return;
    }
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        signal: AbortSignal.timeout(2000),
      });
      if (r.ok) {
        loadingModelId = null;
        logger.info({ modelId: known.id }, "Model restarted");
        return;
      }
    } catch {}
    setTimeout(poll, 2000);
  };
  setTimeout(poll, 3000);
});

// POST /api/admin/models/load — kill llama-server and restart with a different model
modelsRouter.post("/load", validateBody(modelIdSchema), async (req, res) => {
  const { modelId } = req.body as z.infer<typeof modelIdSchema>;

  const known = KNOWN_MODELS.find((m) => m.id === modelId);
  if (!known) {
    res.status(404).json({ error: "Unknown model" });
    return;
  }

  const modelPath = `${MODEL_DIR}/${known.filename}`;
  if (!existsSync(modelPath)) {
    res.status(404).json({ error: "Model file not found on disk" });
    return;
  }

  if (loadingModelId) {
    res.status(409).json({ error: "A model is already loading" });
    return;
  }

  loadingModelId = known.id;
  logger.info({ modelId: known.id }, "Loading model");

  // Kill existing llama-server on port 8080
  await new Promise<void>((resolve) => {
    exec("pkill -f 'llama-server.*8080'", () => resolve());
  });

  // Brief pause to let port 8080 release
  await new Promise((r) => setTimeout(r, 1500));

  // Respond immediately — client polls GET /models for ready state
  res.json({ loading: true, modelId: known.id });

  // Spawn new llama-server in background
  const port = "8080";
  const child = spawn(
    "llama-server",
    ["--model", modelPath, "--port", port, "--host", "127.0.0.1", "-ngl", "99", "--ctx-size", "4096", "--log-disable"],
    { detached: true, stdio: "ignore" },
  );
  child.unref();

  // Poll until llama-server is responsive, then update runtimeChatConfig
  const deadline = Date.now() + 120_000; // 2 min max
  const poll = async () => {
    if (Date.now() > deadline) {
      logger.error({ modelId: known.id }, "Timed out waiting for llama-server to load model");
      loadingModelId = null;
      return;
    }
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        signal: AbortSignal.timeout(2000),
      });
      if (r.ok) {
        runtimeChatConfig.model = known.id;
        runtimeChatConfig.baseUrl = `http://127.0.0.1:${port}/v1`;
        logger.info({ modelId: known.id }, "Model loaded");
        loadingModelId = null;
        return;
      }
    } catch {
      // not ready yet
    }
    setTimeout(poll, 2000);
  };
  setTimeout(poll, 3000);
});
