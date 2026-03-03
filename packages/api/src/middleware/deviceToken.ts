import type { Request, Response, NextFunction } from "express";

/**
 * Middleware: validate anonymous device token on employee routes.
 *
 * Tokens are stored in a simple in-memory map for MVP.
 * V2: move to SQLite persistence.
 *
 * Token format: UUID sent in Authorization header as "Bearer <token>"
 */

const activeTokens = new Map<string, { issuedAt: Date; lastSeenAt: Date; isRevoked: boolean }>();

export function issueToken(): string {
  const { randomUUID } = require("crypto") as typeof import("crypto");
  const id = randomUUID();
  activeTokens.set(id, { issuedAt: new Date(), lastSeenAt: new Date(), isRevoked: false });
  return id;
}

export function revokeToken(id: string): boolean {
  const token = activeTokens.get(id);
  if (!token) return false;
  token.isRevoked = true;
  return true;
}

export function listTokens() {
  return Array.from(activeTokens.entries()).map(([id, data]) => ({ id, ...data }));
}

export function requireDeviceToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing device token" });
    return;
  }

  const token = authHeader.slice(7);
  const record = activeTokens.get(token);

  if (!record) {
    res.status(401).json({ error: "Invalid device token" });
    return;
  }

  if (record.isRevoked) {
    res.status(401).json({ error: "Device token has been revoked" });
    return;
  }

  record.lastSeenAt = new Date();
  next();
}
