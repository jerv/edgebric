import { Router } from "express";
import type { Router as IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";
import { requireOrg, requireAdmin } from "../middleware/auth.js";
import { validateParams } from "../middleware/validate.js";
import { config } from "../config.js";
import { encryptFile, decryptFile } from "../lib/crypto.js";
import { recordAuditEvent } from "../services/auditLog.js";
import { getAllDocuments, getDocument, setDocument, deleteDocument, getDocumentsByOrg, documentBelongsToOrg } from "../services/documentStore.js";
import { clearChunksForDocument, getChunksForDocument } from "../services/chunkRegistry.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import { ensureDefaultDataSource, refreshDocumentCount, getDataSource, listAccessibleDataSources } from "../services/dataSourceStore.js";
import { rebuildDataset } from "../jobs/rebuildDataset.js";
import type { Document } from "@edgebric/types";

/** Map file-type detected extensions to our canonical type names */
const MAGIC_EXT_MAP: Record<string, Document["type"]> = {
  pdf: "pdf",
  docx: "docx",
};

/** Extensions that are text-based and won't be detected by file-type (magic bytes) */
const TEXT_EXTENSIONS = new Set(["txt", "md"]);

/**
 * Detect actual file type from magic bytes.
 * Returns the canonical type and whether it mismatches the claimed extension.
 */
async function detectFileType(
  filePath: string,
  claimedExt: string,
): Promise<{ type: Document["type"]; mismatch: boolean; detectedMime?: string }> {
  const header = Buffer.alloc(4100);
  const fd = await fs.open(filePath, "r");
  try {
    await fd.read(header, 0, 4100, 0);
  } finally {
    await fd.close();
  }

  const detected = await fileTypeFromBuffer(header);

  if (detected) {
    const canonicalType = MAGIC_EXT_MAP[detected.ext];
    if (canonicalType) {
      return {
        type: canonicalType,
        mismatch: canonicalType !== claimedExt,
        detectedMime: detected.mime,
      };
    }
    // Detected a binary type we don't support
    return { type: claimedExt as Document["type"], mismatch: true, detectedMime: detected.mime };
  }

  // file-type returned undefined — likely a text file
  if (TEXT_EXTENSIONS.has(claimedExt)) {
    return { type: claimedExt as Document["type"], mismatch: false };
  }

  // Extension claims binary (pdf/docx) but magic bytes say otherwise
  return { type: claimedExt as Document["type"], mismatch: true };
}

const idParamSchema = z.object({ id: z.string().uuid() });

export const documentsRouter: IRouter = Router();

// ─── Employee-accessible: document content for source viewer ────────────────
// Must be defined BEFORE requireAdmin middleware so all authenticated users can access it.
documentsRouter.get("/:id/content", requireOrg, validateParams(idParamSchema), (req, res) => {
  const id = req.params["id"] as string ?? "";

  // Org-scoping: verify document belongs to caller's org
  if (req.session.orgId && !documentBelongsToOrg(id, req.session.orgId)) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const doc = getDocument(id);
  const sections = getChunksForDocument(id);

  if (!doc && sections.length === 0) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  // Enforce per-data-source ACL — verify user has access to the document's data source
  if (doc?.dataSourceId && !req.session.isAdmin) {
    const accessible = listAccessibleDataSources(req.session.email ?? "", false, req.session.orgId);
    if (!accessible.some((a) => a.id === doc.dataSourceId)) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const ds = getDataSource(doc.dataSourceId);
    if (ds && !ds.allowSourceViewing) {
      res.status(403).json({ error: "Source document viewing is disabled for this data source" });
      return;
    }
  }

  // Audit: log document view
  if (doc) {
    recordAuditEvent({
      eventType: "document.view",
      actorEmail: req.session.email,
      actorIp: req.ip,
      resourceType: "document",
      resourceId: doc.id,
      details: { name: doc.name },
    });
  }

  res.json({
    document: doc
      ? { id: doc.id, name: doc.name, type: doc.type }
      : { id, name: "Document", type: "unknown" },
    sections,
  });
});

// ─── Employee-accessible: raw file download ─────────────────────────────────
documentsRouter.get("/:id/file", requireOrg, validateParams(idParamSchema), async (req, res) => {
  const id = req.params["id"] as string ?? "";

  // Org-scoping: verify document belongs to caller's org
  if (req.session.orgId && !documentBelongsToOrg(id, req.session.orgId)) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const doc = getDocument(id);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  // Enforce per-data-source ACL + viewing toggle — admins bypass
  if (doc.dataSourceId && !req.session.isAdmin) {
    const accessible = listAccessibleDataSources(req.session.email ?? "", false, req.session.orgId);
    if (!accessible.some((a) => a.id === doc.dataSourceId)) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const ds = getDataSource(doc.dataSourceId);
    if (ds && !ds.allowSourceViewing) {
      res.status(403).json({ error: "Source document viewing is disabled for this data source" });
      return;
    }
  }

  try {
    await fs.access(doc.storageKey);
  } catch {
    res.status(404).json({ error: "File no longer available" });
    return;
  }

  const ext = path.extname(doc.name).toLowerCase() || `.${doc.type}`;
  res.setHeader("Content-Disposition", `inline; filename="${doc.name}"`);
  const mimeTypes: Record<string, string> = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".md": "text/markdown",
  };
  res.setHeader("Content-Type", mimeTypes[ext] ?? "application/octet-stream");

  // Decrypt the file (handles both encrypted and legacy unencrypted files)
  const content = decryptFile(doc.storageKey);
  res.send(content);
});

