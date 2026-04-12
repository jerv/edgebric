import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { runtimeChatConfig, config } from "../config.js";
import { logger } from "../lib/logger.js";
import { requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import * as inference from "../services/inferenceClient.js";
import { OFFICIAL_CATALOG, EMBEDDING_MODEL_TAG, getVisibleCatalog, MODEL_CATALOG_MAP, checkModelRAMFit } from "@edgebric/types";
import type { InstalledModel, ModelsResponse, ModelCapabilities } from "@edgebric/types";
import { saveLastModel, clearLastModel } from "../services/modelPersistence.js";

const tagSchema = z.object({
  tag: z.string().min(1, "tag is required").transform((s) => s.trim()),
});

export const modelsRouter: IRouter = Router();

// ─── GET /api/admin/models/capabilities ─────────────────────────────────────
// Returns the current model's capabilities. This is a stub — needs to be
// wired to real model capability detection (e.g., from GGUF metadata or
// a known-models lookup table).
// This endpoint does NOT require admin — any authenticated user can check.

import { requireOrg } from "../middleware/auth.js";

const capabilitiesRouter: IRouter = Router();
capabilitiesRouter.use(requireOrg);

capabilitiesRouter.get("/capabilities", (_req, res) => {
  const catalogEntry = MODEL_CATALOG_MAP.get(runtimeChatConfig.model);
  res.json({
    vision: catalogEntry?.capabilities?.vision ?? false,
    toolUse: catalogEntry?.capabilities?.toolUse ?? false,
    reasoning: catalogEntry?.capabilities?.reasoning ?? false,
    support: catalogEntry?.support ?? "community",
    recommendedRole: catalogEntry?.recommendedRole ?? null,
    activeModel: runtimeChatConfig.model || null,
  });
});

// Export for mounting at /api/admin/models/capabilities (see app.ts)
export { capabilitiesRouter };

modelsRouter.use(requireAdmin);

// Track in-progress pull so UI can show download state
const activePulls = new Map<string, AbortController>();

// ─── GET /api/admin/models ───────────────────────────────────────────────────
// Returns installed models (with loaded status), official catalog, active model,
// and system resources.

modelsRouter.get("/", async (_req, res) => {
  try {
    const serverUp = await inference.isRunning();
    if (!serverUp) {
      // Inference server not running — return empty state with catalog
      const system = inference.getSystemResources();
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
      inference.listInstalled(),
      inference.listRunning(),
    ]);

    // Merge installed list with running status + capabilities
    const models: InstalledModel[] = installed.map((m) => {
      const runInfo = running.get(m.tag);
      const isDownloading = activePulls.has(m.tag);
      const catalogEntry = MODEL_CATALOG_MAP.get(m.tag);
      return {
        ...m,
        status: isDownloading ? "downloading" as const : runInfo ? "loaded" as const : "installed" as const,
        ramUsageBytes: runInfo?.ramUsageBytes,
        catalogEntry,
        capabilities: catalogEntry?.capabilities,
        support: catalogEntry?.support ?? "community",
      };
    });

    // Add any models that are downloading but not yet in the installed list
    for (const tag of activePulls.keys()) {
      if (!models.some((m) => m.tag === tag)) {
        models.push({
          tag,
          filename: `${tag}.gguf`,
          name: tag,
          sizeBytes: 0,
          modifiedAt: "",
          status: "downloading",
          support: MODEL_CATALOG_MAP.get(tag)?.support ?? "community",
        });
      }
    }

    // Auto-select: if the active model isn't loaded but another chat model is, switch to it
    const loadedChat = models.filter((m) => m.status === "loaded" && m.tag !== EMBEDDING_MODEL_TAG);
    const activeIsLoaded = loadedChat.some((m) => m.tag === runtimeChatConfig.model);
    if (!activeIsLoaded && loadedChat.length > 0) {
      runtimeChatConfig.model = loadedChat[0]!.tag;
      runtimeChatConfig.baseUrl = `${config.inference.chatBaseUrl}/v1`;
      logger.info({ newActive: runtimeChatConfig.model }, "Auto-selected loaded model as active");
    }

    const system = inference.getSystemResources();
    const storage = inference.getStorageBreakdown();
    const response: ModelsResponse = {
      models,
      catalog: getVisibleCatalog(),
      activeModel: runtimeChatConfig.model,
      system,
      storage,
    };
    res.json(response);
  } catch (err) {
    logger.error({ err }, "Failed to list models");
    res.status(500).json({ error: "Failed to list models" });
  }
});

