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
  createKB,
  getKB,
  kbBelongsToOrg,
  listAccessibleKBs,
  updateKB,
  archiveKB,
  refreshDocumentCount,
  getKBAccessList,
  setKBAccessList,
} from "../services/knowledgeBaseStore.js";
import { getDocumentsByKB, setDocument } from "../services/documentStore.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import { getUserInOrg, getUserByEmail } from "../services/userStore.js";
import { config } from "../config.js";
import type { Document, KBAccessMode } from "@edgebric/types";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";


// ─── Schemas ──────────────────────────────────────────────────────────────────

const createKBSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(1000).optional(),
  accessMode: z.enum(["all", "restricted"]).optional(),
  accessList: z.array(z.string().email()).optional(),
});

const updateKBSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  accessMode: z.enum(["all", "restricted"]).optional(),
  accessList: z.array(z.string().email()).optional(),
});

// ─── KB Routes ──────────────────────────────────────────────────────────────

export const knowledgeBasesRouter: IRouter = Router();

// List KBs — filters by access for non-admin users
knowledgeBasesRouter.get("/", requireOrg, (req, res) => {
  const email = req.session.email ?? "";
  const isAdmin = req.session.isAdmin ?? false;
  const kbs = listAccessibleKBs(email, isAdmin, req.session.orgId);

  // Enrich with owner display names
  const ownerCache = new Map<string, string>();
  const enriched = kbs.map((kb) => {
    if (!ownerCache.has(kb.ownerId)) {
      const ownerUser = getUserByEmail(kb.ownerId);
      ownerCache.set(kb.ownerId, ownerUser?.name ?? "");
    }
    const ownerName = ownerCache.get(kb.ownerId);
    return ownerName ? { ...kb, ownerName } : kb;
  });

  res.json(enriched);
});

// Create KB — admins or members with canCreateKBs permission
knowledgeBasesRouter.post("/", requireOrg, validateBody(createKBSchema), (req, res) => {
  const isAdmin = req.session.isAdmin ?? false;
  const email = req.session.email ?? "";
  const orgId = req.session.orgId;

  // Check permission: admin always can, members need canCreateKBs
  if (!isAdmin) {
    const userRecord = orgId ? getUserInOrg(email, orgId) : undefined;
    if (!userRecord?.canCreateKBs) {
      res.status(403).json({ error: "You do not have permission to create knowledge bases" });
      return;
    }
  }

  const { name, description, accessMode, accessList } = req.body as z.infer<typeof createKBSchema>;
  const desc = description?.trim();
  const kb = createKB({
    name: name.trim(),
    ...(desc && { description: desc }),
    type: "organization",
    ownerId: email,
    ...(orgId && { orgId }),
  });

  // Apply access settings if provided
  if (accessMode && accessMode !== "all") {
    updateKB(kb.id, { accessMode: accessMode as KBAccessMode });
  }
  if (accessList && accessList.length > 0) {
    setKBAccessList(kb.id, accessList);
  }

  const final = getKB(kb.id)!;
  res.status(201).json({ ...final, accessList: accessList ?? [] });
});

// GET /:id — any org member can view KB details (read-only)
knowledgeBasesRouter.get("/:id", requireOrg, (req, res) => {
  const kbId = req.params["id"] as string;
  if (req.session.orgId && !kbBelongsToOrg(kbId, req.session.orgId)) {
    res.status(404).json({ error: "Knowledge base not found" });
    return;
  }
  const kb = getKB(kbId);
  if (!kb) {
    res.status(404).json({ error: "Knowledge base not found" });
    return;
  }
  const docs = getDocumentsByKB(kb.id);

  // Compute staleness
  const cfg = getIntegrationConfig();
  const thresholdDays = cfg.stalenessThresholdDays ?? 180;
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const enrichedDocs = docs.map((doc) => ({
    ...doc,
    isStale: now - new Date(doc.updatedAt).getTime() > thresholdMs,
  }));

  // Include access list for restricted KBs (admin only)
  const isAdmin = req.session.isAdmin ?? false;
  const accessList = isAdmin && kb.accessMode === "restricted" ? getKBAccessList(kb.id) : [];

  res.json({ ...kb, documents: enrichedDocs, accessList });
});

// Everything below is admin-only
knowledgeBasesRouter.use(requireAdmin);

