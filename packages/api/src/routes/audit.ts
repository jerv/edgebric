import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validate.js";
import {
  queryAuditLog,
  exportAuditLogCSV,
  verifyAuditChain,
  getAuditStats,
  recordAuditEvent,
  type AuditEventType,
} from "../services/auditLog.js";

export const auditRouter: IRouter = Router();

// All audit routes are admin-only
auditRouter.use(requireAdmin);

const auditQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  eventType: z.string().optional(),
  actorEmail: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/**
 * GET /api/audit
 * Query audit log with optional filters.
 */
auditRouter.get("/", validateQuery(auditQuerySchema), (req, res) => {
  const parsed = auditQuerySchema.parse(req.query);
  const filters = {
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    eventType: parsed.eventType as AuditEventType | undefined,
    actorEmail: parsed.actorEmail,
    resourceType: parsed.resourceType,
    resourceId: parsed.resourceId,
    limit: parsed.limit,
    offset: parsed.offset,
  };

  const result = queryAuditLog(filters);
  res.json(result);
});

const statsQuerySchema = z.object({
  since: z.string().optional(),
});

/**
 * GET /api/audit/stats
 * Summary stats (event counts by type).
 */
auditRouter.get("/stats", validateQuery(statsQuerySchema), (req, res) => {
  const { since } = statsQuerySchema.parse(req.query);
  const stats = getAuditStats(since);
  res.json(stats);
});

/**
 * GET /api/audit/verify
 * Verify the integrity of the audit chain.
 */
auditRouter.get("/verify", (req, res) => {
  const result = verifyAuditChain();
  res.json(result);
});

/**
 * GET /api/audit/export
 * Export audit log as CSV (for compliance officers).
 */
const exportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).optional().default("csv"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  eventType: z.string().optional(),
  actorEmail: z.string().optional(),
});

auditRouter.get("/export", validateQuery(exportQuerySchema), (req, res) => {
  const parsed = exportQuerySchema.parse(req.query);
  const format = parsed.format;
  const filters = {
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    eventType: parsed.eventType as AuditEventType | undefined,
    actorEmail: parsed.actorEmail,
  };

  // Record that an export was performed
  recordAuditEvent({
    eventType: "export.audit_log",
    actorEmail: req.session.email,
    actorIp: req.ip,
    details: { format, filters },
  });

  if (format === "json") {
    const { entries } = queryAuditLog({ ...filters, limit: 1_000_000 });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="edgebric-audit-log.json"`);
    res.json(entries);
  } else {
    const csv = exportAuditLogCSV(filters);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="edgebric-audit-log.csv"`);
    res.send(csv);
  }
});
