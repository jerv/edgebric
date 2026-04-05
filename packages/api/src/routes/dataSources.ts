import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import multer from "multer";
import { requireOrg, requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  createDataSource,
  getDataSource,
  dataSourceBelongsToOrg,
  listAccessibleDataSources,
  updateDataSource,
  archiveDataSource,
  refreshDocumentCount,
  getDataSourceAccessList,
  setDataSourceAccessList,
} from "../services/dataSourceStore.js";
import { getDocumentsByDataSource, setDocument } from "../services/documentStore.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import { getUserInOrg, getUserByEmail } from "../services/userStore.js";
import { clearChunksForDataset, getChunksForDataset } from "../services/chunkRegistry.js";
import { getSqlite } from "../db/index.js";
import { getRebuildsInProgress } from "../jobs/rebuildDataset.js";
import { revokeSharesForDataSource, revokeSharesForRemovedUsers } from "../services/groupChatStore.js";
import { config } from "../config.js";
import { encryptFile } from "../lib/crypto.js";
import { recordAuditEvent } from "../services/auditLog.js";
import type { Document, DataSourceAccessMode } from "@edgebric/types";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";


// ─── Schemas ──────────────────────────────────────────────────────────────────

const createDataSourceSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(1000).optional(),
  type: z.enum(["organization", "personal"]).optional().default("organization"),
  accessMode: z.enum(["all", "restricted"]).optional(),
  accessList: z.array(z.string().email()).optional(),
});

const updateDataSourceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  type: z.enum(["organization", "personal"]).optional(),
  accessMode: z.enum(["all", "restricted"]).optional(),
  accessList: z.array(z.string().email()).optional(),
  allowSourceViewing: z.boolean().optional(),
  allowVaultSync: z.boolean().optional(),
  piiMode: z.enum(["off", "warn", "block"]).optional(),
});

// ─── Data Source Routes ──────────────────────────────────────────────────────

export const dataSourcesRouter: IRouter = Router();

// List data sources — filters by access for non-admin users
dataSourcesRouter.get("/", requireOrg, (req, res) => {
  const email = req.session.email ?? "";
  const isAdmin = req.session.isAdmin ?? false;
  const dataSources = listAccessibleDataSources(email, isAdmin, req.session.orgId);

  // Enrich with owner display names + rebuild status
  const ownerCache = new Map<string, string>();
  const rebuilds = getRebuildsInProgress();
  const enriched = dataSources.map((ds) => {
    if (!ownerCache.has(ds.ownerId)) {
      const ownerUser = getUserByEmail(ds.ownerId);
      ownerCache.set(ds.ownerId, ownerUser?.name ?? "");
    }
    const ownerName = ownerCache.get(ds.ownerId);
    return {
      ...ds,
      ...(ownerName && { ownerName }),
      rebuilding: rebuilds.has(ds.datasetName),
    };
  });

  res.json(enriched);
});

// Create data source — admins or members with canCreateDataSources permission
dataSourcesRouter.post("/", requireOrg, validateBody(createDataSourceSchema), (req, res) => {
  const isAdmin = req.session.isAdmin ?? false;
  const email = req.session.email ?? "";
  const orgId = req.session.orgId;

  // Check permission: admin always can, members need canCreateDataSources
  if (!isAdmin) {
    const userRecord = orgId ? getUserInOrg(email, orgId) : undefined;
    if (!userRecord?.canCreateDataSources) {
      res.status(403).json({ error: "You do not have permission to create sources" });
      return;
    }
  }

  const { name, description, type, accessMode, accessList } = req.body as z.infer<typeof createDataSourceSchema>;
  const desc = description?.trim();
  const ds = createDataSource({
    name: name.trim(),
    ...(desc && { description: desc }),
    type,
    ownerId: email,
    ...(orgId && { orgId }),
  });

  // Apply access settings if provided
  if (accessMode && accessMode !== "all") {
    updateDataSource(ds.id, { accessMode: accessMode as DataSourceAccessMode });
  }
  if (accessList && accessList.length > 0) {
    setDataSourceAccessList(ds.id, accessList);
  }

  recordAuditEvent({
    eventType: "data_source.create",
    actorEmail: email,
    actorIp: req.ip,
    resourceType: "data_source",
    resourceId: ds.id,
    details: { name: ds.name, accessMode: accessMode ?? "all" },
  });

  const final = getDataSource(ds.id)!;
  res.status(201).json({ ...final, accessList: accessList ?? [] });
});

// PII summary — accessible to any org member (for sidebar badge + source card warnings)
// Must be registered BEFORE /:id to avoid Express matching "pii-summary" as an :id param
dataSourcesRouter.get("/pii-summary", requireOrg, (_req, res) => {
  const sqlite = getSqlite();
  const rows = sqlite.prepare(`
    SELECT data_source_id, COUNT(*) as count
    FROM documents
    WHERE pii_warnings IS NOT NULL AND pii_warnings != '[]' AND data_source_id IS NOT NULL
    GROUP BY data_source_id
  `).all() as Array<{ data_source_id: string; count: number }>;

  const summary: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    summary[row.data_source_id] = row.count;
    total += row.count;
  }
  res.json({ summary, total });
});

