import { Router } from "express";
import type { Router as IRouter } from "express";
import { createHash } from "crypto";
import { requireAuth } from "../middleware/auth.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import { getAllChunksWithContent } from "../services/chunkRegistry.js";

export const syncRouter: IRouter = Router();

syncRouter.use(requireAuth);

// ─── GET /api/sync/version ──────────────────────────────────────────────────
// Returns a SHA-256 hash of the current chunk dataset for change detection.

syncRouter.get("/version", (_req, res) => {
  const orgConfig = getIntegrationConfig();
  if (!orgConfig.vaultModeEnabled) {
    res.status(403).json({ error: "Vault mode is not enabled" });
    return;
  }

  const allChunks = getAllChunksWithContent();
  const hash = createHash("sha256");
  for (const chunk of allChunks) {
    hash.update(chunk.chunkId);
    hash.update(chunk.content);
  }
  res.json({ version: hash.digest("hex"), chunkCount: allChunks.length });
});

// ─── GET /api/sync/chunks ───────────────────────────────────────────────────
// Streams all chunks as NDJSON for Vault Mode local sync.

syncRouter.get("/chunks", (_req, res) => {
  const orgConfig = getIntegrationConfig();
  if (!orgConfig.vaultModeEnabled) {
    res.status(403).json({ error: "Vault mode is not enabled" });
    return;
  }

  const allChunks = getAllChunksWithContent();

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");

  for (const chunk of allChunks) {
    res.write(JSON.stringify(chunk) + "\n");
  }
  res.end();
});
