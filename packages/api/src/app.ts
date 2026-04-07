import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { randomBytes, timingSafeEqual } from "crypto";
import session from "express-session";
import rateLimit from "express-rate-limit";
import pinoHttpModule from "pino-http";
const pinoHttp = pinoHttpModule.default ?? pinoHttpModule;
import { logger } from "./lib/logger.js";
import { authRouter } from "./routes/auth.js";
import { documentsRouter } from "./routes/documents.js";
import { queryRouter } from "./routes/query.js";
import { modelsRouter, capabilitiesRouter } from "./routes/models.js";
import { conversationsRouter } from "./routes/conversations.js";
import { notificationsRouter } from "./routes/notifications.js";
import { syncRouter } from "./routes/sync.js";
import { feedbackRouter } from "./routes/feedback.js";
import { healthRouter } from "./routes/health.js";
import { dataSourcesRouter } from "./routes/dataSources.js";
import { orgRouter } from "./routes/org.js";
import { groupChatsRouter } from "./routes/groupChats.js";
import { groupChatQueryRouter } from "./routes/groupChatQuery.js";
import { auditRouter } from "./routes/audit.js";
import { meshRouter } from "./routes/mesh.js";
import { meshInterNodeRouter } from "./routes/meshInterNode.js";
import { vaultRouter } from "./routes/vault.js";
import { integrationsRouter } from "./routes/integrations.js";
import { cloudConnectionsRouter } from "./routes/cloudConnections.js";
import { apiKeysRouter } from "./routes/apiKeys.js";
import { agentApiRouter } from "./routes/agentApi.js";
import { memoryRouter } from "./routes/memory.js";
import { config } from "./config.js";
import { OIDC_PROVIDERS } from "./lib/oidcProviders.js";
import path from "path";

// Register cloud connectors (side-effect imports)
import "./connectors/googleDrive.js";
import "./connectors/oneDrive.js";
import "./connectors/confluence.js";
import "./connectors/notion.js";

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
    oidcNonce?: string; // transient — cleared after callback (replay protection)
    codeVerifier?: string; // transient — cleared after callback
    meshReturnTo?: string; // transient — secondary node URL to redirect after OIDC
    cloudOAuthNonce?: string; // transient — cleared after cloud OAuth callback
  }
}

export interface CreateAppOptions {
  /** Skip session middleware (tests inject session directly) */
  skipSession?: boolean;
  /** Skip CSRF protection (tests don't need it) */
  skipCsrf?: boolean;
  /** Skip rate limiting */
  skipRateLimit?: boolean;
  /** Skip pino-http request logging */
  skipRequestLogging?: boolean;
  /** Custom session store (pass null to use MemoryStore for tests) */
  sessionStore?: session.Store | null;
}

