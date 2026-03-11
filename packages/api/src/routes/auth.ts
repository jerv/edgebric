import { Router } from "express";
import type { Router as IRouter } from "express";
import { Issuer, generators } from "openid-client";
import { randomUUID } from "crypto";
import { config } from "../config.js";
import { requireAdmin } from "../middleware/auth.js";
import { getIntegrationConfig } from "../services/integrationConfigStore.js";

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

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
// Frontend checks this on load to determine session state.

authRouter.get("/me", (req, res) => {
  if (!req.session.queryToken) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const orgConfig = getIntegrationConfig();
  res.json({
    isAdmin: req.session.isAdmin ?? false,
    queryToken: req.session.queryToken,
    email: req.session.email,
    ...(req.session.name && { name: req.session.name }),
    ...(req.session.picture && { picture: req.session.picture }),
    privateModeEnabled: orgConfig.privateModeEnabled ?? false,
    vaultModeEnabled: orgConfig.vaultModeEnabled ?? false,
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
    }) as string;

    // Flush session to disk before the redirect so the callback can read
    // codeVerifier + oidcState from the same session.
    req.session.save((err) => {
      if (err) {
        console.error("Session save error before login redirect:", err);
        res.status(500).json({ error: "Session error" });
        return;
      }
      res.redirect(url);
    });
  } catch (err) {
    console.error("OIDC login error:", err);
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

    // Regenerate session to prevent session fixation attacks
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });

    req.session.queryToken = randomUUID();
    req.session.isAdmin = isAdmin;
    // Store name + picture + email for all users.
    // Email is needed to link conversations to users.
    req.session.email = email;
    if (claims.name) req.session.name = claims.name;
    if (claims.picture) req.session.picture = claims.picture;

    req.session.save((err) => {
      if (err) {
        console.error("Session save error after callback:", err);
        res.status(500).json({ error: "Session error" });
        return;
      }
      res.redirect(config.frontendUrl);
    });
  } catch (err) {
    console.error("OIDC callback error:", err);
    // Restart flow on any error — gives the user a clean retry path
    res.redirect("/api/auth/login");
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

authRouter.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error("Session destroy error:", err);
    res.clearCookie("connect.sid", { path: "/" });
    res.json({ ok: true });
  });
});

// POST /api/auth/logout-redirect — destroys session and redirects to login.
// Used by the frontend sign-out button via a form POST so the page fully reloads.
authRouter.post("/logout-redirect", (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error("Session destroy error:", err);
    res.clearCookie("connect.sid", { path: "/" });
    res.redirect("/api/auth/login");
  });
});

// ─── GET /api/auth/devices (admin only) ──────────────────────────────────────
// Device tokens no longer exist — sessions are managed by the OIDC IdP.
// Stub retained so the admin Devices panel doesn't receive a 404.

authRouter.get("/devices", requireAdmin, (_req, res) => {
  res.json([]);
});
