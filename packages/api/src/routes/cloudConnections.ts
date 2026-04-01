/**
 * Cloud storage connection API routes.
 *
 * Connections = OAuth credentials (one per user per provider).
 * Folder syncs = links a cloud folder to a data source.
 *
 * All routes require org membership. Admins can manage any connection;
 * regular members can only manage their own connections.
 */
import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { randomBytes, timingSafeEqual } from "crypto";
import { requireOrg } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { getConnector, getRegisteredProviders } from "../connectors/registry.js";
import {
  createConnection,
  getConnection,
  listConnections,
  updateConnection,
  deleteConnection,
  createFolderSync,
  getFolderSync,
  listFolderSyncs,
  listFolderSyncsByConnectionId,
  updateFolderSync,
  deleteFolderSync,
  listSyncFiles,
  listSyncFilesByConnectionId,
  countSyncedFilesByConnectionId,
} from "../services/cloudConnectionStore.js";
import { saveTokens, deleteTokens } from "../services/cloudTokenStore.js";
import { getValidAccessToken } from "../services/cloudTokenStore.js";
import { getDataSource } from "../services/dataSourceStore.js";
import { syncFolderSync } from "../jobs/syncConnection.js";
import { isFolderSyncSyncing } from "../jobs/syncScheduler.js";
import { recordAuditEvent } from "../services/auditLog.js";
import { config } from "../config.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import { getGoogleCredentials } from "../connectors/googleDrive.js";
import { logger } from "../lib/logger.js";
import type { CloudProvider } from "@edgebric/types";
import { CLOUD_PROVIDERS } from "@edgebric/types";

export const cloudConnectionsRouter: IRouter = Router();
cloudConnectionsRouter.use(requireOrg);

/** Check if the current user can access a connection (admin = any, member = own only). */
function canAccess(req: { session: { isAdmin?: boolean; email?: string } }, conn: { createdBy: string }): boolean {
  return !!req.session.isAdmin || req.session.email === conn.createdBy;
}

// ─── List available providers ───────────────────────────────────────────────

cloudConnectionsRouter.get("/providers", (_req, res) => {
  const registered = new Set(getRegisteredProviders());
  const integrationCfg = getIntegrationConfig();
  const credentialsConfigured: Record<string, boolean> = {
    google_drive: !!(
      (config.cloud.google.clientId && config.cloud.google.clientSecret) ||
      (integrationCfg.googleDriveClientId && integrationCfg.googleDriveClientSecret)
    ),
    onedrive: !!(
      (config.cloud.onedrive.clientId && config.cloud.onedrive.clientSecret) ||
      (integrationCfg.onedriveClientId && integrationCfg.onedriveClientSecret)
    ),
  };
  const providers = CLOUD_PROVIDERS.map((p) => ({
    ...p,
    enabled: registered.has(p.id) && (credentialsConfigured[p.id] ?? false),
  }));
  res.json({ providers });
});

// ─── List connections ───────────────────────────────────────────────────────

cloudConnectionsRouter.get("/", (req, res) => {
  const orgId = req.session.orgId;
  if (!orgId) { res.status(400).json({ error: "No org selected" }); return; }

  let connections = listConnections(orgId);
  if (!req.session.isAdmin) {
    connections = connections.filter((c) => c.createdBy === req.session.email);
  }
  res.json({ connections });
});

// ─── Get connection detail ──────────────────────────────────────────────────

cloudConnectionsRouter.get("/:id", (req, res) => {
  const conn = getConnection(req.params.id);
  if (!conn || conn.orgId !== req.session.orgId || !canAccess(req, conn)) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  // Check if any folder sync for this connection is currently syncing
  const folderSyncs = listFolderSyncsByConnectionId(conn.id);
  const syncing = folderSyncs.some((fs) => isFolderSyncSyncing(fs.id));
  const syncedFileCount = countSyncedFilesByConnectionId(conn.id);

  res.json({ connection: { ...conn, syncedFileCount }, syncing });
});

// ─── OAuth: Get authorization URL ───────────────────────────────────────────

