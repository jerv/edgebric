import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { runtimeChatConfig, config } from "../config.js";
import { logger } from "../lib/logger.js";
import { requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import * as ollama from "../services/ollamaClient.js";
import { OFFICIAL_CATALOG, EMBEDDING_MODEL_TAG, getVisibleCatalog, MODEL_CATALOG_MAP, checkModelRAMFit } from "@edgebric/types";
import type { InstalledModel, ModelsResponse } from "@edgebric/types";

const tagSchema = z.object({
  tag: z.string().min(1, "tag is required").transform((s) => s.trim()),
});

export const modelsRouter: IRouter = Router();

modelsRouter.use(requireAdmin);

// Track in-progress pull so UI can show download state
const activePulls = new Map<string, AbortController>();

// ─── GET /api/admin/models ───────────────────────────────────────────────────
// Returns installed models (with loaded status), official catalog, active model,
// and system resources.

modelsRouter.get("/", async (_req, res) => {
  try {
    const ollamaUp = await ollama.isRunning();
    if (!ollamaUp) {
      // Ollama not running — return empty state with catalog
      const system = ollama.getSystemResources();
      const response: ModelsResponse = {
        models: [],
        catalog: getVisibleCatalog(),
        activeModel: runtimeChatConfig.model,
        system,
      };
      res.json(response);
      return;
    }

    const [installed, running] = await Promise.all([
      ollama.listInstalled(),
      ollama.listRunning(),
    ]);

    // Merge installed list with running status
    const models: InstalledModel[] = installed.map((m) => {
      const runInfo = running.get(m.tag);
      const isDownloading = activePulls.has(m.tag);
      return {
        ...m,
        status: isDownloading ? "downloading" as const : runInfo ? "loaded" as const : "installed" as const,
        ramUsageBytes: runInfo?.ramUsageBytes,
      };
    });

    // Add any models that are downloading but not yet in the installed list
    for (const tag of activePulls.keys()) {
      if (!models.some((m) => m.tag === tag)) {
        models.push({
          tag,
          name: tag,
          sizeBytes: 0,
          digest: "",
          modifiedAt: "",
          status: "downloading",
        });
      }
    }

    const system = ollama.getSystemResources();
    const response: ModelsResponse = {
      models,
      catalog: getVisibleCatalog(),
      activeModel: runtimeChatConfig.model,
      system,
    };
    res.json(response);
  } catch (err) {
    logger.error({ err }, "Failed to list models");
    res.status(500).json({ error: "Failed to list models" });
  }
});

// ─── POST /api/admin/models/pull ─────────────────────────────────────────────
// Download a model from Ollama registry. Returns SSE stream with progress.

modelsRouter.post("/pull", validateBody(tagSchema), async (req, res) => {
  const { tag } = req.body as z.infer<typeof tagSchema>;

  if (activePulls.has(tag)) {
    res.status(409).json({ error: "This model is already being downloaded" });
    return;
  }

  // Check Ollama is running
  const ollamaUp = await ollama.isRunning();
  if (!ollamaUp) {
    res.status(503).json({ error: "AI engine is not running" });
    return;
  }

  // Warn for community models (not in official catalog)
  const isCommunity = !OFFICIAL_CATALOG.some((m) => m.tag === tag);

  // RAM fitness check
  const catalogEntry = MODEL_CATALOG_MAP.get(tag);
  const system = ollama.getSystemResources();
  if (catalogEntry) {
    const fit = checkModelRAMFit(catalogEntry.ramUsageGB, system.ramTotalBytes);
    if (fit.level === "exceeds") {
      logger.warn({ tag, modelRAMGB: catalogEntry.ramUsageGB, totalRAMGB: fit.totalRAMGB, availableRAMGB: fit.availableRAMGB }, "Model download requested but exceeds system RAM — model will not load");
    } else if (fit.level === "tight") {
      logger.warn({ tag, modelRAMGB: catalogEntry.ramUsageGB, totalRAMGB: fit.totalRAMGB, availableRAMGB: fit.availableRAMGB }, "Model download requested with low RAM headroom — performance may suffer");
    } else {
      logger.info({ tag, modelRAMGB: catalogEntry.ramUsageGB, totalRAMGB: fit.totalRAMGB, availableRAMGB: fit.availableRAMGB }, "Model download requested, RAM check OK");
    }
  } else {
    logger.info({ tag, totalRAMGB: system.ramTotalBytes / (1024 ** 3) }, "Community model download requested — RAM usage unknown");
  }

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (isCommunity) {
    res.write(`event: warning\ndata: ${JSON.stringify({ message: "This is a community model and has not been tested with Edgebric." })}\n\n`);
  }

  // Send RAM warning via SSE so UI can display it
  if (catalogEntry) {
    const fit = checkModelRAMFit(catalogEntry.ramUsageGB, system.ramTotalBytes);
    if (fit.level === "exceeds") {
      res.write(`event: warning\ndata: ${JSON.stringify({ message: fit.message, level: "exceeds" })}\n\n`);
    } else if (fit.level === "tight") {
      res.write(`event: warning\ndata: ${JSON.stringify({ message: fit.message, level: "tight" })}\n\n`);
    }
  }

  const controller = new AbortController();
  activePulls.set(tag, controller);

  try {
    await ollama.pullModel(
      tag,
      (event) => {
        res.write(`event: progress\ndata: ${JSON.stringify(event)}\n\n`);
      },
      controller.signal,
    );

    activePulls.delete(tag);
    res.write(`event: done\ndata: ${JSON.stringify({ tag })}\n\n`);
    logger.info({ tag }, "Model pulled successfully");
  } catch (err) {
    activePulls.delete(tag);
    const message = err instanceof Error ? err.message : "Pull failed";
    if (controller.signal.aborted) {
      res.write(`event: cancelled\ndata: ${JSON.stringify({ tag })}\n\n`);
      logger.info({ tag }, "Model pull cancelled");
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
      logger.error({ tag, err }, "Model pull failed");
    }
  } finally {
    res.end();
  }
});

// ─── POST /api/admin/models/pull/cancel ──────────────────────────────────────
// Cancel an in-progress model download.

modelsRouter.post("/pull/cancel", validateBody(tagSchema), (req, res) => {
  const { tag } = req.body as z.infer<typeof tagSchema>;
  const controller = activePulls.get(tag);
  if (!controller) {
    res.status(404).json({ error: "No active download for this model" });
    return;
  }
  controller.abort();
  activePulls.delete(tag);
  res.json({ cancelled: true, tag });
});

// ─── POST /api/admin/models/load ─────────────────────────────────────────────
// Load a model into RAM and set it as the active chat model.

modelsRouter.post("/load", validateBody(tagSchema), async (req, res) => {
  const { tag } = req.body as z.infer<typeof tagSchema>;

  // RAM fitness logging before load
  const catalogEntry = MODEL_CATALOG_MAP.get(tag);
  const system = ollama.getSystemResources();
  const totalRAMGB = system.ramTotalBytes / (1024 ** 3);
  const availRAMGB = system.ramAvailableBytes / (1024 ** 3);

  if (catalogEntry) {
    const fit = checkModelRAMFit(catalogEntry.ramUsageGB, system.ramTotalBytes);
    if (fit.level === "exceeds") {
      logger.warn({ tag, modelRAMGB: catalogEntry.ramUsageGB, totalRAMGB: fit.totalRAMGB, availableRAMGB: fit.availableRAMGB, currentFreeRAMGB: +availRAMGB.toFixed(1) },
        "Loading model that EXCEEDS system RAM — expect failure or severe swapping");
    } else if (fit.level === "tight") {
      logger.warn({ tag, modelRAMGB: catalogEntry.ramUsageGB, totalRAMGB: fit.totalRAMGB, availableRAMGB: fit.availableRAMGB, currentFreeRAMGB: +availRAMGB.toFixed(1) },
        "Loading model with low RAM headroom — system may become sluggish");
    } else {
      logger.info({ tag, modelRAMGB: catalogEntry.ramUsageGB, currentFreeRAMGB: +availRAMGB.toFixed(1) }, "Loading model, RAM check OK");
    }
  } else {
    // Community model — log what we know
    logger.info({ tag, totalRAMGB: +totalRAMGB.toFixed(1), currentFreeRAMGB: +availRAMGB.toFixed(1) },
      "Loading community model — RAM usage unknown, monitor system resources");
  }

  try {
    await ollama.loadModel(tag);
    // Update runtime config so queries use this model
    runtimeChatConfig.model = tag;
    runtimeChatConfig.baseUrl = `${config.ollama.baseUrl}/v1`;

    // Post-load resource snapshot
    const postLoad = ollama.getSystemResources();
    const postFreeGB = postLoad.ramAvailableBytes / (1024 ** 3);
    if (postFreeGB < 2) {
      logger.warn({ tag, postLoadFreeRAMGB: +postFreeGB.toFixed(1) }, "Model loaded but system RAM is critically low (<2 GB free)");
    } else if (postFreeGB < 4) {
      logger.warn({ tag, postLoadFreeRAMGB: +postFreeGB.toFixed(1) }, "Model loaded but system RAM is low (<4 GB free)");
    } else {
      logger.info({ tag, postLoadFreeRAMGB: +postFreeGB.toFixed(1) }, "Model loaded and set as active");
    }

    res.json({ loaded: true, tag, activeModel: tag });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load model";
    logger.error({ tag, err, totalRAMGB: +totalRAMGB.toFixed(1), currentFreeRAMGB: +availRAMGB.toFixed(1) }, "Failed to load model — check RAM availability");
    res.status(500).json({ error: message });
  }
});

// ─── POST /api/admin/models/unload ───────────────────────────────────────────
// Evict a model from RAM.

modelsRouter.post("/unload", validateBody(tagSchema), async (req, res) => {
  const { tag } = req.body as z.infer<typeof tagSchema>;

  try {
    await ollama.unloadModel(tag);

    // If we just unloaded the active model, auto-switch to another loaded model
    let newActive: string | undefined;
    if (tag === runtimeChatConfig.model) {
      const running = await ollama.listRunning();
      const otherTag = [...running.keys()].find((t) => t !== tag && t !== EMBEDDING_MODEL_TAG);
      if (otherTag) {
        runtimeChatConfig.model = otherTag;
        newActive = otherTag;
        logger.info({ newActive }, "Auto-switched active model after unload");
      } else {
        // No other loaded model — pick first installed as fallback
        const installed = await ollama.listInstalled();
        const fallback = installed.find((m) => m.tag !== tag && m.tag !== EMBEDDING_MODEL_TAG);
        if (fallback) {
          runtimeChatConfig.model = fallback.tag;
          newActive = fallback.tag;
          logger.info({ newActive }, "Fallback active model set after unload (not loaded in RAM)");
        }
      }
    }

    res.json({ unloaded: true, tag, ...(newActive && { activeModel: newActive }) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to unload model";
    logger.error({ tag, err }, "Failed to unload model");
    res.status(500).json({ error: message });
  }
});

// ─── PUT /api/admin/models/active ────────────────────────────────────────────
// Set the active (default) chat model. Does NOT load it into RAM — just sets
// which model to use for queries.

modelsRouter.put("/active", validateBody(tagSchema), (req, res) => {
  const { tag } = req.body as z.infer<typeof tagSchema>;
  runtimeChatConfig.model = tag;
  runtimeChatConfig.baseUrl = `${config.ollama.baseUrl}/v1`;
  logger.info({ model: tag }, "Active chat model switched");
  res.json({ activeModel: tag });
});

// ─── DELETE /api/admin/models/:tag ───────────────────────────────────────────
// Remove a model from disk.

modelsRouter.delete("/:tag", async (req, res) => {
  const tag = decodeURIComponent(req.params["tag"]!);

  // Protect embedding model
  if (tag === EMBEDDING_MODEL_TAG) {
    res.status(403).json({ error: "Cannot delete the embedding model" });
    return;
  }

  try {
    await ollama.deleteModel(tag);

    // If the deleted model was active, switch to another
    if (tag === runtimeChatConfig.model) {
      try {
        const installed = await ollama.listInstalled();
        const remaining = installed.filter((m) => m.tag !== EMBEDDING_MODEL_TAG && m.tag !== tag);
        if (remaining.length > 0) {
          runtimeChatConfig.model = remaining[0]!.tag;
          logger.info({ newActive: runtimeChatConfig.model }, "Auto-switched active model after deletion");
        }
      } catch {
        // Can't list models — leave active as-is
      }
    }

    res.json({ deleted: true, tag });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete model";
    logger.error({ tag, err }, "Failed to delete model");
    res.status(500).json({ error: message });
  }
});
