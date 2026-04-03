/**
 * API Key Management Routes
 *
 * Mount at /api/admin/api-keys (session auth, admin only).
 * CRUD for API keys used by agents and integrations.
 */
import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { createApiKey, listApiKeys, revokeApiKey, getApiKey } from "../services/apiKeyStore.js";
import { recordAuditEvent } from "../services/auditLog.js";

export const apiKeysRouter: IRouter = Router();

// All routes require admin auth
apiKeysRouter.use(requireAdmin);

const createKeySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  permission: z.enum(["read", "read-write", "admin"]),
  sourceScope: z.union([
    z.literal("all"),
    z.array(z.string().uuid()).min(1),
  ]).default("all"),
  rateLimit: z.number().int().min(1).max(10000).optional(),
});

/**
 * POST /api/admin/api-keys
 * Create a new API key. Returns the raw key ONCE.
 */
apiKeysRouter.post("/", validateBody(createKeySchema), (req, res) => {
  const { name, permission, sourceScope, rateLimit } = req.body;
  const orgId = req.session.orgId!;
  const createdBy = req.session.email!;

  const scopeStr = Array.isArray(sourceScope) ? JSON.stringify(sourceScope) : "all";

  const keyWithRaw = createApiKey({
    name,
    orgId,
    permission,
    sourceScope: scopeStr,
    rateLimit,
    createdBy,
  });

  recordAuditEvent({
    eventType: "api.key_created",
    actorEmail: createdBy,
    actorIp: req.ip,
    resourceType: "api_key",
    resourceId: keyWithRaw.id,
    details: { name, permission, sourceScope: scopeStr },
  });

  res.status(201).json({
    id: keyWithRaw.id,
    name: keyWithRaw.name,
    permission: keyWithRaw.permission,
    sourceScope: keyWithRaw.sourceScope,
    rateLimit: keyWithRaw.rateLimit,
    createdAt: keyWithRaw.createdAt,
    rawKey: keyWithRaw.rawKey,
  });
});

/**
 * GET /api/admin/api-keys
 * List all API keys for the current org. Never returns hashes.
 */
apiKeysRouter.get("/", (req, res) => {
  const orgId = req.session.orgId!;
  const keys = listApiKeys(orgId);

  res.json(
    keys.map((k) => ({
      id: k.id,
      name: k.name,
      permission: k.permission,
      sourceScope: k.sourceScope,
      rateLimit: k.rateLimit,
      createdBy: k.createdBy,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revoked: k.revoked,
    })),
  );
});

/**
 * DELETE /api/admin/api-keys/:id
 * Revoke an API key (set revoked=1, instant effect).
 */
apiKeysRouter.delete("/:id", (req, res) => {
  const { id } = req.params;
  const orgId = req.session.orgId!;

  // Verify key belongs to this org
  const key = getApiKey(id);
  if (!key || key.orgId !== orgId) {
    res.status(404).json({ error: "API key not found" });
    return;
  }

  revokeApiKey(id);

  recordAuditEvent({
    eventType: "api.key_revoked",
    actorEmail: req.session.email!,
    actorIp: req.ip,
    resourceType: "api_key",
    resourceId: id,
    details: { name: key.name },
  });

  res.json({ revoked: true });
});
