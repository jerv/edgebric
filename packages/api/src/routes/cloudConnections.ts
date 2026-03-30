/**
 * Cloud storage connection API routes.
 *
 * All routes require admin access. Handles:
 * - OAuth flow (authorize + callback)
 * - Connection CRUD
 * - Folder browsing
 * - Manual sync trigger
 * - Sync file listing
 */
import { Router } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { randomBytes, timingSafeEqual } from "crypto";
import { requireAdmin } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { getConnector, getRegisteredProviders } from "../connectors/registry.js";
import {
  createConnection,
  getConnection,
  listConnections,
  updateConnection,
  deleteConnection,
  listSyncFiles,
} from "../services/cloudConnectionStore.js";
import { saveTokens, deleteTokens } from "../services/cloudTokenStore.js";
import { getValidAccessToken } from "../services/cloudTokenStore.js";
import { createDataSource, archiveDataSource } from "../services/dataSourceStore.js";
import { syncConnection } from "../jobs/syncConnection.js";
import { isConnectionSyncing } from "../jobs/syncScheduler.js";
import { recordAuditEvent } from "../services/auditLog.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import type { CloudProvider } from "@edgebric/types";
import { CLOUD_PROVIDERS } from "@edgebric/types";

export const cloudConnectionsRouter: IRouter = Router();
cloudConnectionsRouter.use(requireAdmin);

// ─── List available providers ───────────────────────────────────────────────

cloudConnectionsRouter.get("/providers", (_req, res) => {
  const registered = new Set(getRegisteredProviders());
  const providers = CLOUD_PROVIDERS.map((p) => ({
    ...p,
    enabled: registered.has(p.id),
  }));
  res.json({ providers });
});

// ─── List connections ───────────────────────────────────────────────────────

cloudConnectionsRouter.get("/", (req, res) => {
  const orgId = req.session.orgId;
  if (!orgId) { res.status(400).json({ error: "No org selected" }); return; }

  const connections = listConnections(orgId);
  res.json({ connections });
});

// ─── Get connection detail ──────────────────────────────────────────────────

cloudConnectionsRouter.get("/:id", (req, res) => {
  const conn = getConnection(req.params.id);
  if (!conn || conn.orgId !== req.session.orgId) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  const syncing = isConnectionSyncing(conn.id);
  res.json({ connection: conn, syncing });
});

// ─── OAuth: Get authorization URL ───────────────────────────────────────────

const authorizeSchema = z.object({
  provider: z.enum(["google_drive", "onedrive", "dropbox", "notion", "confluence"]),
});