const authorizeSchema = z.object({
  provider: z.enum(["google_drive", "onedrive", "dropbox", "notion", "confluence"]),
  returnTo: z.string().optional(),
});

cloudConnectionsRouter.post("/oauth/authorize", validateBody(authorizeSchema), (req, res) => {
  const { provider, returnTo } = req.body as z.infer<typeof authorizeSchema>;
  const connector = getConnector(provider);
  if (!connector) {
    res.status(400).json({ error: `Provider ${provider} is not available` });
    return;
  }

  try {
    const stateNonce = randomBytes(32).toString("hex");
    const statePayload = JSON.stringify({ provider, nonce: stateNonce, returnTo });
    const state = Buffer.from(statePayload).toString("base64url");

    req.session.cloudOAuthNonce = stateNonce;

    const redirectUri = `${getBaseUrl(req, provider as CloudProvider)}/api/cloud-connections/oauth/callback`;
    const authUrl = connector.getAuthUrl(state, redirectUri);

    res.json({ authUrl });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg }, "OAuth authorize failed");
    res.status(400).json({ error: errMsg });
  }
});

// ─── OAuth: Callback ────────────────────────────────────────────────────────

cloudConnectionsRouter.get("/oauth/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      logger.warn({ error }, "OAuth callback returned error");
      res.redirect(`${config.frontendUrl}/integrations?error=${encodeURIComponent(String(error))}`);
      return;
    }

    if (!code || !state || typeof code !== "string" || typeof state !== "string") {
      res.status(400).json({ error: "Missing code or state parameter" });
      return;
    }

    let stateData: { provider: string; nonce: string; returnTo?: string };
    try {
      stateData = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    } catch {
      res.status(400).json({ error: "Invalid state parameter" });
      return;
    }

    // Verify CSRF nonce
    const sessionNonce = req.session.cloudOAuthNonce;
    if (
      !sessionNonce ||
      sessionNonce.length !== stateData.nonce.length ||
      !timingSafeEqual(Buffer.from(sessionNonce), Buffer.from(stateData.nonce))
    ) {
      res.status(403).json({ error: "OAuth state mismatch — possible CSRF attack" });
      return;
    }
    delete req.session.cloudOAuthNonce;

    const provider = stateData.provider as CloudProvider;
    const connector = getConnector(provider);
    if (!connector) {
      res.status(400).json({ error: `Unknown provider: ${provider}` });
      return;
    }

    const redirectUri = `${getBaseUrl(req, provider)}/api/cloud-connections/oauth/callback`;
    const tokens = await connector.exchangeCode(code, redirectUri);

    // Create connection (OAuth credentials only — no data source)
    const orgId = req.session.orgId!;
    const email = req.session.email!;
    const providerName = CLOUD_PROVIDERS.find((p) => p.id === provider)?.name ?? provider;
    const displayName = tokens.accountEmail
      ? `${providerName} (${tokens.accountEmail})`
      : providerName;

    const conn = createConnection({
      provider,
      displayName,
      orgId,
      accountEmail: tokens.accountEmail,
      createdBy: email,
    });

    saveTokens(conn.id, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
    });

    void recordAuditEvent({
      eventType: "cloud_connection.create",
      actorEmail: email,
      actorIp: req.ip ?? "",
      resourceType: "cloud_connection",
      resourceId: conn.id,
      details: { provider, accountEmail: tokens.accountEmail },
    });

    // Return a page that auto-closes (for Electron where OAuth opened in external browser)
    // or redirects back to the app (for regular browser usage)
    const returnTo = stateData.returnTo ?? "/account?tab=connected-accounts";
    const redirectUrl = `${config.frontendUrl}${returnTo}`;
    res.send(`<!DOCTYPE html><html><head><title>Connected</title></head><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;color:#334155"><div style="text-align:center"><h2 style="font-size:18px;margin-bottom:8px">Connected successfully</h2><p style="font-size:14px;color:#64748b">You can close this tab and return to Edgebric.</p><p style="font-size:12px;color:#94a3b8;margin-top:16px">Redirecting...</p></div><script>setTimeout(function(){window.location.href="${redirectUrl}"},1500)</script></body></html>`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg }, "OAuth callback failed");
    const errorUrl = `${config.frontendUrl}/account?tab=connected-accounts&error=${encodeURIComponent("Authentication failed")}`;
    res.send(`<!DOCTYPE html><html><head><title>Error</title></head><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;color:#334155"><div style="text-align:center"><h2 style="font-size:18px;margin-bottom:8px;color:#dc2626">Connection failed</h2><p style="font-size:14px;color:#64748b">Please close this tab and try again in Edgebric.</p><p style="font-size:12px;color:#94a3b8;margin-top:16px">Redirecting...</p></div><script>setTimeout(function(){window.location.href="${errorUrl}"},2000)</script></body></html>`);
  }
});