// GET /:id — any org member can view data source details (read-only)
dataSourcesRouter.get("/:id", requireOrg, (req, res) => {
  const dsId = req.params["id"] as string;
  if (req.session.orgId && !dataSourceBelongsToOrg(dsId, req.session.orgId)) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }
  const ds = getDataSource(dsId);
  if (!ds) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }
  const docs = getDocumentsByDataSource(ds.id);

  // Compute staleness
  const cfg = getIntegrationConfig();
  const thresholdDays = cfg.stalenessThresholdDays ?? 180;
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const enrichedDocs = docs.map((doc) => ({
    ...doc,
    isStale: now - new Date(doc.updatedAt).getTime() > thresholdMs,
  }));

  // Include access list for restricted data sources (admin only)
  const isAdmin = req.session.isAdmin ?? false;
  const accessList = isAdmin && ds.accessMode === "restricted" ? getDataSourceAccessList(ds.id) : [];

  const rebuilds = getRebuildsInProgress();
  res.json({ ...ds, documents: enrichedDocs, accessList, rebuilding: rebuilds.has(ds.datasetName) });
});

// Everything below is admin-only
dataSourcesRouter.use(requireAdmin);

dataSourcesRouter.put("/:id", validateBody(updateDataSourceSchema), (req, res) => {
  const dsId = req.params["id"] as string;
  if (req.session.orgId && !dataSourceBelongsToOrg(dsId, req.session.orgId)) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }
  const { name, description, type, accessMode, accessList, allowSourceViewing, allowVaultSync, piiMode } = req.body as z.infer<typeof updateDataSourceSchema>;

  // Only the owner or an admin can change source type
  if (type !== undefined) {
    const existing = getDataSource(dsId);
    if (existing && !req.session.isAdmin && existing.ownerId.toLowerCase() !== (req.session.email ?? "").toLowerCase()) {
      res.status(403).json({ error: "Only the source owner or an admin can change source type" });
      return;
    }
  }

  const updated = updateDataSource(dsId, {
    ...(name !== undefined && { name: name.trim() }),
    ...(description !== undefined && { description: description.trim() }),
    ...(type !== undefined && { type }),
    ...(accessMode !== undefined && { accessMode: accessMode as DataSourceAccessMode }),
    ...(allowSourceViewing !== undefined && { allowSourceViewing }),
    ...(allowVaultSync !== undefined && { allowVaultSync }),
    ...(piiMode !== undefined && { piiMode }),
  });
  if (!updated) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }

  // Update access list if provided
  if (accessList !== undefined) {
    setDataSourceAccessList(updated.id, accessList);
  }

  // Revoke group chat shares when access changes
  if (accessMode === "restricted") {
    // Only sharers on the access list can keep their shares
    const currentList = getDataSourceAccessList(updated.id);
    const allowedEmails = new Set(currentList.map((e) => e.toLowerCase()));
    revokeSharesForRemovedUsers(updated.id, allowedEmails);
  }

  res.json({ ...updated, accessList: getDataSourceAccessList(updated.id) });
});

dataSourcesRouter.delete("/:id", async (req, res) => {
  const dsId = req.params["id"] as string;
  if (req.session.orgId && !dataSourceBelongsToOrg(dsId, req.session.orgId)) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }
  const ds = getDataSource(dsId);
  if (!ds) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }

  recordAuditEvent({
    eventType: "data_source.archive",
    actorEmail: req.session.email,
    actorIp: req.ip,
    resourceType: "data_source",
    resourceId: ds.id,
    details: { name: ds.name },
  });
  archiveDataSource(ds.id);

  // Revoke all group chat shares for this data source
  revokeSharesForDataSource(ds.id, "the data source was deleted");

  // Clear all chunk registry entries (metadata + FTS5 + vectors)
  clearChunksForDataset(ds.datasetName);

  res.json({ ok: true });
});

// ─── Upload document to specific data source ────────────────────────────────

const MAGIC_EXT_MAP: Record<string, Document["type"]> = { pdf: "pdf", docx: "docx" };
const TEXT_EXTENSIONS = new Set(["txt", "md"]);

