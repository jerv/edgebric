import { Router } from "express";
import type { Router as IRouter } from "express";
import { runtimeEdgeConfig, runtimeChatConfig } from "../config.js";

export const healthRouter: IRouter = Router();

const startTime = Date.now();

healthRouter.get("/", async (req, res) => {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

  // Database check — if we got here, express is running and DB was initialized
  checks.database = { status: "ok" };

  // mILM / chat inference check
  try {
    const t = Date.now();
    const resp = await fetch(`${runtimeChatConfig.baseUrl}/models`, {
      signal: AbortSignal.timeout(5000),
    });
    checks.inference = {
      status: resp.ok ? "ok" : "degraded",
      latencyMs: Date.now() - t,
    };
  } catch (err) {
    checks.inference = {
      status: "unavailable",
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }

  // mKB check
  try {
    const t = Date.now();
    const resp = await fetch(`${runtimeEdgeConfig.baseUrl}/api/mkb/v1/datasets`, {
      headers: { authorization: `bearer ${runtimeEdgeConfig.apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    checks.vectorStore = {
      status: resp.ok ? "ok" : "degraded",
      latencyMs: Date.now() - t,
    };
  } catch (err) {
    checks.vectorStore = {
      status: "unavailable",
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }

  const allOk = Object.values(checks).every((c) => c.status === "ok");
  const anyDown = Object.values(checks).some((c) => c.status === "unavailable");
  const overallStatus = allOk ? "healthy" : anyDown ? "unhealthy" : "degraded";

  // Only expose detailed checks (latency, errors, uptime) to authenticated admins.
  // Unauthenticated callers get a simple status (useful for load balancers).
  const isAdmin = !!(req.session?.queryToken && req.session?.isAdmin);
  if (isAdmin) {
    res.status(anyDown ? 503 : 200).json({ status: overallStatus, uptime: Math.floor((Date.now() - startTime) / 1000), checks });
  } else {
    res.status(anyDown ? 503 : 200).json({ status: overallStatus });
  }
});