// ─── Delete connection ──────────────────────────────────────────────────────

cloudConnectionsRouter.delete("/:id", (req, res) => {
  const conn = getConnection(req.params.id);
  if (!conn || conn.orgId !== req.session.orgId || !canAccess(req, conn)) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  deleteTokens(conn.id);
  deleteConnection(conn.id);

  void recordAuditEvent({
    eventType: "cloud_connection.delete",
    actorEmail: req.session.email ?? "",
    actorIp: req.ip ?? "",
    resourceType: "cloud_connection",
    resourceId: conn.id,
    details: { provider: conn.provider },
  });

  res.json({ deleted: true });
});

// ─── Update connection ─────────────────────────────────────────────────────

const updateConnectionSchema = z.object({
  displayName: z.string().min(1).optional(),
  folderId: z.string().optional(),
  folderName: z.string().optional(),
  syncIntervalMin: z.number().int().min(5).max(1440).optional(),
  status: z.enum(["active", "paused", "disconnected"]).optional(),
});

cloudConnectionsRouter.put("/:id", validateBody(updateConnectionSchema), (req, res) => {
  const conn = getConnection(req.params.id as string);
  if (!conn || conn.orgId !== req.session.orgId || !canAccess(req, conn)) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  const data = req.body as z.infer<typeof updateConnectionSchema>;

  // Update connection-level fields
  const connUpdate: { displayName?: string; status?: "active" | "disconnected" } = {};
  if (data.displayName !== undefined) connUpdate.displayName = data.displayName;
  if (data.status !== undefined) connUpdate.status = data.status as "active" | "disconnected";

  if (Object.keys(connUpdate).length > 0) {
    updateConnection(conn.id, connUpdate);
  }

  // Handle folder sync fields
  const folderSyncs = listFolderSyncsByConnectionId(conn.id);
  const firstSync = folderSyncs[0] as typeof folderSyncs[number] | undefined;
  if (data.folderId !== undefined || data.folderName !== undefined || data.syncIntervalMin !== undefined || (data.status !== undefined && data.status !== "disconnected")) {
    if (firstSync) {
      const fsUpdate: { folderId?: string; folderName?: string; syncIntervalMin?: number; status?: "active" | "paused" } = {};
      if (data.folderId !== undefined) fsUpdate.folderId = data.folderId;
      if (data.folderName !== undefined) fsUpdate.folderName = data.folderName;
      if (data.syncIntervalMin !== undefined) fsUpdate.syncIntervalMin = data.syncIntervalMin;
      if (data.status === "active" || data.status === "paused") fsUpdate.status = data.status;
      if (Object.keys(fsUpdate).length > 0) {
        updateFolderSync(firstSync.id, fsUpdate);
      }
    }
  }

  // Build response with merged folder sync data
  const updated = getConnection(conn.id)!;
  const updatedSyncs = listFolderSyncsByConnectionId(conn.id);
  const firstUpdatedSync = updatedSyncs[0] as typeof updatedSyncs[number] | undefined;
  const merged: Record<string, unknown> = { ...updated };
  if (firstUpdatedSync) {
    merged.folderId = firstUpdatedSync.folderId;
    merged.folderName = firstUpdatedSync.folderName;
    merged.syncIntervalMin = firstUpdatedSync.syncIntervalMin;
  }
  // Reflect folderId/folderName from request even without a folder sync row
  if (data.folderId !== undefined) merged.folderId = data.folderId;
  if (data.folderName !== undefined) merged.folderName = data.folderName;
  if (data.syncIntervalMin !== undefined) merged.syncIntervalMin = data.syncIntervalMin;
  if (data.status !== undefined) merged.status = data.status;

  res.json({ connection: merged });
});