const upload = multer({
  dest: path.join(config.dataDir, "uploads"),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".docx", ".txt", ".md"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}`));
    }
  },
});

dataSourcesRouter.post("/:id/documents/upload", upload.single("file"), async (req, res) => {
  const dsId = req.params["id"] as string;
  if (req.session.orgId && !dataSourceBelongsToOrg(dsId, req.session.orgId)) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }
  const ds = getDataSource(dsId);
  if (!ds) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  // Magic bytes validation
  const claimedExt = path.extname(req.file.originalname).toLowerCase().slice(1);
  const header = Buffer.alloc(4100);
  const fd = await fs.open(req.file.path, "r");
  try { await fd.read(header, 0, 4100, 0); } finally { await fd.close(); }
  const detected = await fileTypeFromBuffer(header);

  let fileType: Document["type"] = claimedExt as Document["type"];
  if (detected) {
    const canonical = MAGIC_EXT_MAP[detected.ext];
    if (canonical) {
      if (canonical !== claimedExt) {
        await fs.unlink(req.file.path).catch(() => {});
        res.status(400).json({
          error: "File type mismatch",
          details: `Extension is .${claimedExt} but content is ${detected.mime}`,
        });
        return;
      }
      fileType = canonical;
    }
  } else if (!TEXT_EXTENSIONS.has(claimedExt)) {
    await fs.unlink(req.file.path).catch(() => {});
    res.status(400).json({ error: "File type mismatch" });
    return;
  }

  // Encrypt the uploaded file at rest
  encryptFile(req.file.path);

  const doc: Document = {
    id: randomUUID(),
    name: req.file.originalname,
    type: fileType,
    classification: "policy",
    uploadedAt: new Date(),
    updatedAt: new Date(),
    status: "processing",
    sectionHeadings: [],
    storageKey: req.file.path,
    dataSourceId: ds.id,
  };

  setDocument(doc);
  refreshDocumentCount(ds.id);
  recordAuditEvent({
    eventType: "document.upload",
    actorEmail: req.session.email,
    actorIp: req.ip,
    resourceType: "document",
    resourceId: doc.id,
    details: { name: doc.name, type: doc.type, dsId: ds.id, dsName: ds.name },
  });
  res.status(202).json({ documentId: doc.id, dataSourceId: ds.id });

  // Kick off ingestion with data source-scoped dataset name
  void import("../jobs/ingestDocument.js").then(({ ingestDocument }) =>
    ingestDocument(doc, { datasetName: ds.datasetName, piiMode: ds.piiMode }),
  );
});

// ─── Data Source Avatar Upload ───────────────────────────────────────────────

const avatarUpload = multer({
  dest: path.join(config.dataDir, "uploads"),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported image type: ${ext}`));
  },
});

// POST /:id/avatar — upload data source avatar (admin or owner with canCreateDataSources)
dataSourcesRouter.post("/:id/avatar", avatarUpload.single("avatar"), async (req, res) => {
  const dsId = req.params["id"] as string;
  if (req.session.orgId && !dataSourceBelongsToOrg(dsId, req.session.orgId)) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }
  const ds = getDataSource(dsId);
  if (!ds) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  try {
    const avatarDir = path.join(config.dataDir, "avatars");
    await fs.mkdir(avatarDir, { recursive: true });
    const filename = `ds-${ds.id}.png`;
    const destPath = path.join(avatarDir, filename);

    await sharp(req.file.path)
      .resize(256, 256, { fit: "cover" })
      .png()
      .toFile(destPath);

    await fs.unlink(req.file.path).catch(() => {});

    const avatarUrl = `/api/avatars/${filename}`;
    updateDataSource(ds.id, { avatarUrl });

    res.json({ avatarUrl });
  } catch {
    await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: "Failed to process image" });
  }
});

// DELETE /:id/avatar — remove data source avatar
dataSourcesRouter.delete("/:id/avatar", async (req, res) => {
  const dsId = req.params["id"] as string;
  if (req.session.orgId && !dataSourceBelongsToOrg(dsId, req.session.orgId)) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }
  const ds = getDataSource(dsId);
  if (!ds) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }

  if (ds.avatarUrl) {
    const filename = ds.avatarUrl.split("/").pop();
    if (filename) await fs.unlink(path.join(config.dataDir, "avatars", filename)).catch(() => {});
  }
  updateDataSource(ds.id, { avatarUrl: "" });
  res.json({ ok: true });
});

// GET /:id/health — source health metrics (admin)
dataSourcesRouter.get("/:id/health", requireOrg, (req, res) => {
  const dsId = req.params["id"] as string;
  if (req.session.orgId && !dataSourceBelongsToOrg(dsId, req.session.orgId)) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }
  const ds = getDataSource(dsId);
  if (!ds) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }

  const docs = getDocumentsByDataSource(dsId);
  const readyDocs = docs.filter((d) => d.status === "ready");
  const chunks = getChunksForDataset(ds.datasetName);

  const integrationConfig = getIntegrationConfig();
  const stalenessThresholdDays = integrationConfig.stalenessThresholdDays ?? 180;
  const stalenessDate = new Date();
  stalenessDate.setDate(stalenessDate.getDate() - stalenessThresholdDays);

  const staleDocuments = readyDocs.filter((d) => {
    const updated = d.updatedAt instanceof Date ? d.updatedAt : new Date(String(d.updatedAt));
    return updated < stalenessDate;
  });

  const updateDates = readyDocs.map((d) =>
    d.updatedAt instanceof Date ? d.updatedAt.toISOString() : String(d.updatedAt),
  ).sort();

  res.json({
    chunkCount: chunks.length,
    documentCount: readyDocs.length,
    oldestDocumentUpdatedAt: updateDates[0] ?? null,
    newestDocumentUpdatedAt: updateDates[updateDates.length - 1] ?? null,
    staleDocumentCount: staleDocuments.length,
    averageChunksPerDocument: readyDocs.length > 0
      ? Math.round((chunks.length / readyDocs.length) * 10) / 10
      : 0,
    stalenessThresholdDays,
  });
});