cloudConnectionsRouter.post("/oauth/authorize", validateBody(authorizeSchema), (req, res) => {
  const { provider } = req.body as z.infer<typeof authorizeSchema>;
  const connector = getConnector(provider);
  if (!connector) {
    res.status(400).json({ error: `Provider ${provider} is not available` });
    return;
  }

  // Generate CSRF state token — stored in session, verified on callback
  const stateNonce = randomBytes(32).toString("hex");
  const statePayload = JSON.stringify({ provider, nonce: stateNonce });
  const state = Buffer.from(statePayload).toString("base64url");

  // Store nonce in session for verification
  req.session.cloudOAuthNonce = stateNonce;

  const redirectUri = `${getBaseUrl(req)}/api/admin/cloud-connections/oauth/callback`;
  const authUrl = connector.getAuthUrl(state, redirectUri);

  res.json({ authUrl });
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

    // Decode and verify state
    let stateData: { provider: string; nonce: string };
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
    // Clear the nonce
    delete req.session.cloudOAuthNonce;

    const provider = stateData.provider as CloudProvider;
    const connector = getConnector(provider);
    if (!connector) {
      res.status(400).json({ error: `Unknown provider: ${provider}` });
      return;
    }

    const redirectUri = `${getBaseUrl(req)}/api/admin/cloud-connections/oauth/callback`;

    // Exchange code for tokens
    const tokens = await connector.exchangeCode(code, redirectUri);

    // Create the data source and connection
    const orgId = req.session.orgId!;
    const email = req.session.email!;
    const providerName = CLOUD_PROVIDERS.find((p) => p.id === provider)?.name ?? provider;
    const displayName = tokens.accountEmail
      ? `${providerName} (${tokens.accountEmail})`
      : providerName;

    const ds = createDataSource({
      name: displayName,
      description: `Synced from ${providerName}`,
      type: "organization",
      ownerId: email,
      orgId,
    });

    const conn = createConnection({
      provider,
      displayName,
      dataSourceId: ds.id,
      orgId,
      accountEmail: tokens.accountEmail,
      createdBy: email,
    });

    // Store encrypted tokens
    saveTokens(conn.id, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
    });

    // Audit
    void recordAuditEvent({
      eventType: "cloud_connection.create",
      actorEmail: email,
      actorIp: req.ip ?? "",
      resourceType: "cloud_connection",
      resourceId: conn.id,
      details: { provider, accountEmail: tokens.accountEmail },
    });

    // Redirect to the integrations page with the new connection ID
    res.redirect(`${config.frontendUrl}/integrations?connectionId=${conn.id}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg }, "OAuth callback failed");
    res.redirect(`${config.frontendUrl}/integrations?error=${encodeURIComponent("Authentication failed")}`);
  }
});

// ─── Update connection (folder selection, settings) ─────────────────────────

const updateSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  folderId: z.string().min(1).optional(),
  folderName: z.string().min(1).max(500).optional(),
  syncIntervalMin: z.number().int().min(5).max(1440).optional(),
  status: z.enum(["active", "paused"]).optional(),
});

cloudConnectionsRouter.put("/:id", validateBody(updateSchema), (req, res) => {
  const conn = getConnection(req.params.id as string);
  if (!conn || conn.orgId !== req.session.orgId) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  const data = req.body as z.infer<typeof updateSchema>;

  // If folder changed, reset the sync cursor so next sync does a full re-scan
  const folderChanged = data.folderId && data.folderId !== conn.folderId;

  // Build update object, only including defined fields
  const updateData: Parameters<typeof updateConnection>[1] = {};
  if (data.displayName !== undefined) updateData.displayName = data.displayName;
  if (data.folderId !== undefined) updateData.folderId = data.folderId;
  if (data.folderName !== undefined) updateData.folderName = data.folderName;
  if (data.syncIntervalMin !== undefined) updateData.syncIntervalMin = data.syncIntervalMin;
  if (data.status !== undefined) updateData.status = data.status;
  if (folderChanged) updateData.syncCursor = null;

  const updated = updateConnection(conn.id, updateData);

  res.json({ connection: updated });
});

// ─── Delete connection ──────────────────────────────────────────────────────

cloudConnectionsRouter.delete("/:id", (req, res) => {
  const conn = getConnection(req.params.id);
  if (!conn || conn.orgId !== req.session.orgId) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  // Archive the linked data source (keeps documents for reference)
  archiveDataSource(conn.dataSourceId);

  // Delete tokens
  deleteTokens(conn.id);

  // Delete connection and sync files
  deleteConnection(conn.id);

  // Audit
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

// ─── Browse folders ─────────────────────────────────────────────────────────

cloudConnectionsRouter.get("/:id/folders", async (req, res) => {
  try {
    const conn = getConnection(req.params.id);
    if (!conn || conn.orgId !== req.session.orgId) {
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

// ─── Manual sync trigger ────────────────────────────────────────────────────

cloudConnectionsRouter.post("/:id/sync", async (req, res) => {
  try {
    const conn = getConnection(req.params.id);
    if (!conn || conn.orgId !== req.session.orgId) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    if (!conn.folderId) {
      res.status(400).json({ error: "No folder configured for this connection" });
      return;
    }

    if (isConnectionSyncing(conn.id)) {
      res.status(409).json({ error: "Sync already in progress" });
      return;
    }

    const stats = await syncConnection(conn.id);

    // Audit
    void recordAuditEvent({
      eventType: "cloud_connection.sync",
      actorEmail: req.session.email ?? "",
      actorIp: req.ip ?? "",
      resourceType: "cloud_connection",
      resourceId: conn.id,
      details: { provider: conn.provider, ...stats },
    });

    res.json({ synced: true, ...stats });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg }, "Manual sync failed");
    res.status(500).json({ error: "Sync failed", details: errMsg });
  }
});

// ─── List sync files ────────────────────────────────────────────────────────

cloudConnectionsRouter.get("/:id/files", (req, res) => {
  const conn = getConnection(req.params.id);
  if (!conn || conn.orgId !== req.session.orgId) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  const files = listSyncFiles(conn.id);
  res.json({ files });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Get the base URL for OAuth redirects. */
function getBaseUrl(req: { protocol: string; get: (name: string) => string | undefined }): string {
  // In dev, API runs on a different port than the frontend
  if (process.env["NODE_ENV"] !== "production") {
    return `http://localhost:${config.port}`;
  }
  const host = req.get("host") ?? `localhost:${config.port}`;
  return `${req.protocol}://${host}`;
}
