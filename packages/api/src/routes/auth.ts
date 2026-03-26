import { Router } from "express";
import type { Router as IRouter } from "express";
import { Issuer, generators } from "openid-client";
import { randomUUID, randomBytes } from "crypto";
import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { recordAuditEvent } from "../services/auditLog.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";
import { ensureDefaultOrg, getDefaultOrg, getOrg, getOrgsForUser } from "../services/orgStore.js";
import { upsertUser, getUserInOrg, getUsersByEmail, updateUserName, updateUserNotifPrefs } from "../services/userStore.js";

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100).transform((s) => s.trim()),
  lastName: z.string().max(100).optional().transform((s) => s?.trim()),
});

const selectOrgSchema = z.object({
  orgId: z.string().min(1, "orgId is required"),
});

const notifPrefsSchema = z.object({
  defaultGroupChatNotifLevel: z.enum(["all", "mentions", "none"]),
});

export const authRouter: IRouter = Router();

// ─── OIDC client (lazy singleton) ────────────────────────────────────────────

// Typed as unknown to avoid importing internal openid-client Client type
let _client: unknown = null;

async function getClient() {
  if (!_client) {
    const issuer = await Issuer.discover(config.oidc.issuer);
    _client = new issuer.Client({
      client_id: config.oidc.clientId,
      client_secret: config.oidc.clientSecret,
      redirect_uris: [config.oidc.redirectUri],
      response_types: ["code"],
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return _client as any;
}

// ─── Session transfer tokens ─────────────────────────────────────────────────
// OIDC callback lands on localhost (Google requirement). If the frontend runs
// on a different origin (e.g. edgebric.local), we can't just redirect — the
// session cookie from localhost won't be sent to edgebric.local. Instead, we
// issue a short-lived, single-use claim token that the target origin exchanges
// for a new session.

interface ClaimTokenData {
  queryToken: string;
  isAdmin: boolean;
  email: string;
  name?: string;
  picture?: string;
  orgId?: string;
  orgSlug?: string;
  createdAt: number;
}

const claimTokens = new Map<string, ClaimTokenData>();
const CLAIM_TOKEN_TTL_MS = 30_000; // 30 seconds

// Purge expired tokens periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of claimTokens) {
    if (now - data.createdAt > CLAIM_TOKEN_TTL_MS) {
      claimTokens.delete(token);
    }
  }
}, 60_000);

/** Check if FRONTEND_URL is on a different origin than the OIDC callback (localhost) */
function needsCrossOriginTransfer(): boolean {
  try {
    const frontendOrigin = new URL(config.frontendUrl).hostname;
    return frontendOrigin !== "localhost" && frontendOrigin !== "127.0.0.1";
  } catch {
    return false;
  }
}

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
// Frontend checks this on load to determine session state.