// ─── POST /api/admin/models/pull ─────────────────────────────────────────────
// Download a model. Returns SSE stream with progress.

modelsRouter.post("/pull", validateBody(tagSchema), async (req, res) => {
  const { tag } = req.body as z.infer<typeof tagSchema>;

  if (activePulls.has(tag)) {
    res.status(409).json({ error: "This model is already being downloaded" });
    return;
  }

  // Check inference server is running
  const serverUp = await inference.isRunning();
  if (!serverUp) {
    res.status(503).json({ error: "AI engine is not running" });
    return;
  }

  // Warn for community models (not in official catalog)
  const isCommunity = !OFFICIAL_CATALOG.some((m) => m.tag === tag);

  // RAM fitness check
  const catalogEntry = MODEL_CATALOG_MAP.get(tag);
  const system = inference.getSystemResources();
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
    await inference.pullModel(
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
  const system = inference.getSystemResources();
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
    await inference.loadModel(tag);
    // Update runtime config so queries use this model
    runtimeChatConfig.model = tag;
    runtimeChatConfig.baseUrl = `${config.inference.chatBaseUrl}/v1`;
    saveLastModel(tag);

    // Post-load resource snapshot
    const postLoad = inference.getSystemResources();
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
    await inference.unloadModel(tag);

    // If we just unloaded the active model, switch to another loaded model or clear it
    let newActive: string | null | undefined;
    if (tag === runtimeChatConfig.model) {
      const running = await inference.listRunning();
      const otherTag = [...running.keys()].find((t) => t !== tag && t !== EMBEDDING_MODEL_TAG);
      if (otherTag) {
        runtimeChatConfig.model = otherTag;
        newActive = otherTag;
        logger.info({ newActive }, "Auto-switched active model after unload");
      } else {
        // No models loaded — clear active so user can free all RAM
        runtimeChatConfig.model = "";
        newActive = null;
        clearLastModel();
        logger.info("All chat models unloaded, active model cleared");
      }
    }

    res.json({ unloaded: true, tag, ...(newActive !== undefined && { activeModel: newActive }) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to unload model";
    logger.error({ tag, err }, "Failed to unload model");
    res.status(500).json({ error: message });
  }
});

// ─── GET /api/admin/models/active/capabilities ──────────────────────────────
// Returns the active model's capabilities (for UI feature gating).

modelsRouter.get("/active/capabilities", (_req, res) => {
  const tag = runtimeChatConfig.model;
  const catalogEntry = MODEL_CATALOG_MAP.get(tag);
  const capabilities: ModelCapabilities = catalogEntry?.capabilities ?? { vision: false, toolUse: false, reasoning: false };
  res.json({ tag, capabilities });
});

// ─── PUT /api/admin/models/active ──────��────────────────────��────────────────
// Set the active (default) chat model. Does NOT load it into RAM — just sets
// which model to use for queries.

modelsRouter.put("/active", validateBody(tagSchema), (req, res) => {
  const { tag } = req.body as z.infer<typeof tagSchema>;
  runtimeChatConfig.model = tag;
  runtimeChatConfig.baseUrl = `${config.inference.chatBaseUrl}/v1`;
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
    await inference.deleteModel(tag);

    // If the deleted model was active, switch to another
    if (tag === runtimeChatConfig.model) {
      try {
        const installed = await inference.listInstalled();
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
