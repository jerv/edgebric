import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import multer from "multer";
import sharp from "sharp";

import { requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { getOrg, updateOrg } from "../services/orgStore.js";
import { config } from "../config.js";
import {
  listUsers,
  inviteUser,
  updateUserRole,
  updateUserPermissions,
  removeUser,
  getUserInOrg,
  getUser,
} from "../services/userStore.js";

export const orgRouter: IRouter = Router();

orgRouter.use(requireAdmin);

// GET /api/admin/org — get organization details
orgRouter.get("/", (req, res) => {
  const org = getOrg(req.session.orgId!);
  if (!org) {
    res.status(404).json({ error: "No organization found" });
    return;
  }
  res.json(org);
});

const updateOrgSchema = z.object({
  name: z.string().min(1, "Organization name is required").max(200),
});

// PUT /api/admin/org — update organization name
orgRouter.put("/", validateBody(updateOrgSchema), (req, res) => {
  const org = getOrg(req.session.orgId!);
  if (!org) {
    res.status(404).json({ error: "No organization found" });
    return;
  }
  const { name } = req.body as z.infer<typeof updateOrgSchema>;
  const updated = updateOrg(org.id, { name: name.trim() });
  res.json(updated);
});

// POST /api/admin/org/complete-onboarding — mark onboarding as done
orgRouter.post("/complete-onboarding", (req, res) => {
  const org = getOrg(req.session.orgId!);
  if (!org) {
    res.status(404).json({ error: "No organization found" });
    return;
  }
  const updated = updateOrg(org.id, {
    settings: { ...org.settings, onboardingComplete: true },
  });
  res.json(updated);
});

// ─── Avatar Upload ────────────────────────────────────────────────────────

const avatarDir = path.join(config.dataDir, "avatars");

const avatarUpload = multer({
  dest: path.join(config.dataDir, "uploads"),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported image type: ${ext}`));
  },
});

// POST /api/admin/org/avatar — upload org avatar
orgRouter.post("/avatar", avatarUpload.single("avatar"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const org = getOrg(req.session.orgId!);
  if (!org) {
    res.status(404).json({ error: "No organization found" });
    return;
  }

  try {
    await fs.mkdir(avatarDir, { recursive: true });
    const filename = `org-${org.id}.png`;
    const destPath = path.join(avatarDir, filename);

    // Resize and convert to PNG
    await sharp(req.file.path)
      .resize(256, 256, { fit: "cover" })
      .png()
      .toFile(destPath);

    // Clean up temp upload
    await fs.unlink(req.file.path).catch(() => {});

    const avatarUrl = `/api/avatars/${filename}`;
    updateOrg(org.id, { settings: { ...org.settings, avatarUrl } });

    res.json({ avatarUrl });
  } catch {
    await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: "Failed to process image" });
  }
});

// DELETE /api/admin/org/avatar — remove org avatar
orgRouter.delete("/avatar", (req, res) => {
  const org = getOrg(req.session.orgId!);
  if (!org) {
    res.status(404).json({ error: "No organization found" });
    return;
  }

  const { avatarUrl, ...restSettings } = org.settings;
  updateOrg(org.id, { settings: restSettings });

  // Delete file (best effort)
  if (avatarUrl) {
    const filename = avatarUrl.split("/").pop();
    if (filename) void fs.unlink(path.join(avatarDir, filename)).catch(() => {});
  }

  res.json({ ok: true });
});

// PUT /api/admin/org/avatar-settings — update avatar mode
const avatarSettingsSchema = z.object({
  avatarMode: z.enum(["org", "kb"]),
});

orgRouter.put("/avatar-settings", validateBody(avatarSettingsSchema), (req, res) => {
  const org = getOrg(req.session.orgId!);
  if (!org) {
    res.status(404).json({ error: "No organization found" });
    return;
  }
  const { avatarMode } = req.body as z.infer<typeof avatarSettingsSchema>;
  const updated = updateOrg(org.id, { settings: { ...org.settings, avatarMode } });
  res.json(updated);
});

// ─── User Management ──────────────────────────────────────────────────────

// GET /api/admin/org/members — list all users in the org
orgRouter.get("/members", (req, res) => {
  const members = listUsers(req.session.orgId!);
  res.json(members);
});

const inviteSchema = z.object({
  email: z.string().email("Valid email required"),
  role: z.enum(["admin", "member"]).default("member"),
});

// POST /api/admin/org/members/invite — invite a user by email
orgRouter.post("/members/invite", validateBody(inviteSchema), (req, res) => {
  const orgId = req.session.orgId!;
  const { email, role } = req.body as z.infer<typeof inviteSchema>;
  const adminEmail = req.session.email ?? "unknown";

  // Check if user already exists in this org
  const existing = getUserInOrg(email, orgId);
  if (existing) {
    res.status(409).json({ error: "User already exists in this organization", user: existing });
    return;
  }

  const user = inviteUser({
    email,
    role,
    orgId,
    invitedBy: adminEmail,
  });
  res.status(201).json(user);
});

const updateRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

// PATCH /api/admin/org/members/:id/role — update a user's role
orgRouter.patch("/members/:id/role", validateBody(updateRoleSchema), (req, res) => {
  const userId = req.params["id"] as string;
  const { role } = req.body as z.infer<typeof updateRoleSchema>;
  const orgId = req.session.orgId!;

  // Prevent admin from changing their own role
  const adminEmail = req.session.email;
  const adminUser = getUserInOrg(adminEmail ?? "", orgId);
  if (adminUser && adminUser.id === userId) {
    res.status(400).json({ error: "You cannot change your own role" });
    return;
  }

  // Verify target user belongs to this org
  const targetUser = getUser(userId);
  if (!targetUser || targetUser.orgId !== orgId) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const updated = updateUserRole(userId, role);
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(updated);
});

// DELETE /api/admin/org/members/:id — remove a user from the org
orgRouter.delete("/members/:id", (req, res) => {
  const userId = req.params["id"] as string;
  const orgId = req.session.orgId!;

  // Prevent admin from removing themselves
  const adminEmail = req.session.email;
  const adminUser = getUserInOrg(adminEmail ?? "", orgId);
  if (adminUser && adminUser.id === userId) {
    res.status(400).json({ error: "You cannot remove yourself" });
    return;
  }

  // Verify target user belongs to this org
  const targetUser = getUser(userId);
  if (!targetUser || targetUser.orgId !== orgId) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const removed = removeUser(userId);
  if (!removed) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ ok: true });
});

// ─── Permissions ──────────────────────────────────────────────────────────

const updatePermissionsSchema = z.object({
  canCreateKBs: z.boolean().optional(),
});

// PATCH /api/admin/org/members/:id/permissions — update a user's permissions
orgRouter.patch("/members/:id/permissions", validateBody(updatePermissionsSchema), (req, res) => {
  const userId = req.params["id"] as string;
  const orgId = req.session.orgId!;
  const perms = req.body as z.infer<typeof updatePermissionsSchema>;

  // Verify target user belongs to this org
  const targetUser = getUser(userId);
  if (!targetUser || targetUser.orgId !== orgId) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const updated = updateUserPermissions(userId, perms);
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(updated);
});