authRouter.get("/me", (req, res) => {
  // Solo mode — auto-authenticated admin, skip OIDC/org lookups
  if (config.authMode === "none") {
    if (!req.session.queryToken) {
      req.session.queryToken = "solo-user";
      req.session.isAdmin = true;
      req.session.email = "solo@localhost";
      req.session.name = "You";
      req.session.orgId = "solo";
      req.session.orgSlug = "solo";
    }
    res.json({
      isAdmin: true,
      queryToken: req.session.queryToken,
      email: req.session.email,
      name: req.session.name,
      orgId: "solo",
      orgName: "Edgebric",
      orgSlug: "solo",
      privateModeEnabled: false,
      vaultModeEnabled: true,
      canCreateKBs: true,
      defaultGroupChatNotifLevel: "all",
      onboardingComplete: true,
      needsNameSetup: false,
      authMode: "none",
    });
    return;
  }

  if (!req.session.queryToken || !req.session.email) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // If user has selected an org, include org details
  const orgId = req.session.orgId;
  const org = orgId ? getOrg(orgId) : getDefaultOrg();
  const orgConfig = getIntegrationConfig();

  // Check admin status in the context of the selected org
  let isAdmin = req.session.isAdmin ?? false;
  if (orgId && req.session.email) {
    const userInOrg = getUserInOrg(req.session.email, orgId);
    isAdmin = userInOrg?.role === "admin" || userInOrg?.role === "owner";
  }

  // Check if user needs to set up their name (first sign-in or no name set)
  const userRecord = (orgId && req.session.email) ? getUserInOrg(req.session.email, orgId) : undefined;
  const displayName = userRecord?.name ?? req.session.name;

  // canCreateKBs: admins always can; members need explicit permission
  const canCreateKBs = isAdmin || (userRecord?.canCreateKBs ?? false);

  res.json({
    isAdmin,
    queryToken: req.session.queryToken,
    email: req.session.email,
    ...(displayName && { name: displayName }),
    ...(req.session.picture && { picture: req.session.picture }),
    orgId: orgId ?? org?.id,
    orgName: org?.name,
    orgSlug: org?.slug,
    privateModeEnabled: orgConfig.privateModeEnabled ?? false,
    vaultModeEnabled: orgConfig.vaultModeEnabled ?? false,
    canCreateKBs,
    defaultGroupChatNotifLevel: userRecord?.defaultGroupChatNotifLevel ?? "all",
    onboardingComplete: org?.settings.onboardingComplete ?? false,
    needsNameSetup: !displayName,
    orgAvatarUrl: org?.settings.avatarUrl,
    authMode: "oidc",
  });
});

// ─── GET /api/auth/login ──────────────────────────────────────────────────────
// Initiates OIDC authorization code flow with PKCE.
// Must be a browser redirect (not fetch) so the browser navigates to the IdP.

authRouter.get("/login", async (req, res) => {
  try {
    const client = await getClient();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const state = generators.state();

    req.session.codeVerifier = codeVerifier;
    req.session.oidcState = state;

    const url = client.authorizationUrl({
      scope: "openid email profile",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }) as string;

    // Flush session to disk before the redirect so the callback can read
    // codeVerifier + oidcState from the same session.
    req.session.save((err) => {
      if (err) {
        logger.error({ err }, "Session save error before login redirect");
        res.status(500).json({ error: "Session error" });
        return;
      }
      res.redirect(url);
    });
  } catch (err) {
    logger.error({ err }, "OIDC login error");
    res.status(500).json({ error: "OIDC configuration error. Check server logs." });
  }
});

// ─── GET /api/auth/callback ───────────────────────────────────────────────────
// IdP redirects here after authentication.

authRouter.get("/callback", async (req, res) => {
  try {
    const client = await getClient();
    const params = client.callbackParams(req);

    const tokenSet = await client.callback(config.oidc.redirectUri, params, {
      state: req.session.oidcState,
      code_verifier: req.session.codeVerifier,
    });

    const claims = tokenSet.claims() as { email?: string; name?: string; picture?: string };
    const email = claims.email?.toLowerCase();

    if (!email) {
      res.status(400).send("No email in ID token. Ensure the 'email' scope is granted.");
      return;
    }

    const isAdmin = (config.adminEmails as readonly string[]).includes(email);

    // Upsert user record (creates org on first-ever login)
    const org = ensureDefaultOrg();
    const role = isAdmin ? "admin" as const : "member" as const;
    upsertUser({
      email,
      ...(claims.name && { name: claims.name }),
      ...(claims.picture && { picture: claims.picture }),
      role,
      orgId: org.id,
    });

    // Find all orgs this user belongs to
    const userOrgs = getOrgsForUser(email);

    // Regenerate session to prevent session fixation attacks
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });

    req.session.queryToken = randomUUID();
    req.session.isAdmin = isAdmin;
    req.session.email = email;
    if (claims.name) req.session.name = claims.name;
    if (claims.picture) req.session.picture = claims.picture;

    // Auto-select org if user belongs to exactly one
    if (userOrgs.length === 1) {
      req.session.orgId = userOrgs[0]!.id;
      req.session.orgSlug = userOrgs[0]!.slug;
    }

    recordAuditEvent({
      eventType: "auth.login",
      actorEmail: email,
      actorIp: req.ip,
      details: { isAdmin, method: "oidc" },
    });

    if (needsCrossOriginTransfer()) {
      // OIDC callback landed on localhost, but frontend is on a different
      // origin (e.g. edgebric.local). Issue a one-time claim token and
      // redirect to the frontend origin's /api/auth/claim endpoint.
      const token = randomBytes(32).toString("hex");
      claimTokens.set(token, {
        queryToken: req.session.queryToken,
        isAdmin: req.session.isAdmin,
        email: req.session.email!,
        ...(req.session.name != null && { name: req.session.name }),
        ...(req.session.picture != null && { picture: req.session.picture }),
        ...(req.session.orgId != null && { orgId: req.session.orgId }),
        ...(req.session.orgSlug != null && { orgSlug: req.session.orgSlug }),
        createdAt: Date.now(),
      });
      // Redirect to the frontend origin — the /api/auth/claim handler will
      // create a session on that origin and redirect to the app.
      res.redirect(`${config.frontendUrl}/api/auth/claim?token=${token}`);
    } else {
      // Same origin — just save the session and redirect.
      req.session.save((err) => {
        if (err) {
          logger.error({ err }, "Session save error after callback");
          res.status(500).json({ error: "Session error" });
          return;
        }
        res.redirect(config.frontendUrl);
      });
    }
  } catch (err) {
    logger.error({ err }, "OIDC callback error");
    // Redirect to frontend (not /api/auth/login) to avoid infinite loop when
    // Google auto-selects the account on retry. The frontend will detect the
    // missing session and show the login page.
    res.redirect(config.frontendUrl);
  }
});

