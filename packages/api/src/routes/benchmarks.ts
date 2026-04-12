import { Router } from "express";
import type { IRouter } from "express";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validate.js";
import { runChatBenchmarks } from "../benchmarks/runChatBenchmark.js";

export const benchmarksRouter: IRouter = Router();

const benchmarkQuerySchema = z.object({
  iterations: z.coerce.number().int().min(1).max(10).optional(),
  label: z.string().min(1).max(120).optional(),
  warmup: z.enum(["true", "false", "1", "0"]).optional(),
});

benchmarksRouter.use(requireAdmin);

benchmarksRouter.get(
  "/chat",
  validateQuery(benchmarkQuerySchema),
  async (req, res) => {
    const warmupParam = req.query["warmup"];
    const warmup = warmupParam == null ? true : warmupParam === "true" || warmupParam === "1";
    const run = await runChatBenchmarks({
      ...(req.query["iterations"] != null ? { iterations: Number(req.query["iterations"]) } : {}),
      ...(typeof req.query["label"] === "string" ? { label: req.query["label"] } : {}),
      warmup,
      transport: "local",
    });

    res.json(run);
  },
);