export function createApp(opts: CreateAppOptions = {}): express.Express {
  const app = express();
  const isDev = process.env["NODE_ENV"] !== "production";
  const useHttps = !!(process.env["TLS_CERT"] && process.env["TLS_KEY"]);

  // ─── Security Headers (helmet) ──────────────────────────────────────────────

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:", ...(OIDC_PROVIDERS[config.oidc.provider]?.imgSrcDomains ?? [])],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: null,  // disabled — on-prem app runs over HTTP
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: !isDev ? { maxAge: 31536000, includeSubDomains: true } : false,
  }));

  // ─── HTTP Request Logging ────────────────────────────────────────────────────

  if (!opts.skipRequestLogging) {
    app.use(pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => {
          const url = req.url ?? "";
          return url.startsWith("/api/health") || url.startsWith("/api/query");
        },
      },
    }));
  }

  // ─── CORS ────────────────────────────────────────────────────────────────────

  const allowedOrigins = [config.frontendUrl];
  if (isDev) {
    allowedOrigins.push("http://localhost:5173", "http://127.0.0.1:5173");
  }
  // Also allow .local mDNS hostname access (same server, different hostname)
  const proto = useHttps ? "https" : "http";
  allowedOrigins.push(`${proto}://edgebric.local:${config.port}`);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
    }),
  );

  // ─── Host Header Validation (DNS Rebinding Protection) ───────────────────────
  // Reject requests where the Host header doesn't match known server hostnames.
  // Prevents DNS rebinding attacks where a malicious site resolves to localhost
  // and makes credentialed requests to the local Edgebric instance.

  const allowedHosts = new Set<string>();
  for (const origin of allowedOrigins) {
    try { allowedHosts.add(new URL(origin).host); } catch { /* ignore bad URLs */ }
  }
  // Always allow the literal listen address
  allowedHosts.add(`localhost:${config.port}`);
  allowedHosts.add(`127.0.0.1:${config.port}`);
  allowedHosts.add(`edgebric.local:${config.port}`);

  app.use((req, res, next) => {
    const host = req.headers["host"];
    if (!host || allowedHosts.has(host)) {
      next();
      return;
    }
    // Strip port and check hostname alone (handles default port omission)
    const hostOnly = host.split(":")[0]!;
    if (allowedHosts.has(hostOnly) || hostOnly === "localhost" || hostOnly === "127.0.0.1" || hostOnly === "edgebric.local") {
      next();
      return;
    }
    res.status(421).json({ error: "Invalid Host header" });
  });

  // ─── Rate Limiting ───────────────────────────────────────────────────────────

  if (!opts.skipRateLimit && process.env["SKIP_RATE_LIMIT"] !== "1") {
    const globalLimiter = rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many requests, please try again later" },
    });

    app.use(globalLimiter);
  }

  // ─── Body parsing ────────────────────────────────────────────────────────────

  app.use(express.json({ limit: "1mb" }));

  // ─── Cookie parsing ─────────────────────────────────────────────────────────

  app.use(cookieParser());

  // ─── Sessions ────────────────────────────────────────────────────────────────

  if (!opts.skipSession) {
    const storeOption = opts.sessionStore !== undefined
      ? (opts.sessionStore ?? undefined)
      : undefined;

    app.use(
      session({
        ...(storeOption && { store: storeOption }),
        secret: config.sessionSecret,
        resave: false,
        saveUninitialized: false,
        name: "edgebric.sid",
        cookie: {
          httpOnly: true,
          sameSite: "lax",
          maxAge: 86_400_000,
          secure: useHttps,
        },
      }),
    );
  }

  // ─── CSRF Protection (double-submit cookie) ────────────────────────────────

  if (!opts.skipCsrf && process.env["SKIP_CSRF"] !== "1") {
    const CSRF_COOKIE = "edgebric.csrf";
    const CSRF_HEADER = "x-csrf-token";
    const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

    app.use((req, res, next) => {
      if (!req.cookies?.[CSRF_COOKIE]) {
        const token = randomBytes(32).toString("hex");
        res.cookie(CSRF_COOKIE, token, {
          httpOnly: false,
          sameSite: "lax",
          secure: useHttps,
          path: "/",
        });
      }
      next();
    });

    app.use((req, res, next) => {
      if (CSRF_SAFE_METHODS.has(req.method)) return next();
      if (req.path === "/api/auth/callback") return next();
      if (req.path === "/api/health") return next();
      // Mesh peer endpoints use MeshToken auth, not browser sessions — skip CSRF
      if (req.path.startsWith("/api/mesh/peer")) return next();
      if (req.path.startsWith("/api/v1/")) return next(); // Agent API uses Bearer auth, not CSRF

      const cookieToken = req.cookies?.[CSRF_COOKIE];
      const headerToken = req.headers[CSRF_HEADER];

      if (
        !cookieToken || !headerToken ||
        typeof headerToken !== "string" ||
        cookieToken.length !== headerToken.length ||
        !timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))
      ) {
        res.status(403).json({ error: "CSRF token missing or invalid" });
        return;
      }
      next();
    });
  }

  // ─── Routes ───────────────────────────────────────────────────────────────────

  const queryLimiter = (opts.skipRateLimit || process.env["SKIP_RATE_LIMIT"] === "1") ? [] : [rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => req.session?.queryToken ?? req.ip ?? "unknown",
    message: { error: "Query rate limit exceeded. Please wait before asking another question." },
    validate: { keyGeneratorIpFallback: false },
  })];

  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/query", ...queryLimiter, queryRouter);
  app.use("/api/admin/models", capabilitiesRouter); // Non-admin capabilities endpoint (must be before admin-only modelsRouter)
  app.use("/api/admin/models", modelsRouter);
  app.use("/api/conversations", conversationsRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/sync", syncRouter);
  app.use("/api/feedback", feedbackRouter);
  app.use("/api/data-sources", dataSourcesRouter);
  app.use("/api/admin/org", orgRouter);
  app.use("/api/admin/integrations", integrationsRouter);
  // Strict rate limit on OAuth endpoints — prevents abuse of embedded credentials
  const oauthLimiter = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many OAuth requests, please try again later" },
  });
  app.use("/api/cloud-connections/oauth", oauthLimiter);
  app.use("/api/cloud-connections", cloudConnectionsRouter);
  app.use("/api/group-chats", groupChatsRouter);
  app.use("/api/group-chats", groupChatQueryRouter);
  app.use("/api/audit", auditRouter);
  app.use("/api/vault", vaultRouter);
  app.use("/api/memory", memoryRouter);
  app.use("/api/mesh/peer", meshInterNodeRouter); // before /api/mesh — peer routes use MeshToken auth, not session
  app.use("/api/mesh", meshRouter);
  app.use("/api/admin/api-keys", apiKeysRouter);
  app.use("/api/v1", agentApiRouter); // Agent API — uses Bearer token auth, bypasses session/CSRF

  // Serve avatar images
  app.use("/api/avatars", express.static(path.join(config.dataDir, "avatars"), {
    maxAge: "1h",
    immutable: false,
  }));

  // ─── Global Error Handler ────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.message?.startsWith("CORS:")) {
      res.status(403).json({ error: err.message });
      return;
    }
    if (err.name === "MulterError") {
      const messages: Record<string, string> = {
        LIMIT_FILE_SIZE: "File is too large (max 50MB)",
        LIMIT_UNEXPECTED_FILE: "Unexpected file field",
      };
      res.status(400).json({ error: messages[err.code] ?? `Upload error: ${err.message}` });
      return;
    }
    if (err.message?.startsWith("Unsupported file type")) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON in request body" });
      return;
    }
    if (err.type === "entity.too.large") {
      res.status(413).json({ error: "Request body too large (max 1MB)" });
      return;
    }
    logger.error({ err }, "Unhandled error");
    res.status(500).json({
      error: "Internal server error",
      ...(isDev && { message: err.message }),
    });
  });

  return app;
}
