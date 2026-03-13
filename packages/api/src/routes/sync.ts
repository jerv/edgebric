import { Router } from "express";
import type { Router as IRouter } from "express";
import { createHash } from "crypto";
import { requireOrg } from "../middleware/auth.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import { getAllChunksWithContent } from "../services/chunkRegistry.js";
import { listAccessibleKBs } from "../services/knowledgeBaseStore.js";
import { getDb } from "../db/index.js";
import { documents } from "../db/schema.js";
import { sql } from "drizzle-orm";

export const syncRouter: IRouter = Router();

syncRouter.use(requireOrg);

/**
 * Get chunks filtered to only KBs the current user can access.
 * Admins see all org chunks; non-admins see chunks from "all" KBs + KBs they're on the access list for.
 */
function getAccessibleChunks(email: string, isAdmin: boolean, orgId?: string) {
  const allChunks = getAllChunksWithContent(orgId);

  // Admins get everything in their org
  if (isAdmin) return allChunks;

  // Get accessible KB IDs for this user
  const accessibleKBs = listAccessibleKBs(email, false, orgId);
  if (accessibleKBs.length === 0) return [];

  const accessibleKBIds = new Set(accessibleKBs.map((kb) => kb.id));

  // Build set of document IDs that belong to accessible KBs
  const db = getDb();
  const accessibleDocIds = new Set<string>();
  for (const kbId of accessibleKBIds) {
    const docs = db.select({ id: documents.id }).from(documents)
      .where(sql`${documents.knowledgeBaseId} = ${kbId}`)
      .all();
    for (const doc of docs) accessibleDocIds.add(doc.id);
  }

  return allChunks.filter((c) => accessibleDocIds.has(c.metadata.sourceDocument));
}

// ─── GET /api/sync/version ──────────────────────────────────────────────────
// Returns a SHA-256 hash of the accessible chunk dataset for change detection.

syncRouter.get("/version", (req, res) => {
  const orgConfig = getIntegrationConfig();
  if (!orgConfig.vaultModeEnabled) {
    res.status(403).json({ error: "Vault mode is not enabled", revoked: true });
    return;
  }

  const email = req.session.email ?? "";
  const isAdmin = req.session.isAdmin ?? false;
  const chunks = getAccessibleChunks(email, isAdmin, req.session.orgId);

  const hash = createHash("sha256");
  for (const chunk of chunks) {
    hash.update(chunk.chunkId);
    hash.update(chunk.content);
  }
  const accessibleChunkIds = new Set(chunks.map((c) => c.chunkId));
  res.json({ version: hash.digest("hex"), chunkCount: chunks.length, revoked: false, accessibleChunkIds: [...accessibleChunkIds] });
});

// ─── GET /api/sync/chunks ───────────────────────────────────────────────────
// Streams accessible chunks as NDJSON for Vault Mode local sync.

syncRouter.get("/chunks", (req, res) => {
  const orgConfig = getIntegrationConfig();
  if (!orgConfig.vaultModeEnabled) {
    res.status(403).json({ error: "Vault mode is not enabled" });
    return;
  }

  const email = req.session.email ?? "";
  const isAdmin = req.session.isAdmin ?? false;
  const chunks = getAccessibleChunks(email, isAdmin, req.session.orgId);

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");

  for (const chunk of chunks) {
    res.write(JSON.stringify(chunk) + "\n");
  }
  res.end();
});
