import { Router } from "express";
import type { Router as IRouter } from "express";
import { requireAdmin } from "../middleware/auth.js";
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

/**
 * GET /api/audit
 * Query audit log with optional filters.
 */
auditRouter.get("/", (req, res) => {
  const filters = {
    startDate: req.query["startDate"] as string | undefined,
    endDate: req.query["endDate"] as string | undefined,
    eventType: req.query["eventType"] as AuditEventType | undefined,
    actorEmail: req.query["actorEmail"] as string | undefined,
    resourceType: req.query["resourceType"] as string | undefined,
    resourceId: req.query["resourceId"] as string | undefined,
    limit: req.query["limit"] ? parseInt(req.query["limit"] as string, 10) : 100,
    offset: req.query["offset"] ? parseInt(req.query["offset"] as string, 10) : 0,
  };

  const result = queryAuditLog(filters);
  res.json(result);
});

/**
 * GET /api/audit/stats
 * Summary stats (event counts by type).
 */
auditRouter.get("/stats", (req, res) => {
  const since = req.query["since"] as string | undefined;
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
auditRouter.get("/export", (req, res) => {
  const format = (req.query["format"] as string) ?? "csv";
  const filters = {
    startDate: req.query["startDate"] as string | undefined,
    endDate: req.query["endDate"] as string | undefined,
    eventType: req.query["eventType"] as AuditEventType | undefined,
    actorEmail: req.query["actorEmail"] as string | undefined,
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
