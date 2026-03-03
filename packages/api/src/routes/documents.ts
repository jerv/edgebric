import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { requireAdmin } from "../middleware/adminAuth.js";
import { config } from "../config.js";
import type { Document } from "@edgebric/types";

export const documentsRouter = Router();
documentsRouter.use(requireAdmin);

// In-memory document store (MVP — replace with SQLite in V2)
const documents = new Map<string, Document>();

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
  const docs = Array.from(documents.values()).sort(
    (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime(),
  );
  res.json(docs);
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

  documents.set(doc.id, doc);
  res.status(202).json({ documentId: doc.id });

  // Kick off ingestion in the background (non-blocking)
  // Import dynamically to avoid circular deps at startup
  void import("../jobs/ingestDocument.js").then(({ ingestDocument }) =>
    ingestDocument(doc, documents),
  );
});

documentsRouter.get("/:id", (req, res) => {
  const doc = documents.get(req.params["id"] ?? "");
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(doc);
});

documentsRouter.delete("/:id", async (req, res) => {
  const doc = documents.get(req.params["id"] ?? "");
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  // Remove from store and disk
  documents.delete(doc.id);
  try {
    await fs.unlink(doc.storageKey);
  } catch {
    // File may already be gone
  }

  res.status(204).send();
});
