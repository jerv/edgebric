import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

/**
 * In solo mode (AUTH_MODE=none), auto-populate session with admin credentials
 * so all auth checks pass transparently.
 */
function ensureSoloSession(req: Request): void {
  if (config.authMode !== "none") return;
  if (!req.session.queryToken) {
    req.session.queryToken = "solo-user";
    req.session.isAdmin = true;
    req.session.email = "solo@localhost";
    req.session.name = "You";
    req.session.orgId = "solo";
    req.session.orgSlug = "solo";
  }
}

/**
 * Require an authenticated session (any role).
 * Does NOT require org selection — used for auth-level routes like /orgs, /select-org.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  ensureSoloSession(req);
  if (!req.session.queryToken || !req.session.email) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

/**
 * Require an authenticated session WITH an org selected.
 * Most data routes should use this instead of requireAuth.
 */
export function requireOrg(req: Request, res: Response, next: NextFunction): void {
  ensureSoloSession(req);
  if (!req.session.queryToken || !req.session.email) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!req.session.orgId) {
    res.status(428).json({ error: "No organization selected", code: "ORG_REQUIRED" });
    return;
  }
  next();
}

/**
 * Require an admin session with org selected.
 * 401 = not logged in, 428 = no org selected, 403 = logged in but not admin.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  ensureSoloSession(req);
  if (!req.session.queryToken || !req.session.email) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!req.session.orgId) {
    res.status(428).json({ error: "No organization selected", code: "ORG_REQUIRED" });
    return;
  }
  if (!req.session.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
