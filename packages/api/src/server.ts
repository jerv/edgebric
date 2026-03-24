import "dotenv/config";
import session from "express-session";
import express from "express";
import https from "https";
import FileStoreFactory from "session-file-store";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { logger } from "./lib/logger.js";
import { initEncryptionKey } from "./lib/crypto.js";
import { initDatabase, closeDatabase } from "./db/index.js";
import { backfillChunkContent } from "./jobs/backfillChunkContent.js";
import { migrateOrphanedDocumentsToDefaultKB } from "./jobs/migrateDefaultKB.js";
import { ensureDefaultOrg } from "./services/orgStore.js";
import { config } from "./config.js";
import { createApp } from "./app.js";

// ─── Session store ────────────────────────────────────────────────────────────

const FileStore = FileStoreFactory(session);
const sessionsDir = path.join(config.dataDir, "sessions");

const isDev = process.env["NODE_ENV"] !== "production";

const app = createApp({
  sessionStore: new FileStore({
    path: sessionsDir,
    ttl: 86400,
    reapInterval: 3600,
    logFn: () => {},
  }),
});

// ─── Static frontend (production) ─────────────────────────────────────────────

const webDistDir = path.join(import.meta.dirname, "..", "..", "web", "dist");
const serveStatic = !isDev || process.env["SERVE_STATIC"] === "1";
if (serveStatic) {
  // Hashed assets (JS/CSS/images) — cache aggressively
  app.use("/assets", express.static(path.join(webDistDir, "assets"), {
    maxAge: "1y",
    immutable: true,
  }));
  // Everything else (favicon, etc.) — short cache
  app.use(express.static(webDistDir, {
    maxAge: 0,
    setHeaders: (res, filePath) => {
      // index.html must never be disk-cached — it's the SPA entry point.
      // Without this, browsers serve stale HTML when the server is offline.
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  }));
  app.get("*", (_req, res, next) => {
    if (_req.path.startsWith("/api/")) return next();
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(webDistDir, "index.html"));
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  await fs.mkdir(path.join(config.dataDir, "uploads"), { recursive: true });
  await fs.mkdir(sessionsDir, { recursive: true });
  initEncryptionKey();
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

  // Purge orphaned chunk registry entries (documents deleted while mKB retains chunks)
  {
    const { purgeOrphanedChunks } = await import("./services/chunkRegistry.js");
    const purged = purgeOrphanedChunks();
    if (purged > 0) logger.info({ purged }, "Purged orphaned chunk registry entries");
  }

  // Backfill chunk content for Vault Mode sync (no-op if already done)
  backfillChunkContent().catch((err) =>
    logger.warn({ err }, "Chunk content backfill failed"),
  );

  // Expire stale group chats every 5 minutes
  const { expireStaleChats } = await import("./services/groupChatStore.js");
  setInterval(() => {
    const count = expireStaleChats();
    if (count > 0) logger.info({ count }, "Expired stale group chats");
  }, 5 * 60 * 1000);

  // Auto-install embedding model if Ollama is running but nomic-embed-text is missing
  (async () => {
    try {
      const { isRunning, listInstalled, pullModel } = await import("./services/ollamaClient.js");
      const { EMBEDDING_MODEL_TAG } = await import("@edgebric/types");
      if (await isRunning()) {
        const installed = await listInstalled();
        const hasEmbedding = installed.some((m) => m.tag === EMBEDDING_MODEL_TAG);
        if (!hasEmbedding) {
          logger.info("Auto-installing embedding model...");
          await pullModel(EMBEDDING_MODEL_TAG, (e) => {
            if (e.percent !== undefined && e.percent % 20 === 0) {
              logger.info({ percent: e.percent }, "Embedding model download progress");
            }
          });
          logger.info("Embedding model installed");
        }
      }
    } catch (err) {
      logger.warn({ err }, "Could not auto-install embedding model (Ollama may not be running)");
    }
  })();

  // Start with HTTPS if TLS_CERT and TLS_KEY are provided, otherwise HTTP
  const tlsCert = process.env["TLS_CERT"];
  const tlsKey = process.env["TLS_KEY"];
  const useHttps = tlsCert && tlsKey && fsSync.existsSync(tlsCert) && fsSync.existsSync(tlsKey);

  const server = useHttps
    ? https.createServer(
        { cert: fsSync.readFileSync(tlsCert), key: fsSync.readFileSync(tlsKey) },
        app,
      ).listen(config.port, () => {
        logger.info({
          port: config.port,
          corsOrigin: config.frontendUrl,
          edgeBaseUrl: config.edge.baseUrl,
          adminEmails: config.adminEmails,
        }, `Edgebric API running on https://localhost:${config.port}`);
      })
    : app.listen(config.port, () => {
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

    server.close(() => {
      logger.info("HTTP server closed");

      try {
        closeDatabase();
        logger.info("Database closed");
      } catch {
        // safe to ignore
      }

      logger.flush();
      process.exit(0);
    });

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
