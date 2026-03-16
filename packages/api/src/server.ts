import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { randomBytes } from "crypto";
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
import { initDatabase, closeDatabase } from "./db/index.js";
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

// ─── Security Headers (helmet) ──────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],  // shadcn/ui uses inline styles
      imgSrc: ["'self'", "data:", "blob:", "https://lh3.googleusercontent.com"],  // Google profile pics
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,  // breaks loading Google profile images
  hsts: !isDev ? { maxAge: 31536000, includeSubDomains: true } : false,
}));

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

// ─── Cookie parsing ─────────────────────────────────────────────────────────

app.use(cookieParser());

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

// ─── CSRF Protection (double-submit cookie) ────────────────────────────────

const CSRF_COOKIE = "edgebric.csrf";
const CSRF_HEADER = "x-csrf-token";
const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Set CSRF token cookie on every response if not already present
app.use((req, res, next) => {
  if (!req.cookies?.[CSRF_COOKIE]) {
    const token = randomBytes(32).toString("hex");
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,       // JS must read this cookie
      sameSite: "lax",
      secure: !isDev,
      path: "/",
    });
  }
  next();
});

// Verify CSRF token on state-changing requests
app.use((req, res, next) => {
  if (CSRF_SAFE_METHODS.has(req.method)) return next();

  // Skip CSRF for auth callback (OIDC redirect, no JS involved)
  if (req.path === "/api/auth/callback") return next();
  // Skip CSRF for health check
  if (req.path === "/api/health") return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ error: "CSRF token missing or invalid" });
    return;
  }
  next();
});

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

// ─── Global Error Handler ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // CORS errors
  if (err.message?.startsWith("CORS:")) {
    res.status(403).json({ error: err.message });
    return;
  }

  // Multer errors (file upload)
  if (err.name === "MulterError") {
    const messages: Record<string, string> = {
      LIMIT_FILE_SIZE: "File is too large (max 50MB)",
      LIMIT_UNEXPECTED_FILE: "Unexpected file field",
    };
    res.status(400).json({ error: messages[err.code] ?? `Upload error: ${err.message}` });
    return;
  }

  // Multer file filter rejection (e.g. unsupported file type)
  if (err.message?.startsWith("Unsupported file type")) {
    res.status(400).json({ error: err.message });
    return;
  }

  // JSON parse errors (malformed request body)
  if (err.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON in request body" });
    return;
  }

  // Body size limit exceeded
  if (err.type === "entity.too.large") {
    res.status(413).json({ error: "Request body too large (max 1MB)" });
    return;
  }

  // Everything else — log and return generic error
  logger.error({ err }, "Unhandled error");
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

  const server = app.listen(config.port, () => {
    logger.info({
      port: config.port,
      corsOrigin: config.frontendUrl,
      edgeBaseUrl: config.edge.baseUrl,
      adminEmails: config.adminEmails,
    }, `Edgebric API running on http://localhost:${config.port}`);
  });

  // ─── Graceful Shutdown ──────────────────────────────────────────────────────

  let shuttingDown = false;

  function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down gracefully...");

    // Stop accepting new connections, drain existing ones
    server.close(() => {
      logger.info("HTTP server closed");

      // Close SQLite database
      try {
        closeDatabase();
        logger.info("Database closed");
      } catch {
        // safe to ignore
      }

      // Flush pino logs
      logger.flush();
      process.exit(0);
    });

    // Force exit if drain takes too long (10s)
    setTimeout(() => {
      logger.warn("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
