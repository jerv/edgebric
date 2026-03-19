import { Router } from "express";
import type { Router as IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { fileTypeFromBuffer } from "file-type";
import { requireOrg, requireAdmin } from "../middleware/auth.js";
import { config } from "../config.js";
import { getAllDocuments, getDocument, setDocument, deleteDocument, getDocumentsByOrg, documentBelongsToOrg } from "../services/documentStore.js";
import { clearChunksForDocument, getChunksForDocument } from "../services/chunkRegistry.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import { ensureDefaultKB, refreshDocumentCount, getKB } from "../services/knowledgeBaseStore.js";
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

export const documentsRouter: IRouter = Router();

// ─── Employee-accessible: document content for source viewer ────────────────
// Must be defined BEFORE requireAdmin middleware so all authenticated users can access it.
documentsRouter.get("/:id/content", requireOrg, (req, res) => {
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

  // Enforce per-KB source viewing toggle — admins bypass this restriction
  if (doc?.knowledgeBaseId && !req.session.isAdmin) {
    const kb = getKB(doc.knowledgeBaseId);
    if (kb && !kb.allowSourceViewing) {
      res.status(403).json({ error: "Source document viewing is disabled for this source" });
      return;
    }
  }

  res.json({
    document: doc
      ? { id: doc.id, name: doc.name, type: doc.type }
      : { id, name: "Document", type: "unknown" },
    sections,
  });
});

// ─── Employee-accessible: raw file download ─────────────────────────────────
documentsRouter.get("/:id/file", requireOrg, async (req, res) => {
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

  // Enforce per-KB source viewing toggle — admins bypass this restriction
  if (doc.knowledgeBaseId && !req.session.isAdmin) {
    const kb = getKB(doc.knowledgeBaseId);
    if (kb && !kb.allowSourceViewing) {
      res.status(403).json({ error: "Source document viewing is disabled for this source" });
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

  const { createReadStream } = await import("fs");
  createReadStream(doc.storageKey).pipe(res);
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

  // Assign to default KB (backward compatible — old /api/documents/upload route)
  const adminEmail = req.session.email ?? "admin@edgebric.local";
  const defaultKB = ensureDefaultKB(adminEmail);

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
    knowledgeBaseId: defaultKB.id,
  };

  setDocument(doc);
  refreshDocumentCount(defaultKB.id);
  res.status(202).json({ documentId: doc.id });

  // Kick off ingestion in the background (non-blocking)
  void import("../jobs/ingestDocument.js").then(({ ingestDocument }) =>
    ingestDocument(doc, { datasetName: defaultKB.datasetName }),
  );
});

documentsRouter.get("/:id", (req, res) => {
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

  // Clear PII warnings, resume ingestion
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { piiWarnings: _cleared, ...rest } = doc;
  const updated: Document = { ...rest, status: "processing", updatedAt: new Date() };
  setDocument(updated);

  // Resolve dataset name from KB if assigned
  let kbDatasetName: string | undefined;
  if (updated.knowledgeBaseId) {
    const { getKB } = await import("../services/knowledgeBaseStore.js");
    kbDatasetName = getKB(updated.knowledgeBaseId)?.datasetName;
  }

  // Resume the ingestion pipeline, skipping PII detection (admin already approved)
  const opts: { skipPII: boolean; datasetName?: string } = { skipPII: true };
  if (kbDatasetName) opts.datasetName = kbDatasetName;

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

documentsRouter.delete("/:id", async (req, res) => {
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

  const kbId = doc.knowledgeBaseId;
  deleteDocument(doc.id);
  clearChunksForDocument(doc.id);

  if (kbId) refreshDocumentCount(kbId);

  try {
    await fs.unlink(doc.storageKey);
  } catch {
    // File may already be gone
  }

  res.status(204).send();
});
