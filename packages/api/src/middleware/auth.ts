import type { Request, Response, NextFunction } from "express";

/**
 * Require an authenticated session (any role).
 * Used on query routes — employees and admins both pass.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.queryToken) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

/**
 * Require an admin session.
 * Used on document management routes.
 * 401 = not logged in (redirect to login), 403 = logged in but not admin.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.queryToken) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!req.session.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
