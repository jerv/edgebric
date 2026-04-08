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
import { migrateOrphanedDocumentsToDefaultDataSource } from "./jobs/migrateDefaultDataSource.js";
import { ensureDefaultOrg } from "./services/orgStore.js";
import { config } from "./config.js";
import { createApp } from "./app.js";

// ─── Session store ────────────────────────────────────────────────────────────

const FileStore = FileStoreFactory(session);
const sessionsDir = path.join(config.dataDir, "sessions");

// Ensure sessions directory has restricted permissions (owner-only) to prevent
// other processes on the machine from reading session files and hijacking sessions.
fsSync.mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });
try { fsSync.chmodSync(sessionsDir, 0o700); } catch { /* may fail on some filesystems */ }

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

const webDistDir = process.env["WEB_DIST_DIR"] ?? path.join(import.meta.dirname, "..", "..", "web", "dist");
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
  // Guard: solo mode (no auth) must never be exposed on a network interface
  // (unless running inside a container where 0.0.0.0 is needed for port mapping)
  if (config.authMode === "none" && config.listenHost !== "127.0.0.1" && !process.env["CONTAINER"]) {
    logger.fatal("AUTH_MODE=none (solo mode) requires LISTEN_HOST=127.0.0.1 — refusing to start on a network interface without authentication. Set CONTAINER=1 if running in Docker.");
    process.exit(1);
  }

  await fs.mkdir(path.join(config.dataDir, "uploads"), { recursive: true });
  await fs.mkdir(sessionsDir, { recursive: true });
  initEncryptionKey();
  initDatabase();

  // Ensure default org + data source exist and assign orphaned documents (idempotent)
  const defaultOrg = ensureDefaultOrg();
  migrateOrphanedDocumentsToDefaultDataSource();

  // In solo mode, ensure the solo user record exists in the real default org
  if (config.authMode === "none") {
    const { setSoloOrg } = await import("./middleware/auth.js");
    const { upsertUser, updateUserPermissions } = await import("./services/userStore.js");
    setSoloOrg({ id: defaultOrg.id, slug: defaultOrg.slug });
    const soloUser = upsertUser({
      email: "solo@localhost",
      name: "You",
      orgId: defaultOrg.id,
      role: "admin",
    });
    updateUserPermissions(soloUser.id, {
      canCreateDataSources: true,
      canCreateGroupChats: true,
    });
  }

  // Refresh all data source document counts (fixes stale cached counts)
  {
    const { listDataSources, refreshDocumentCount } = await import("./services/dataSourceStore.js");
    for (const ds of listDataSources()) {
      refreshDocumentCount(ds.id);
    }
  }

  // Purge orphaned chunk registry entries (source document deleted)
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
  const { expireStaleChats, expireStaleShares } = await import("./services/groupChatStore.js");
  setInterval(() => {
    const count = expireStaleChats();
    if (count > 0) logger.info({ count }, "Expired stale group chats");
  }, 5 * 60 * 1000);

  // Expire stale shared sources every 60 seconds
  setInterval(() => {
    const count = expireStaleShares();
    if (count > 0) logger.info({ count }, "Expired stale shared sources");
  }, 60 * 1000);

  // Start cloud sync scheduler (polls active connections on their configured interval)
  {
    const { startSyncScheduler } = await import("./jobs/syncScheduler.js");
    startSyncScheduler();
  }

  // Auto-initialize mesh from setup file if present (secondary node first boot)
  {
    const fs = await import("fs");
    const meshSetupPath = path.join(config.dataDir, "mesh-setup.json");
    if (fs.existsSync(meshSetupPath)) {
      try {
        const setupData = JSON.parse(fs.readFileSync(meshSetupPath, "utf8"));
        const { initMeshConfig, updateMeshConfig } = await import("./services/nodeRegistry.js");
        const { ensureDefaultOrg } = await import("./services/orgStore.js");
        const org = ensureDefaultOrg();

        initMeshConfig({
          role: setupData.role ?? "secondary",
          nodeName: setupData.nodeName ?? "Secondary Node",
          orgId: org.id,
          primaryEndpoint: setupData.primaryEndpoint,
        });

        // Override the auto-generated token with the primary's shared token
        if (setupData.meshToken) {
          updateMeshConfig({ meshToken: setupData.meshToken });
        }

        logger.info({ nodeName: setupData.nodeName, role: setupData.role }, "Auto-initialized mesh from setup file");

        // Remove the setup file — one-time use
        fs.unlinkSync(meshSetupPath);
      } catch (err) {
        logger.error({ err }, "Failed to auto-initialize mesh from setup file");
      }
    }
  }

  // Start mesh scheduler if mesh networking is enabled (heartbeats + stale detection)
  {
    const { isMeshEnabled } = await import("./services/nodeRegistry.js");
    const { startMeshScheduler } = await import("./services/meshScheduler.js");
    if (isMeshEnabled()) {
      startMeshScheduler();
    }
  }

  // Check inference servers and auto-configure the active chat model.
  // Model installation and server lifecycle are managed by the desktop app.
  (async () => {
    try {
      const { isRunning, listInstalled } = await import("./services/inferenceClient.js");
      const { getLastModel } = await import("./services/modelPersistence.js");

      if (await isRunning()) {
        const installed = await listInstalled();

        // Auto-set the last active chat model
        const lastModel = getLastModel();
        if (lastModel) {
          const isInstalled = installed.some((m) => m.tag === lastModel);
          if (isInstalled) {
            const { runtimeChatConfig } = await import("./config.js");
            runtimeChatConfig.model = lastModel;
            runtimeChatConfig.baseUrl = `${config.inference.chatBaseUrl}/v1`;
            logger.info({ model: lastModel }, "Active chat model configured");
          } else {
            logger.info({ model: lastModel }, "Last active model is no longer installed");
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, "Could not check inference server status");
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
      ).listen(config.port, config.listenHost, () => {
        logger.info({
          port: config.port,
          host: config.listenHost,
          corsOrigin: config.frontendUrl,

          adminEmails: config.adminEmails,
        }, `Edgebric API running on https://${config.listenHost}:${config.port}`);
      })
    : app.listen(config.port, config.listenHost, () => {
        logger.info({
          port: config.port,
          host: config.listenHost,
          corsOrigin: config.frontendUrl,

          adminEmails: config.adminEmails,
        }, `Edgebric API running on http://${config.listenHost}:${config.port}`);
      });

  // ─── Graceful Shutdown ──────────────────────────────────────────────────────

  let shuttingDown = false;

  function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down gracefully...");

    server.close(async () => {
      logger.info("HTTP server closed");

      try {
        const { stopSyncScheduler } = await import("./jobs/syncScheduler.js");
        stopSyncScheduler();
      } catch { /* safe to ignore */ }

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