// ─── Trigger sync (connection-level) ───────────────────────────────────────

cloudConnectionsRouter.post("/:id/sync", async (req, res) => {
  try {
    const conn = getConnection(req.params.id as string);
    if (!conn || conn.orgId !== req.session.orgId || !canAccess(req, conn)) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    const folderSyncs = listFolderSyncsByConnectionId(conn.id);
    if (folderSyncs.length === 0) {
      res.status(400).json({ error: "No folder configured for this connection" });
      return;
    }

    const firstSync = folderSyncs[0]!;
    if (isFolderSyncSyncing(firstSync.id)) {
      res.status(409).json({ error: "Sync already in progress" });
      return;
    }

    const stats = await syncFolderSync(firstSync.id);
    res.json({ synced: true, ...stats });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg }, "Manual sync failed");
    res.status(500).json({ error: "Sync failed", details: errMsg });
  }
});

// ─── List sync files (connection-level) ────────────────────────────────────

cloudConnectionsRouter.get("/:id/files", (req, res) => {
  const conn = getConnection(req.params.id as string);
  if (!conn || conn.orgId !== req.session.orgId || !canAccess(req, conn)) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  const files = listSyncFilesByConnectionId(conn.id);
  res.json({ files });
});

// ─── Browse folders (via connection) ────────────────────────────────────────

