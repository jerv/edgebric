import { Router } from "express";
import type { Router as IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { config } from "../config.js";
import { getAllDocuments, getDocument, setDocument, deleteDocument } from "../services/documentStore.js";
import { clearChunksForDocument, getChunksForDocument } from "../services/chunkRegistry.js";
import type { Document } from "@edgebric/types";

export const documentsRouter: IRouter = Router();

// ─── Employee-accessible: document content for source viewer ────────────────
// Must be defined BEFORE requireAdmin middleware so all authenticated users can access it.
documentsRouter.get("/:id/content", requireAuth, (req, res) => {
  const id = req.params["id"] as string ?? "";
  const doc = getDocument(id);
  const sections = getChunksForDocument(id);

  if (!doc && sections.length === 0) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  res.json({
    document: doc
      ? { id: doc.id, name: doc.name, type: doc.type }
      : { id, name: "Document", type: "unknown" },
    sections,
  });
});

// ─── Employee-accessible: raw file download ─────────────────────────────────
documentsRouter.get("/:id/file", requireAuth, async (req, res) => {
  const doc = getDocument(req.params["id"] as string ?? "");
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
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

documentsRouter.get("/", (_req, res) => {
  res.json(getAllDocuments());
});

documentsRouter.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const ext = path.extname(req.file.originalname).toLowerCase().slice(1) as Document["type"];
  const doc: Document = {
    id: randomUUID(),
    name: req.file.originalname,
    type: ext,
    classification: "policy",
    uploadedAt: new Date(),
    updatedAt: new Date(),
    status: "processing",
    sectionHeadings: [],
    storageKey: req.file.path,
  };

  setDocument(doc);
  res.status(202).json({ documentId: doc.id });

  // Kick off ingestion in the background (non-blocking)
  void import("../jobs/ingestDocument.js").then(({ ingestDocument }) =>
    ingestDocument(doc),
  );
});

documentsRouter.get("/:id", (req, res) => {
  const doc = getDocument(req.params["id"] ?? "");
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(doc);
});

documentsRouter.delete("/:id", async (req, res) => {
  const doc = getDocument(req.params["id"] ?? "");
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  deleteDocument(doc.id);
  clearChunksForDocument(doc.id);

  try {
    await fs.unlink(doc.storageKey);
  } catch {
    // File may already be gone
  }

  res.status(204).send();
});
