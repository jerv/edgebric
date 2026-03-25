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
import { clearChunksForDataset } from "../services/chunkRegistry.js";
import { getRebuildsInProgress } from "../jobs/rebuildDataset.js";
import { revokeSharesForKB, revokeSharesForRemovedUsers } from "../services/groupChatStore.js";
import { config, runtimeEdgeConfig } from "../config.js";
import { encryptFile } from "../lib/crypto.js";
import { recordAuditEvent } from "../services/auditLog.js";
import type { Document, KBAccessMode } from "@edgebric/types";
import { createMKBClient } from "@edgebric/edge";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";


// ─── Schemas ──────────────────────────────────────────────────────────────────

const createKBSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(1000).optional(),
  type: z.enum(["organization", "personal"]).optional().default("organization"),
  accessMode: z.enum(["all", "restricted"]).optional(),
  accessList: z.array(z.string().email()).optional(),
});

const updateKBSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  type: z.enum(["organization", "personal"]).optional(),
  accessMode: z.enum(["all", "restricted"]).optional(),
  accessList: z.array(z.string().email()).optional(),
  allowSourceViewing: z.boolean().optional(),
  allowVaultSync: z.boolean().optional(),
  allowExternalAccess: z.boolean().optional(),
});

// ─── KB Routes ──────────────────────────────────────────────────────────────

export const knowledgeBasesRouter: IRouter = Router();

// List KBs — filters by access for non-admin users
knowledgeBasesRouter.get("/", requireOrg, (req, res) => {
  const email = req.session.email ?? "";
  const isAdmin = req.session.isAdmin ?? false;
  const kbs = listAccessibleKBs(email, isAdmin, req.session.orgId);

  // Enrich with owner display names + rebuild status
  const ownerCache = new Map<string, string>();
  const rebuilds = getRebuildsInProgress();
  const enriched = kbs.map((kb) => {
    if (!ownerCache.has(kb.ownerId)) {
      const ownerUser = getUserByEmail(kb.ownerId);
      ownerCache.set(kb.ownerId, ownerUser?.name ?? "");
    }
    const ownerName = ownerCache.get(kb.ownerId);
    return {
      ...kb,
      ...(ownerName && { ownerName }),
      rebuilding: rebuilds.has(kb.datasetName),
    };
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
      res.status(403).json({ error: "You do not have permission to create sources" });
      return;
    }
  }

  const { name, description, type, accessMode, accessList } = req.body as z.infer<typeof createKBSchema>;
  const desc = description?.trim();
  const kb = createKB({
    name: name.trim(),
    ...(desc && { description: desc }),
    type,
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

  recordAuditEvent({
    eventType: "kb.create",
    actorEmail: email,
    actorIp: req.ip,
    resourceType: "kb",
    resourceId: kb.id,
    details: { name: kb.name, accessMode: accessMode ?? "all" },
  });

  const final = getKB(kb.id)!;
  res.status(201).json({ ...final, accessList: accessList ?? [] });
});

// GET /:id — any org member can view KB details (read-only)
knowledgeBasesRouter.get("/:id", requireOrg, (req, res) => {
  const kbId = req.params["id"] as string;
  if (req.session.orgId && !kbBelongsToOrg(kbId, req.session.orgId)) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }
  const kb = getKB(kbId);
  if (!kb) {
    res.status(404).json({ error: "Data source not found" });
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

  const rebuilds = getRebuildsInProgress();
  res.json({ ...kb, documents: enrichedDocs, accessList, rebuilding: rebuilds.has(kb.datasetName) });
});

// Everything below is admin-only
knowledgeBasesRouter.use(requireAdmin);

knowledgeBasesRouter.put("/:id", validateBody(updateKBSchema), (req, res) => {
  const kbId = req.params["id"] as string;
  if (req.session.orgId && !kbBelongsToOrg(kbId, req.session.orgId)) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }
  const { name, description, type, accessMode, accessList, allowSourceViewing, allowVaultSync, allowExternalAccess } = req.body as z.infer<typeof updateKBSchema>;

  // Only the owner or an admin can change source type
  if (type !== undefined) {
    const existing = getKB(kbId);
    if (existing && !req.session.isAdmin && existing.ownerId.toLowerCase() !== (req.session.email ?? "").toLowerCase()) {
      res.status(403).json({ error: "Only the source owner or an admin can change source type" });
      return;
    }
  }

  const updated = updateKB(kbId, {
    ...(name !== undefined && { name: name.trim() }),
    ...(description !== undefined && { description: description.trim() }),
    ...(type !== undefined && { type }),
    ...(accessMode !== undefined && { accessMode: accessMode as KBAccessMode }),
    ...(allowSourceViewing !== undefined && { allowSourceViewing }),
    ...(allowVaultSync !== undefined && { allowVaultSync }),
    ...(allowExternalAccess !== undefined && { allowExternalAccess }),
  });
  if (!updated) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }

  // Update access list if provided
  if (accessList !== undefined) {
    setKBAccessList(updated.id, accessList);
  }

  // Revoke group chat shares when access changes
  if (accessMode === "restricted") {
    // Only sharers on the access list can keep their shares
    const currentList = getKBAccessList(updated.id);
    const allowedEmails = new Set(currentList.map((e) => e.toLowerCase()));
    revokeSharesForRemovedUsers(updated.id, allowedEmails);
  }

  res.json({ ...updated, accessList: getKBAccessList(updated.id) });
});

knowledgeBasesRouter.delete("/:id", async (req, res) => {
  const kbId = req.params["id"] as string;
  if (req.session.orgId && !kbBelongsToOrg(kbId, req.session.orgId)) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }
  const kb = getKB(kbId);
  if (!kb) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }

  recordAuditEvent({
    eventType: "kb.archive",
    actorEmail: req.session.email,
    actorIp: req.ip,
    resourceType: "kb",
    resourceId: kb.id,
    details: { name: kb.name },
  });
  archiveKB(kb.id);

  // Revoke all group chat shares for this KB
  revokeSharesForKB(kb.id, "the data source was deleted");

  // Nuke the mKB dataset and all registry entries — no stale data survives
  clearChunksForDataset(kb.datasetName);
  const mkb = createMKBClient(runtimeEdgeConfig);
  void mkb.deleteDataset(kb.datasetName).catch(() => {
    // Dataset may not exist if no documents were ever ingested
  });

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
    res.status(404).json({ error: "Data source not found" });
    return;
  }
  const kb = getKB(kbId);
  if (!kb) {
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
    knowledgeBaseId: kb.id,
  };

  setDocument(doc);
  refreshDocumentCount(kb.id);
  recordAuditEvent({
    eventType: "document.upload",
    actorEmail: req.session.email,
    actorIp: req.ip,
    resourceType: "document",
    resourceId: doc.id,
    details: { name: doc.name, type: doc.type, kbId: kb.id, kbName: kb.name },
  });
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
    res.status(404).json({ error: "Data source not found" });
    return;
  }
  const kb = getKB(kbId);
  if (!kb) {
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
    res.status(404).json({ error: "Data source not found" });
    return;
  }
  const kb = getKB(kbId);
  if (!kb) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }

  if (kb.avatarUrl) {
    const filename = kb.avatarUrl.split("/").pop();
    if (filename) await fs.unlink(path.join(config.dataDir, "avatars", filename)).catch(() => {});
  }
  updateKB(kb.id, { avatarUrl: "" });
  res.json({ ok: true });
});