// All remaining routes are admin-only
documentsRouter.use(requireAdmin);

const upload = multer({
  dest: path.join(config.dataDir, "uploads"),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
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

documentsRouter.get("/", (req, res) => {
  const docs = req.session.orgId ? getDocumentsByOrg(req.session.orgId) : getAllDocuments();
  const cfg = getIntegrationConfig();
  const thresholdDays = cfg.stalenessThresholdDays ?? 180;
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const enriched = docs.map((doc) => ({
    ...doc,
    isStale: now - new Date(doc.updatedAt).getTime() > thresholdMs,
  }));
  res.json(enriched);
});

documentsRouter.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const claimedExt = path.extname(req.file.originalname).toLowerCase().slice(1);
  const { type, mismatch, detectedMime } = await detectFileType(req.file.path, claimedExt);

  if (mismatch) {
    // Reject files where extension doesn't match actual content
    await fs.unlink(req.file.path).catch(() => {});
    res.status(400).json({
      error: "File type mismatch",
      details: `File extension is .${claimedExt} but content is ${detectedMime ?? "unknown/text"}. Please upload with the correct extension.`,
    });
    return;
  }

  // Encrypt the uploaded file at rest
  encryptFile(req.file.path);

  // Assign to default data source (backward compatible — old /api/documents/upload route)
  const adminEmail = req.session.email ?? "admin@edgebric.local";
  const defaultDS = ensureDefaultDataSource(adminEmail);

  const doc: Document = {
    id: randomUUID(),
    name: req.file.originalname,
    type,
    classification: "policy",
    uploadedAt: new Date(),
    updatedAt: new Date(),
    status: "processing",
    sectionHeadings: [],
    storageKey: req.file.path,
    dataSourceId: defaultDS.id,
  };

  setDocument(doc);
  refreshDocumentCount(defaultDS.id);
  recordAuditEvent({
    eventType: "document.upload",
    actorEmail: req.session.email,
    actorIp: req.ip,
    resourceType: "document",
    resourceId: doc.id,
    details: { name: doc.name, type: doc.type, dsId: defaultDS.id },
  });
  res.status(202).json({ documentId: doc.id });

  // Kick off ingestion in the background (non-blocking)
  void import("../jobs/ingestDocument.js").then(({ ingestDocument }) =>
    ingestDocument(doc, { datasetName: defaultDS.datasetName }),
  );
});

