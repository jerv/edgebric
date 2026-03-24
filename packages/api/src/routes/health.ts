import { Router } from "express";
import type { Router as IRouter } from "express";
import { execSync } from "child_process";
import { runtimeEdgeConfig, runtimeChatConfig, config } from "../config.js";

export const healthRouter: IRouter = Router();

const startTime = Date.now();

/** Get disk usage for the data directory. Returns available bytes and usage percentage. */
function getDiskUsage(): { availableBytes: number; usedPercent: number } | null {
  try {
    // df -k outputs 1K blocks — works on macOS and Linux
    const output = execSync(`df -k "${config.dataDir}" 2>/dev/null`, { encoding: "utf8" });
    const lines = output.trim().split("\n");
    if (lines.length < 2) return null;
    const parts = lines[1]!.split(/\s+/);
    // df columns: Filesystem, 1K-blocks, Used, Available, Capacity/Use%, Mounted
    const available = parseInt(parts[3]!, 10) * 1024; // convert 1K-blocks to bytes
    const capacityStr = parts[4]!.replace("%", "");
    const usedPercent = parseInt(capacityStr, 10);
    return { availableBytes: available, usedPercent };
  } catch {
    return null;
  }
}

healthRouter.get("/", async (req, res) => {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string; detail?: string }> = {};

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

  // Disk space check
  const disk = getDiskUsage();
  if (disk) {
    const GB = (disk.availableBytes / (1024 ** 3)).toFixed(1);
    if (disk.usedPercent >= 95) {
      checks.disk = { status: "critical", detail: `${GB} GB free (${disk.usedPercent}% used)` };
    } else if (disk.usedPercent >= 85) {
      checks.disk = { status: "warning", detail: `${GB} GB free (${disk.usedPercent}% used)` };
    } else {
      checks.disk = { status: "ok", detail: `${GB} GB free` };
    }
  }

  // Core services (database, disk) affect overall health.
  // AI services (inference, vectorStore) are informational — reported but don't degrade overall status.
  const coreChecks = [checks.database, checks.disk].filter(Boolean);
  const coreOk = coreChecks.every((c) => c!.status === "ok");
  const coreCritical = coreChecks.some((c) => c!.status === "critical");
  const overallStatus = coreCritical ? "unhealthy" : coreOk ? "healthy" : "degraded";

  // AI services summary for the admin detail view
  const aiReady = checks.inference?.status === "ok" && checks.vectorStore?.status === "ok";

  // Only expose detailed checks (latency, errors, uptime) to authenticated admins.
  // Unauthenticated callers get a simple status (useful for load balancers).
  const isAdmin = !!(req.session?.queryToken && req.session?.isAdmin);
  if (isAdmin) {
    res.status(coreCritical ? 503 : 200).json({
      status: overallStatus,
      aiReady,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      checks,
    });
  } else {
    res.status(coreCritical ? 503 : 200).json({ status: overallStatus, aiReady });
  }
});
