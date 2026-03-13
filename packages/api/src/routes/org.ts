import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { getOrg, updateOrg } from "../services/orgStore.js";
import {
  listUsers,
  inviteUser,
  updateUserRole,
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