documentsRouter.get("/:id", validateParams(idParamSchema), (req, res) => {
  const id = req.params["id"] ?? "";
  if (req.session.orgId && !documentBelongsToOrg(id, req.session.orgId)) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const doc = getDocument(id);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(doc);
});

// ─── PII Review Gate ──────────────────────────────────────────────────────────

documentsRouter.post("/:id/approve-pii", async (req, res) => {
  const id = req.params["id"] ?? "";
  if (req.session.orgId && !documentBelongsToOrg(id, req.session.orgId)) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const doc = getDocument(id);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (doc.status !== "pii_review") {
    res.status(400).json({ error: `Document is not pending PII review (status: ${doc.status})` });
    return;
  }

  recordAuditEvent({
    eventType: "document.pii_approve",
    actorEmail: req.session.email,
    actorIp: req.ip,
    resourceType: "document",
    resourceId: doc.id,
    details: { name: doc.name, warningCount: doc.piiWarnings?.length ?? 0 },
  });

  // Clear PII warnings, resume ingestion
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { piiWarnings: _cleared, ...rest } = doc;
  const updated: Document = { ...rest, status: "processing", updatedAt: new Date() };
  setDocument(updated);

  // Resolve dataset name from data source if assigned
  let dsDatasetName: string | undefined;
  if (updated.dataSourceId) {
    const { getDataSource } = await import("../services/dataSourceStore.js");
    dsDatasetName = getDataSource(updated.dataSourceId)?.datasetName;
  }

  // Resume the ingestion pipeline, skipping PII detection (admin already approved)
  const opts: { skipPII: boolean; datasetName?: string } = { skipPII: true };
  if (dsDatasetName) opts.datasetName = dsDatasetName;

  void import("../jobs/ingestDocument.js").then(({ ingestDocument }) =>
    ingestDocument(updated, opts),
  );

  res.json({ status: "processing", message: "PII warnings acknowledged. Ingestion resumed." });
});

documentsRouter.post("/:id/reject-pii", async (req, res) => {
  const id = req.params["id"] ?? "";
  if (req.session.orgId && !documentBelongsToOrg(id, req.session.orgId)) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const doc = getDocument(id);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (doc.status !== "pii_review") {
    res.status(400).json({ error: `Document is not pending PII review (status: ${doc.status})` });
    return;
  }

  const rejected: Document = { ...doc, status: "rejected", updatedAt: new Date() };
  setDocument(rejected);

  // Clean up the uploaded file
  try { await fs.unlink(doc.storageKey); } catch { /* already gone */ }

  res.json({ status: "rejected", message: "Document rejected due to PII concerns." });
});

documentsRouter.delete("/:id", validateParams(idParamSchema), async (req, res) => {
  const id = req.params["id"] ?? "";
  if (req.session.orgId && !documentBelongsToOrg(id, req.session.orgId)) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const doc = getDocument(id);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  recordAuditEvent({
    eventType: "document.delete",
    actorEmail: req.session.email,
    actorIp: req.ip,
    resourceType: "document",
    resourceId: doc.id,
    details: { name: doc.name, dsId: doc.dataSourceId },
  });

  const dsId = doc.dataSourceId;
  // Resolve dataset name: doc may have it if ingested, otherwise fall back to data source
  const datasetName = doc.datasetName ?? (dsId ? getDataSource(dsId)?.datasetName : undefined);
  deleteDocument(doc.id);
  clearChunksForDocument(doc.id);

  if (dsId) refreshDocumentCount(dsId);

  try {
    await fs.unlink(doc.storageKey);
  } catch {
    // File may already be gone
  }

  // Rebuild the dataset to purge stale vectors (fire-and-forget)
  if (datasetName) {
    void rebuildDataset(datasetName);
  }

  res.status(204).send();
});
