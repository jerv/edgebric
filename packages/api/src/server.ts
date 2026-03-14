import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import rateLimit from "express-rate-limit";
import pinoHttpModule from "pino-http";
const pinoHttp = pinoHttpModule.default ?? pinoHttpModule;
import FileStoreFactory from "session-file-store";
import { logger } from "./lib/logger.js";
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
import { healthRouter } from "./routes/health.js";
import { knowledgeBasesRouter } from "./routes/knowledgeBases.js";
import { orgRouter } from "./routes/org.js";
import { initDatabase } from "./db/index.js";
import { backfillChunkContent } from "./jobs/backfillChunkContent.js";
import { migrateOrphanedDocumentsToDefaultKB } from "./jobs/migrateDefaultKB.js";
import { ensureDefaultOrg } from "./services/orgStore.js";
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
    orgId?: string; // currently selected org
    orgSlug?: string; // slug of currently selected org
    oidcState?: string; // transient — cleared after callback
    codeVerifier?: string; // transient — cleared after callback
  }
}

// ─── Session store ────────────────────────────────────────────────────────────

const FileStore = FileStoreFactory(session);
const sessionsDir = path.join(config.dataDir, "sessions");

const app = express();

const isDev = process.env["NODE_ENV"] !== "production";

// ─── HTTP Request Logging ────────────────────────────────────────────────────

app.use(pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => {
      const url = req.url ?? "";
      // Suppress request logging for health checks and query endpoint (private mode privacy)
      return url.startsWith("/api/health") || url.startsWith("/api/query");
    },
  },
}));

// ─── CORS ────────────────────────────────────────────────────────────────────

const allowedOrigins = [config.frontendUrl];
if (isDev) {
  // In dev, also allow common localhost variants
  allowedOrigins.push("http://localhost:5173", "http://127.0.0.1:5173");
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, server-to-server, mobile)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);

// ─── Rate Limiting ───────────────────────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

const queryLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.queryToken ?? req.ip ?? "unknown",
  message: { error: "Query rate limit exceeded. Please wait before asking another question." },
  validate: { keyGeneratorIpFallback: false },
});

app.use(globalLimiter);

// ─── Body parsing ────────────────────────────────────────────────────────────

app.use(express.json({ limit: "1mb" }));

// ─── Sessions ────────────────────────────────────────────────────────────────

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
      secure: !isDev,
    },
  }),
);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/query", queryLimiter, queryRouter);
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
app.use("/api/knowledge-bases", knowledgeBasesRouter);
app.use("/api/admin/org", orgRouter);

// Serve avatar images (public, no auth — they're just images)
app.use("/api/avatars", express.static(path.join(config.dataDir, "avatars"), {
  maxAge: "1h",
  immutable: false,
}));

// ─── Static frontend (production) ─────────────────────────────────────────────

const webDistDir = path.join(import.meta.dirname, "..", "..", "web", "dist");
if (!isDev) {
  app.use(express.static(webDistDir));
  // SPA fallback: serve index.html for all non-API routes
  app.get("*", (_req, res, next) => {
    if (_req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(webDistDir, "index.html"));
  });
}

// ─── Error handler ─────────────────────────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Unhandled error");

  // CORS errors
  if (err.message.startsWith("CORS:")) {
    res.status(403).json({ error: err.message });
    return;
  }

  res.status(500).json({
    error: "Internal server error",
    ...(isDev && { message: err.message }),
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  await fs.mkdir(path.join(config.dataDir, "uploads"), { recursive: true });
  await fs.mkdir(sessionsDir, { recursive: true });
  initDatabase();

  // Ensure default org + KB exist and assign orphaned documents (idempotent)
  ensureDefaultOrg();
  migrateOrphanedDocumentsToDefaultKB();

  // Refresh all KB document counts (fixes stale cached counts)
  {
    const { listKBs, refreshDocumentCount } = await import("./services/knowledgeBaseStore.js");
    for (const kb of listKBs()) {
      refreshDocumentCount(kb.id);
    }
  }

  // Backfill chunk content for Vault Mode sync (no-op if already done)
  backfillChunkContent().catch((err) =>
    logger.warn({ err }, "Chunk content backfill failed"),
  );

  app.listen(config.port, () => {
    logger.info({
      port: config.port,
      corsOrigin: config.frontendUrl,
      edgeBaseUrl: config.edge.baseUrl,
      adminEmails: config.adminEmails,
    }, `Edgebric API running on http://localhost:${config.port}`);
  });
}

start().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
