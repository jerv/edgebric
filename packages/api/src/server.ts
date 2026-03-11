import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import FileStoreFactory from "session-file-store";
import { authRouter } from "./routes/auth.js";
import { documentsRouter } from "./routes/documents.js";
import { queryRouter } from "./routes/query.js";
import { modelsRouter } from "./routes/models.js";
import {
  escalateRouter,
  targetsRouter,
  adminEscalationsRouter,
  adminTargetsRouter,
  adminIntegrationsRouter,
} from "./routes/escalations.js";
import { conversationsRouter } from "./routes/conversations.js";
import { notificationsRouter } from "./routes/notifications.js";
import { syncRouter } from "./routes/sync.js";
import { feedbackRouter } from "./routes/feedback.js";
import { analyticsRouter } from "./routes/analytics.js";
import { initDatabase } from "./db/index.js";
import { backfillChunkContent } from "./jobs/backfillChunkContent.js";
import { config } from "./config.js";
import fs from "fs/promises";
import path from "path";

// ─── Session type augmentation ────────────────────────────────────────────────

declare module "express-session" {
  interface SessionData {
    queryToken: string;
    isAdmin: boolean;
    email?: string;
    name?: string;
    picture?: string;
    oidcState?: string; // transient — cleared after callback
    codeVerifier?: string; // transient — cleared after callback
  }
}

// ─── Session store ────────────────────────────────────────────────────────────

const FileStore = FileStoreFactory(session);
const sessionsDir = path.join(config.dataDir, "sessions");

const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(
  session({
    store: new FileStore({
      path: sessionsDir,
      ttl: 86400, // 24 hours in seconds
      reapInterval: 3600, // clean up expired sessions every hour
      logFn: () => {}, // suppress noisy file-store debug logs
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: "edgebric.sid",
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 86_400_000, // 24 hours in ms
      secure: process.env["NODE_ENV"] === "production",
    },
  }),
);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/api/auth", authRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/query", queryRouter);
app.use("/api/admin/models", modelsRouter);
app.use("/api/escalate", escalateRouter);
app.use("/api/escalation-targets", targetsRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/admin/escalations", adminEscalationsRouter);
app.use("/api/admin/targets", adminTargetsRouter);
app.use("/api/admin/integrations", adminIntegrationsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/sync", syncRouter);
app.use("/api/feedback", feedbackRouter);
app.use("/api/admin/analytics", analyticsRouter);

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
  await fs.mkdir(path.join(config.dataDir, "uploads"), { recursive: true });
  await fs.mkdir(sessionsDir, { recursive: true });
  initDatabase();

  // Backfill chunk content for Vault Mode sync (no-op if already done)
  backfillChunkContent().catch((err) =>
    console.warn("Chunk content backfill failed:", err),
  );

  app.listen(config.port, () => {
    console.log(`Edgebric API running on http://localhost:${config.port}`);
    console.log(`mimik edge: ${config.edge.baseUrl}`);
    console.log(`Admin emails: ${config.adminEmails.join(", ") || "(none)"}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
