import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { documentsRouter } from "./routes/documents.js";
import { queryRouter } from "./routes/query.js";
import { config } from "./config.js";
import fs from "fs/promises";
import path from "path";

const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({ origin: "http://localhost:5173" })); // Vite dev server
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/api/auth", authRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/query", queryRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Error handler ─────────────────────────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  // Ensure data directory exists
  await fs.mkdir(path.join(config.dataDir, "uploads"), { recursive: true });

  app.listen(config.port, () => {
    console.log(`Edgebric API running on http://localhost:${config.port}`);
    console.log(`mimik edge: ${config.edge.baseUrl}`);
    console.log(`Company: ${config.companyName}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