// ─── GET /api/auth/claim ──────────────────────────────────────────────────────
// Exchanges a one-time claim token for a session on the current origin.
// Used after OIDC callback on localhost to transfer the session to edgebric.local.

authRouter.get("/claim", (req, res) => {
  const token = req.query["token"];
  if (typeof token !== "string" || !token) {
    res.status(400).json({ error: "Missing token" });
    return;
  }

  const data = claimTokens.get(token);
  if (!data) {
    // Token expired or already used — redirect to login
    logger.warn("Claim token not found or expired");
    res.redirect(config.frontendUrl);
    return;
  }

  // Single-use: delete immediately
  claimTokens.delete(token);

  // Check TTL
  if (Date.now() - data.createdAt > CLAIM_TOKEN_TTL_MS) {
    logger.warn("Claim token expired");
    res.redirect(config.frontendUrl);
    return;
  }

  // Regenerate session on this origin and populate with the claim data
  req.session.regenerate((err) => {
    if (err) {
      logger.error({ err }, "Session regenerate error during claim");
      res.status(500).json({ error: "Session error" });
      return;
    }

    req.session.queryToken = data.queryToken;
    req.session.isAdmin = data.isAdmin;
    req.session.email = data.email;
    if (data.name) req.session.name = data.name;
    if (data.picture) req.session.picture = data.picture;
    if (data.orgId) req.session.orgId = data.orgId;
    if (data.orgSlug) req.session.orgSlug = data.orgSlug;

    req.session.save((saveErr) => {
      if (saveErr) {
        logger.error({ err: saveErr }, "Session save error during claim");
        res.status(500).json({ error: "Session error" });
        return;
      }
      res.redirect(config.frontendUrl);
    });
  });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

const COOKIE_CLEAR_OPTS = { path: "/", httpOnly: true, sameSite: "lax" as const };

authRouter.post("/logout", (req, res) => {
  const email = req.session.email;
  recordAuditEvent({ eventType: "auth.logout", actorEmail: email, actorIp: req.ip });
  req.session.destroy((err) => {
    if (err) logger.error({ err }, "Session destroy error");
    res.clearCookie("edgebric.sid", COOKIE_CLEAR_OPTS);
    res.clearCookie("connect.sid", { path: "/" }); // clear legacy cookie if present
    res.json({ ok: true });
  });
});

// POST /api/auth/logout-redirect — destroys session and redirects to frontend.
// Redirects to frontend (not /api/auth/login) so the user sees the sign-in page
// instead of being auto-re-authenticated by the OIDC IdP.
authRouter.post("/logout-redirect", (req, res) => {
  req.session.destroy((err) => {
    if (err) logger.error({ err }, "Session destroy error");
    res.clearCookie("edgebric.sid", COOKIE_CLEAR_OPTS);
    res.clearCookie("connect.sid", { path: "/" }); // clear legacy cookie if present
    res.redirect(config.frontendUrl);
  });
});

// ─── PUT /api/auth/profile — update user's display name ──────────────────────

authRouter.put("/profile", requireAuth, validateBody(profileSchema), (req, res) => {
  const { firstName, lastName } = req.body as z.infer<typeof profileSchema>;
  const email = req.session.email;
  const orgId = req.session.orgId;

  if (!email) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const fullName = lastName ? `${firstName} ${lastName}` : firstName;

  // Update in all orgs this user belongs to if no org selected, otherwise just current org
  if (orgId) {
    updateUserName(email, orgId, fullName);
  } else {
    const userRecords = getUsersByEmail(email);
    for (const u of userRecords) {
      updateUserName(email, u.orgId, fullName);
    }
  }

  // Update session name too
  req.session.name = fullName;
  req.session.save((err) => {
    if (err) {
      logger.error({ err }, "Session save error during profile update");
      res.status(500).json({ error: "Session error" });
      return;
    }
    res.json({ ok: true, name: fullName });
  });
});

// ─── PUT /api/auth/notification-prefs — update notification preferences ──────

authRouter.put("/notification-prefs", requireAuth, validateBody(notifPrefsSchema), (req, res) => {
  const { defaultGroupChatNotifLevel } = req.body as z.infer<typeof notifPrefsSchema>;
  const email = req.session.email;
  const orgId = req.session.orgId;

  if (!email) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // Update in all orgs this user belongs to if no org selected, otherwise just current org
  if (orgId) {
    updateUserNotifPrefs(email, orgId, defaultGroupChatNotifLevel);
  } else {
    const userRecords = getUsersByEmail(email);
    for (const u of userRecords) {
      updateUserNotifPrefs(email, u.orgId, defaultGroupChatNotifLevel);
    }
  }

  res.json({ ok: true, defaultGroupChatNotifLevel });
});

// ─── GET /api/auth/orgs — list orgs the current user belongs to ──────────────

authRouter.get("/orgs", requireAuth, (req, res) => {
  const email = req.session.email;
  if (!email) {
    res.json([]);
    return;
  }
  const orgs = getOrgsForUser(email);
  // Include user's role in each org
  const result = orgs.map((org) => {
    const userInOrg = getUserInOrg(email, org.id);
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      role: userInOrg?.role ?? "member",
      selected: org.id === req.session.orgId,
    };
  });
  res.json(result);
});

// ─── POST /api/auth/select-org — switch to a different org ──────────────────

authRouter.post("/select-org", requireAuth, validateBody(selectOrgSchema), (req, res) => {
  const { orgId } = req.body as z.infer<typeof selectOrgSchema>;

  const email = req.session.email;
  if (!email) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // Verify user belongs to this org
  const userInOrg = getUserInOrg(email, orgId);
  if (!userInOrg) {
    res.status(403).json({ error: "You are not a member of this organization" });
    return;
  }

  const org = getOrg(orgId);
  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  req.session.orgId = orgId;
  req.session.orgSlug = org.slug;
  req.session.isAdmin = userInOrg.role === "admin" || userInOrg.role === "owner";

  req.session.save((err) => {
    if (err) {
      logger.error({ err }, "Session save error during org select");
      res.status(500).json({ error: "Session error" });
      return;
    }
    res.json({ ok: true, orgId, orgSlug: org.slug, isAdmin: req.session.isAdmin });
  });
});

// ─── GET /api/auth/devices (admin only) ──────────────────────────────────────
// Device tokens no longer exist — sessions are managed by the OIDC IdP.
// Stub retained so the admin Devices panel doesn't receive a 404.

authRouter.get("/devices", requireAdmin, (_req, res) => {
  res.json([]);
});
