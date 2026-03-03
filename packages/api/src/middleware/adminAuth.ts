import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

/**
 * Middleware: simple admin session authentication.
 *
 * MVP: single shared admin password, session token in header.
 * V2: proper session management or SSO.
 */

const { randomUUID } = await import("crypto");
const adminSessions = new Set<string>();

export function createAdminSession(password: string): string | null {
  if (password !== config.adminPassword) return null;
  const token = randomUUID();
  adminSessions.add(token);
  return token;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Admin authentication required" });
    return;
  }

  const token = authHeader.slice(7);
  if (!adminSessions.has(token)) {
    res.status(401).json({ error: "Invalid admin session" });
    return;
  }

  next();
}
