/**
 * API Key Authentication Middleware
 *
 * Authenticates requests using Bearer tokens (API keys).
 * Bypasses session/CSRF but NOT access control or safety checks.
 * Applies per-key rate limiting.
 */
import type { Request, Response, NextFunction } from "express";
import { hashKey, getApiKeyByHash, touchApiKey, parseScopeIds, type ApiKey } from "../services/apiKeyStore.js";
import { recordAuditEvent } from "../services/auditLog.js";
import { logger } from "../lib/logger.js";

// Augment Express Request with API key metadata
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ApiKey;
      apiKeySourceIds?: string[] | null; // null = all sources
    }
  }
}

// ─── Per-key Rate Limiting ──────────────────────────────────────────────────

interface RateBucket {
  timestamps: number[];
}

const rateBuckets = new Map<string, RateBucket>();

/** Prune stale entries every 5 minutes. */
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [key, bucket] of rateBuckets) {
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
    if (bucket.timestamps.length === 0) rateBuckets.delete(key);
  }
}, 300_000).unref();

function checkRateLimit(keyId: string, limit: number): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const windowStart = now - windowMs;

  let bucket = rateBuckets.get(keyId);
  if (!bucket) {
    bucket = { timestamps: [] };
    rateBuckets.set(keyId, bucket);
  }

  // Remove timestamps outside window
  bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);

  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0]!;
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, retryAfter };
  }

  bucket.timestamps.push(now);
  return { allowed: true };
}

/**
 * API key authentication middleware.
 * Extracts Bearer token from Authorization header, validates it,
 * and attaches key metadata to the request.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "API key required", code: "AUTH_REQUIRED", status: 401 });
    return;
  }

  const rawKey = authHeader.slice(7);
  if (!rawKey.startsWith("eb_")) {
    res.status(401).json({ error: "Invalid API key format", code: "INVALID_KEY", status: 401 });
    return;
  }

  const keyHash = hashKey(rawKey);
  const apiKey = getApiKeyByHash(keyHash);

  if (!apiKey) {
    res.status(401).json({ error: "Invalid or revoked API key", code: "INVALID_KEY", status: 401 });
    return;
  }

  // Per-key rate limiting — use lower limit for query endpoint
  const isQueryEndpoint = req.path.endsWith("/query");
  const limit = isQueryEndpoint ? Math.min(apiKey.rateLimit, 60) : apiKey.rateLimit;
  const rateLimitKey = isQueryEndpoint ? `${apiKey.id}:query` : apiKey.id;
  const rateResult = checkRateLimit(rateLimitKey, limit);

  if (!rateResult.allowed) {
    res.status(429).json({
      error: "Rate limit exceeded",
      code: "RATE_LIMITED",
      status: 429,
      retryAfter: rateResult.retryAfter,
    });
    res.setHeader("Retry-After", String(rateResult.retryAfter));
    return;
  }

  // Attach key metadata to request
  req.apiKey = apiKey;
  req.apiKeySourceIds = parseScopeIds(apiKey.sourceScope);

  // Update lastUsedAt (fire-and-forget)
  try { touchApiKey(apiKey.id); } catch { /* non-critical */ }

  next();
}

/**
 * Permission check middleware factory.
 * Returns 403 if the key's permission level is insufficient.
 */
export function requirePermission(...allowed: Array<"read" | "read-write" | "admin">) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.apiKey) {
      res.status(401).json({ error: "API key required", code: "AUTH_REQUIRED", status: 401 });
      return;
    }

    if (!allowed.includes(req.apiKey.permission)) {
      res.status(403).json({
        error: `Requires ${allowed.join(" or ")} permission`,
        code: "INSUFFICIENT_PERMISSION",
        status: 403,
      });
      return;
    }

    next();
  };
}

/**
 * Log an agent API action to the audit trail.
 * Never logs the raw API key or query content.
 */
export function logAgentAction(
  req: Request,
  eventType: string,
  resourceType?: string,
  resourceId?: string,
  extraDetails?: Record<string, unknown>,
): void {
  if (!req.apiKey) return;
  try {
    recordAuditEvent({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventType: eventType as any,
      actorEmail: `apikey:${req.apiKey.name}`,
      actorIp: req.ip,
      resourceType,
      resourceId,
      details: {
        apiKeyId: req.apiKey.id,
        apiKeyName: req.apiKey.name,
        endpoint: `${req.method} ${req.originalUrl}`,
        ...extraDetails,
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to log agent action");
  }
}