cloudConnectionsRouter.get("/:id/folders", async (req, res) => {
  try {
    const conn = getConnection(req.params.id);
    if (!conn || conn.orgId !== req.session.orgId || !canAccess(req, conn)) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    const connector = getConnector(conn.provider as CloudProvider);
    if (!connector) {
      res.status(400).json({ error: "Provider not available" });
      return;
    }

    const accessToken = await getValidAccessToken(conn.id, conn.provider as CloudProvider);
    const parentId = typeof req.query.parentId === "string" ? req.query.parentId : undefined;
    const folders = await connector.listFolders(accessToken, parentId);

    res.json({ folders });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg }, "Failed to list folders");
    res.status(500).json({ error: "Failed to list folders" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Folder Syncs (used from the data source UI)
// ═══════════════════════════════════════════════════════════════════════════

// ─── List folder syncs for a data source ────────────────────────────────────

cloudConnectionsRouter.get("/folder-syncs/by-data-source/:dataSourceId", (req, res) => {
  const ds = getDataSource(req.params.dataSourceId);
  if (!ds) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }

  const syncs = listFolderSyncs(req.params.dataSourceId);
  res.json({ folderSyncs: syncs });
});

// ─── Create folder sync ────────────────────────────────────────────────────

const createFolderSyncSchema = z.object({
  connectionId: z.string().min(1),
  dataSourceId: z.string().min(1),
  folderId: z.string().min(1),
  folderName: z.string().min(1).max(500),
  syncIntervalMin: z.number().int().min(5).max(1440).optional(),
});

cloudConnectionsRouter.post("/folder-syncs", validateBody(createFolderSyncSchema), (req, res) => {
  const data = req.body as z.infer<typeof createFolderSyncSchema>;

  // Verify connection exists and user has access
  const conn = getConnection(data.connectionId);
  if (!conn || conn.orgId !== req.session.orgId || !canAccess(req, conn)) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  // Verify data source exists
  const ds = getDataSource(data.dataSourceId);
  if (!ds) {
    res.status(404).json({ error: "Data source not found" });
    return;
  }

  const folderSync = createFolderSync({
    connectionId: data.connectionId,
    dataSourceId: data.dataSourceId,
    folderId: data.folderId,
    folderName: data.folderName,
    syncIntervalMin: data.syncIntervalMin,
    createdBy: req.session.email!,
  });

  void recordAuditEvent({
    eventType: "cloud_connection.sync",
    actorEmail: req.session.email ?? "",
    actorIp: req.ip ?? "",
    resourceType: "cloud_folder_sync",
    resourceId: folderSync.id,
    details: { connectionId: data.connectionId, dataSourceId: data.dataSourceId, folderId: data.folderId },
  });

  res.status(201).json({ folderSync });
});

// ─── Update folder sync ────────────────────────────────────────────────────

const updateFolderSyncSchema = z.object({
  syncIntervalMin: z.number().int().min(5).max(1440).optional(),
  status: z.enum(["active", "paused"]).optional(),
});

cloudConnectionsRouter.put("/folder-syncs/:id", validateBody(updateFolderSyncSchema), (req, res) => {
  const folderSync = getFolderSync(req.params.id as string);
  if (!folderSync) {
    res.status(404).json({ error: "Folder sync not found" });
    return;
  }

  const conn = getConnection(folderSync.connectionId);
  if (!conn || conn.orgId !== req.session.orgId || !canAccess(req, conn)) {
    res.status(404).json({ error: "Folder sync not found" });
    return;
  }

  const data = req.body as z.infer<typeof updateFolderSyncSchema>;
  const updated = updateFolderSync(folderSync.id, data);

  res.json({ folderSync: updated });
});

// ─── Delete folder sync ────────────────────────────────────────────────────

cloudConnectionsRouter.delete("/folder-syncs/:id", (req, res) => {
  const folderSync = getFolderSync(req.params.id);
  if (!folderSync) {
    res.status(404).json({ error: "Folder sync not found" });
    return;
  }

  const conn = getConnection(folderSync.connectionId);
  if (!conn || conn.orgId !== req.session.orgId || !canAccess(req, conn)) {
    res.status(404).json({ error: "Folder sync not found" });
    return;
  }

  deleteFolderSync(folderSync.id);

  res.json({ deleted: true });
});

// ─── Manual sync trigger (for a folder sync) ───────────────────────────────

cloudConnectionsRouter.post("/folder-syncs/:id/sync", async (req, res) => {
  try {
    const folderSync = getFolderSync(req.params.id);
    if (!folderSync) {
      res.status(404).json({ error: "Folder sync not found" });
      return;
    }

    const conn = getConnection(folderSync.connectionId);
    if (!conn || conn.orgId !== req.session.orgId || !canAccess(req, conn)) {
      res.status(404).json({ error: "Folder sync not found" });
      return;
    }

    if (isFolderSyncSyncing(folderSync.id)) {
      res.status(409).json({ error: "Sync already in progress" });
      return;
    }

    const stats = await syncFolderSync(folderSync.id);

    void recordAuditEvent({
      eventType: "cloud_connection.sync",
      actorEmail: req.session.email ?? "",
      actorIp: req.ip ?? "",
      resourceType: "cloud_folder_sync",
      resourceId: folderSync.id,
      details: { provider: conn.provider, ...stats },
    });

    res.json({ synced: true, ...stats });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg }, "Manual sync failed");
    res.status(500).json({ error: "Sync failed", details: errMsg });
  }
});

// ─── List sync files (for a folder sync) ───────────────────────────────────

cloudConnectionsRouter.get("/folder-syncs/:id/files", (req, res) => {
  const folderSync = getFolderSync(req.params.id);
  if (!folderSync) {
    res.status(404).json({ error: "Folder sync not found" });
    return;
  }

  const conn = getConnection(folderSync.connectionId);
  if (!conn || conn.orgId !== req.session.orgId || !canAccess(req, conn)) {
    res.status(404).json({ error: "Folder sync not found" });
    return;
  }

  const files = listSyncFiles(folderSync.id);
  res.json({ files });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function getBaseUrl(_req: { protocol: string; get: (name: string) => string | undefined }, provider?: CloudProvider): string {
  // If the org configured their own OAuth credentials, use frontendUrl
  // (their hostname). They registered matching redirect URIs in their console.
  if (provider === "google_drive") {
    const { isCustom } = getGoogleCredentials();
    if (isCustom) {
      const url = new URL(config.frontendUrl);
      return url.origin;
    }
  }
  // Shipped credentials: always use localhost (desktop app, single redirect URI
  // registered in Edgebric's product OAuth console).
  return `http://localhost:${config.port}`;
}