knowledgeBasesRouter.put("/:id", validateBody(updateKBSchema), (req, res) => {
  const kbId = req.params["id"] as string;
  if (req.session.orgId && !kbBelongsToOrg(kbId, req.session.orgId)) {
    res.status(404).json({ error: "Knowledge base not found" });
    return;
  }
  const { name, description, accessMode, accessList } = req.body as z.infer<typeof updateKBSchema>;
  const updated = updateKB(kbId, {
    ...(name !== undefined && { name: name.trim() }),
    ...(description !== undefined && { description: description.trim() }),
    ...(accessMode !== undefined && { accessMode: accessMode as KBAccessMode }),
  });
  if (!updated) {
    res.status(404).json({ error: "Knowledge base not found" });
    return;
  }

  // Update access list if provided
  if (accessList !== undefined) {
    setKBAccessList(updated.id, accessList);
  }

  res.json({ ...updated, accessList: getKBAccessList(updated.id) });
});

knowledgeBasesRouter.delete("/:id", (req, res) => {
  const kbId = req.params["id"] as string;
  if (req.session.orgId && !kbBelongsToOrg(kbId, req.session.orgId)) {
    res.status(404).json({ error: "Knowledge base not found" });
    return;
  }
  const kb = getKB(kbId);
  if (!kb) {
    res.status(404).json({ error: "Knowledge base not found" });
    return;
  }
  archiveKB(kb.id);
  res.json({ ok: true });
});

// ─── Upload document to specific KB ─────────────────────────────────────────

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

knowledgeBasesRouter.post("/:id/documents/upload", upload.single("file"), async (req, res) => {
  const kbId = req.params["id"] as string;
  if (req.session.orgId && !kbBelongsToOrg(kbId, req.session.orgId)) {
    res.status(404).json({ error: "Knowledge base not found" });
    return;
  }
  const kb = getKB(kbId);
  if (!kb) {
    res.status(404).json({ error: "Knowledge base not found" });
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
    knowledgeBaseId: kb.id,
  };

  setDocument(doc);
  refreshDocumentCount(kb.id);
  res.status(202).json({ documentId: doc.id, knowledgeBaseId: kb.id });

  // Kick off ingestion with KB-scoped dataset name
  void import("../jobs/ingestDocument.js").then(({ ingestDocument }) =>
    ingestDocument(doc, { datasetName: kb.datasetName }),
  );
});

// ─── KB Avatar Upload ──────────────────────────────────────────────────────

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

// POST /:id/avatar — upload KB avatar (admin or KB owner with canCreateKBs)
knowledgeBasesRouter.post("/:id/avatar", avatarUpload.single("avatar"), async (req, res) => {
  const kbId = req.params["id"] as string;
  if (req.session.orgId && !kbBelongsToOrg(kbId, req.session.orgId)) {
    res.status(404).json({ error: "Knowledge base not found" });
    return;
  }
  const kb = getKB(kbId);
  if (!kb) {
    res.status(404).json({ error: "Knowledge base not found" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  try {
    const avatarDir = path.join(config.dataDir, "avatars");
    await fs.mkdir(avatarDir, { recursive: true });
    const filename = `kb-${kb.id}.png`;
    const destPath = path.join(avatarDir, filename);

    await sharp(req.file.path)
      .resize(256, 256, { fit: "cover" })
      .png()
      .toFile(destPath);

    await fs.unlink(req.file.path).catch(() => {});

    const avatarUrl = `/api/avatars/${filename}`;
    updateKB(kb.id, { avatarUrl });

    res.json({ avatarUrl });
  } catch {
    await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: "Failed to process image" });
  }
});

// DELETE /:id/avatar — remove KB avatar
knowledgeBasesRouter.delete("/:id/avatar", async (req, res) => {
  const kbId = req.params["id"] as string;
  if (req.session.orgId && !kbBelongsToOrg(kbId, req.session.orgId)) {
    res.status(404).json({ error: "Knowledge base not found" });
    return;
  }
  const kb = getKB(kbId);
  if (!kb) {
    res.status(404).json({ error: "Knowledge base not found" });
    return;
  }

  if (kb.avatarUrl) {
    const filename = kb.avatarUrl.split("/").pop();
    if (filename) await fs.unlink(path.join(config.dataDir, "avatars", filename)).catch(() => {});
  }
  updateKB(kb.id, { avatarUrl: "" });
  res.json({ ok: true });
});
