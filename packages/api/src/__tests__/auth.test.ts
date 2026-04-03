import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, teardownTestApp, createAgent, adminAgent, memberAgent, unauthAgent, getDefaultOrgId } from "./helpers.js";
import {
  extractClaims,
  detectProvider,
  OIDC_PROVIDERS,
  isMicrosoftMultiTenant,
  validateMicrosoftIssuer,
} from "../lib/oidcProviders.js";
import { upsertUser } from "../services/userStore.js";

describe("Auth Middleware", () => {
  let orgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
  });
  afterAll(() => { teardownTestApp(); });

  it("returns 401 for unauthenticated requests to protected routes", async () => {
    const res = await unauthAgent().get("/api/conversations");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Authentication required");
  });

  it("returns 428 when no org is selected", async () => {
    const agent = createAgent({ email: "user@test.com" });
    const res = await agent.get("/api/conversations");
    expect(res.status).toBe(428);
    expect(res.body.code).toBe("ORG_REQUIRED");
  });

  it("returns 403 for non-admin accessing admin routes", async () => {
    const res = await memberAgent(orgId).get("/api/admin/models");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Admin access required");
  });

  it("admin can access admin routes", async () => {
    const res = await adminAgent(orgId).get("/api/admin/models");
    expect(res.status).toBe(200);
  });

  it("authenticated user with org can access normal routes", async () => {
    const res = await memberAgent(orgId).get("/api/conversations");
    expect(res.status).toBe(200);
  });
});

describe("Auth Routes", () => {
  let orgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();

    // Seed test users
    upsertUser({
      email: "admin@test.com",
      name: "Admin User",
      role: "admin",
      orgId,
      authProvider: "google",
      authProviderSub: "google-sub-admin",
    });
    upsertUser({
      email: "member@test.com",
      name: "Test Member",
      role: "member",
      orgId,
      authProvider: "google",
      authProviderSub: "google-sub-member",
    });
  });

  afterAll(() => { teardownTestApp(); });

  // ─── GET /api/auth/me ───────────────────────────────────────────────────────

  describe("GET /api/auth/me", () => {
    it("returns 401 for unauthenticated requests", async () => {
      const res = await unauthAgent().get("/api/auth/me");
      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Not authenticated");
    });

    it("returns session data for authenticated admin", async () => {
      const res = await adminAgent(orgId).get("/api/auth/me");
      expect(res.status).toBe(200);
      expect(res.body.isAdmin).toBe(true);
      expect(res.body.email).toBe("admin@test.com");
      expect(typeof res.body.queryToken).toBe("string");
      expect(res.body.authMode).toBe("oidc");
    });

    it("returns session data for authenticated member", async () => {
      const res = await memberAgent(orgId).get("/api/auth/me");
      expect(res.status).toBe(200);
      expect(res.body.isAdmin).toBe(false);
      expect(res.body.email).toBe("member@test.com");
    });

    it("includes org info when org is selected", async () => {
      const res = await adminAgent(orgId).get("/api/auth/me");
      expect(res.status).toBe(200);
      expect(res.body.orgId).toBe(orgId);
      expect(typeof res.body.orgName).toBe("string");
      expect(typeof res.body.orgSlug).toBe("string");
    });

    it("includes integration config flags", async () => {
      const res = await memberAgent(orgId).get("/api/auth/me");
      expect(res.status).toBe(200);
      expect(typeof res.body.privateModeEnabled).toBe("boolean");
      expect(typeof res.body.vaultModeEnabled).toBe("boolean");
    });
  });

  // ─── GET /api/auth/provider ─────────────────────────────────────────────────

  describe("GET /api/auth/provider", () => {
    it("returns provider info without authentication", async () => {
      const res = await unauthAgent().get("/api/auth/provider");
      expect(res.status).toBe(200);
      expect(typeof res.body.provider).toBe("string");
      expect(typeof res.body.providerName).toBe("string");
    });
  });

  // ─── POST /api/auth/logout ──────────────────────────────────────────────────

  describe("POST /api/auth/logout", () => {
    it("returns ok on logout", async () => {
      const res = await adminAgent(orgId).post("/api/auth/logout");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  // ─── PUT /api/auth/profile ──────────────────────────────────────────────────

  describe("PUT /api/auth/profile", () => {
    it("updates user name with first and last", async () => {
      const res = await adminAgent(orgId)
        .put("/api/auth/profile")
        .send({ firstName: "Admin", lastName: "Updated" });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.name).toBe("Admin Updated");
    });

    it("accepts first name only", async () => {
      const res = await adminAgent(orgId)
        .put("/api/auth/profile")
        .send({ firstName: "Solo" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Solo");
    });

    it("rejects empty first name", async () => {
      const res = await adminAgent(orgId)
        .put("/api/auth/profile")
        .send({ firstName: "" });
      expect(res.status).toBe(400);
    });

    it("rejects unauthenticated request", async () => {
      const res = await unauthAgent()
        .put("/api/auth/profile")
        .send({ firstName: "Hacker" });
      expect(res.status).toBe(401);
    });
  });

  // ─── PUT /api/auth/notification-prefs ───────────────────────────────────────

  describe("PUT /api/auth/notification-prefs", () => {
    it("updates notification level", async () => {
      const res = await memberAgent(orgId)
        .put("/api/auth/notification-prefs")
        .send({ defaultGroupChatNotifLevel: "mentions" });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.defaultGroupChatNotifLevel).toBe("mentions");
    });

    it("accepts all valid levels", async () => {
      for (const level of ["all", "mentions", "none"]) {
        const res = await memberAgent(orgId)
          .put("/api/auth/notification-prefs")
          .send({ defaultGroupChatNotifLevel: level });
        expect(res.status).toBe(200);
      }
    });

    it("rejects invalid level", async () => {
      const res = await memberAgent(orgId)
        .put("/api/auth/notification-prefs")
        .send({ defaultGroupChatNotifLevel: "invalid" });
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /api/auth/orgs ─────────────────────────────────────────────────────

  describe("GET /api/auth/orgs", () => {
    it("returns orgs for authenticated user", async () => {
      const res = await adminAgent(orgId).get("/api/auth/orgs");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0]).toHaveProperty("id");
      expect(res.body[0]).toHaveProperty("name");
      expect(res.body[0]).toHaveProperty("slug");
      expect(res.body[0]).toHaveProperty("role");
    });

    it("rejects unauthenticated request", async () => {
      const res = await unauthAgent().get("/api/auth/orgs");
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /api/auth/select-org ──────────────────────────────────────────────

  describe("POST /api/auth/select-org", () => {
    it("selects an org the user belongs to", async () => {
      const res = await adminAgent(orgId)
        .post("/api/auth/select-org")
        .send({ orgId });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.orgId).toBe(orgId);
    });

    it("rejects selecting an org the user doesn't belong to", async () => {
      const res = await memberAgent(orgId)
        .post("/api/auth/select-org")
        .send({ orgId: "nonexistent-org-id" });
      expect(res.status).toBe(403);
    });

    it("rejects missing orgId", async () => {
      const res = await adminAgent(orgId)
        .post("/api/auth/select-org")
        .send({});
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /api/auth/devices (admin stub) ─────────────────────────────────────

  describe("GET /api/auth/devices", () => {
    it("returns empty array for admin", async () => {
      const res = await adminAgent(orgId).get("/api/auth/devices");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("rejects non-admin", async () => {
      const res = await memberAgent(orgId).get("/api/auth/devices");
      expect(res.status).toBe(403);
    });
  });

  // ─── GET /api/auth/avatar ───────────────────────────────────────────────────

  describe("GET /api/auth/avatar/:userId", () => {
    it("returns 404 for nonexistent avatar", async () => {
      const res = await memberAgent(orgId).get("/api/auth/avatar/nonexistent-user");
      expect(res.status).toBe(404);
    });

    it("rejects path traversal attempts", async () => {
      const res = await memberAgent(orgId).get("/api/auth/avatar/..%2F..%2Fetc%2Fpasswd");
      expect([400, 404]).toContain(res.status);
    });
  });
});

// ─── Unit tests for OIDC provider utilities ─────────────────────────────────

describe("OIDC Provider Utilities", () => {
  describe("extractClaims", () => {
    it("extracts standard Google claims", () => {
      const claims = extractClaims(
        { sub: "google-123", email: "user@example.com", name: "John Doe", picture: "https://photo.url" },
        OIDC_PROVIDERS.google,
      );
      expect(claims.email).toBe("user@example.com");
      expect(claims.name).toBe("John Doe");
      expect(claims.picture).toBe("https://photo.url");
      expect(claims.sub).toBe("google-123");
    });

    it("extracts Microsoft claims via fallback preferred_username", () => {
      const claims = extractClaims(
        { sub: "ms-456", preferred_username: "user@company.com", name: "Jane Smith" },
        OIDC_PROVIDERS.microsoft,
      );
      expect(claims.email).toBe("user@company.com");
      expect(claims.name).toBe("Jane Smith");
      expect(claims.picture).toBeUndefined();
    });

    it("extracts Microsoft claims via upn fallback", () => {
      const claims = extractClaims(
        { sub: "ms-789", upn: "admin@corp.com", name: "Admin Corp" },
        OIDC_PROVIDERS.microsoft,
      );
      expect(claims.email).toBe("admin@corp.com");
    });

    it("prefers primary email claim over fallbacks", () => {
      const claims = extractClaims(
        { sub: "ms-multi", email: "primary@example.com", preferred_username: "fallback@example.com", upn: "upn@example.com" },
        OIDC_PROVIDERS.microsoft,
      );
      expect(claims.email).toBe("primary@example.com");
    });

    it("generic provider uses preferred_username as email fallback", () => {
      const claims = extractClaims(
        { sub: "gen-1", preferred_username: "user@custom.com", given_name: "Custom User" },
        OIDC_PROVIDERS.generic,
      );
      expect(claims.email).toBe("user@custom.com");
      expect(claims.name).toBe("Custom User");
    });

    it("normalizes email to lowercase", () => {
      const claims = extractClaims(
        { sub: "case-1", email: "User@EXAMPLE.COM", name: "Case Test" },
        OIDC_PROVIDERS.google,
      );
      expect(claims.email).toBe("user@example.com");
    });

    it("throws when no email claim is found", () => {
      expect(() =>
        extractClaims(
          { sub: "no-email", name: "No Email User" },
          OIDC_PROVIDERS.google,
        ),
      ).toThrow("No email found");
    });

    it("throws when sub claim is missing", () => {
      expect(() =>
        extractClaims(
          { email: "user@example.com", name: "No Sub" },
          OIDC_PROVIDERS.google,
        ),
      ).toThrow("No 'sub' claim");
    });

    it("throws for empty string sub", () => {
      expect(() =>
        extractClaims(
          { sub: "", email: "user@example.com" },
          OIDC_PROVIDERS.google,
        ),
      ).toThrow("No 'sub' claim");
    });

    it("handles missing optional claims gracefully", () => {
      const claims = extractClaims(
        { sub: "minimal-1", email: "minimal@example.com" },
        OIDC_PROVIDERS.google,
      );
      expect(claims.email).toBe("minimal@example.com");
      expect(claims.name).toBeUndefined();
      expect(claims.picture).toBeUndefined();
    });
  });

  describe("detectProvider", () => {
    it("detects Google", () => {
      expect(detectProvider("https://accounts.google.com")).toBe("google");
    });

    it("detects Microsoft from microsoftonline", () => {
      expect(detectProvider("https://login.microsoftonline.com/tenant-id/v2.0")).toBe("microsoft");
    });

    it("detects Microsoft from login.microsoft", () => {
      expect(detectProvider("https://login.microsoft.com/common/v2.0")).toBe("microsoft");
    });

    it("detects Okta", () => {
      expect(detectProvider("https://company.okta.com/oauth2/default")).toBe("okta");
    });

    it("detects OneLogin", () => {
      expect(detectProvider("https://company.onelogin.com/oidc/2")).toBe("onelogin");
    });

    it("detects Ping Identity from pingidentity", () => {
      expect(detectProvider("https://auth.pingidentity.com/as")).toBe("ping");
    });

    it("detects Ping Identity from pingone", () => {
      expect(detectProvider("https://auth.pingone.com/env-id/as")).toBe("ping");
    });

    it("returns generic for unknown issuer", () => {
      expect(detectProvider("https://custom-idp.example.com")).toBe("generic");
    });

    it("is case-insensitive", () => {
      expect(detectProvider("https://accounts.GOOGLE.com")).toBe("google");
      expect(detectProvider("https://LOGIN.MICROSOFTONLINE.COM/t/v2.0")).toBe("microsoft");
    });
  });

  describe("OIDC_PROVIDERS registry", () => {
    it("has all 6 providers defined", () => {
      const expectedIds: string[] = ["google", "microsoft", "okta", "onelogin", "ping", "generic"];
      expect(Object.keys(OIDC_PROVIDERS).sort()).toEqual(expectedIds.sort());
    });

    it("all providers have required fields", () => {
      for (const [id, def] of Object.entries(OIDC_PROVIDERS)) {
        expect(def.id).toBe(id);
        expect(typeof def.name).toBe("string");
        expect(Array.isArray(def.imgSrcDomains)).toBe(true);
        expect(Array.isArray(def.extraScopes)).toBe(true);
        expect(Array.isArray(def.claimsMapping.email)).toBe(true);
        expect(def.claimsMapping.email.length).toBeGreaterThan(0);
      }
    });

    it("Microsoft has User.Read extra scope", () => {
      expect(OIDC_PROVIDERS.microsoft.extraScopes).toContain("User.Read");
    });

    it("Google has default issuer set", () => {
      expect(OIDC_PROVIDERS.google.defaultIssuer).toBe("https://accounts.google.com");
    });
  });

  // ─── Microsoft Entra ID specific tests ──────────────────────────────────────

  describe("Microsoft Entra ID", () => {
    describe("provider definition", () => {
      const ms = OIDC_PROVIDERS.microsoft;

      it("has correct id and name", () => {
        expect(ms.id).toBe("microsoft");
        expect(ms.name).toBe("Microsoft Entra ID");
      });

      it("has no default issuer (tenant-specific)", () => {
        expect(ms.defaultIssuer).toBeUndefined();
      });

      it("has User.Read in extraScopes for Graph API photo fetch", () => {
        expect(ms.extraScopes).toEqual(["User.Read"]);
      });

      it("has no imgSrcDomains (avatars served locally)", () => {
        expect(ms.imgSrcDomains).toEqual([]);
      });

      it("has empty picture claims mapping (fetched via Graph API)", () => {
        expect(ms.claimsMapping.picture).toEqual([]);
      });

      it("has three email fallback claims in priority order", () => {
        expect(ms.claimsMapping.email).toEqual(["email", "preferred_username", "upn"]);
      });

      it("maps name from standard name claim", () => {
        expect(ms.claimsMapping.name).toEqual(["name"]);
      });
    });

    describe("claims extraction", () => {
      const ms = OIDC_PROVIDERS.microsoft;

      it("extracts email from standard email claim", () => {
        const claims = extractClaims(
          { sub: "ms-1", email: "user@contoso.com", name: "User One" },
          ms,
        );
        expect(claims.email).toBe("user@contoso.com");
      });

      it("falls back to preferred_username when email is missing", () => {
        const claims = extractClaims(
          { sub: "ms-2", preferred_username: "user@contoso.com", name: "User Two" },
          ms,
        );
        expect(claims.email).toBe("user@contoso.com");
      });

      it("falls back to upn when email and preferred_username are missing", () => {
        const claims = extractClaims(
          { sub: "ms-3", upn: "user@contoso.onmicrosoft.com", name: "User Three" },
          ms,
        );
        expect(claims.email).toBe("user@contoso.onmicrosoft.com");
      });

      it("uses first available email claim in priority order", () => {
        const claims = extractClaims(
          {
            sub: "ms-4",
            email: "primary@contoso.com",
            preferred_username: "alt@contoso.com",
            upn: "upn@contoso.com",
            name: "User Four",
          },
          ms,
        );
        expect(claims.email).toBe("primary@contoso.com");
      });

      it("skips empty string email and uses next fallback", () => {
        const claims = extractClaims(
          { sub: "ms-5", email: "", preferred_username: "fallback@contoso.com" },
          ms,
        );
        expect(claims.email).toBe("fallback@contoso.com");
      });

      it("returns undefined picture (fetched via Graph API separately)", () => {
        const claims = extractClaims(
          { sub: "ms-6", email: "user@contoso.com", name: "User Six" },
          ms,
        );
        expect(claims.picture).toBeUndefined();
      });

      it("normalizes Microsoft email to lowercase", () => {
        const claims = extractClaims(
          { sub: "ms-7", email: "User@CONTOSO.COM" },
          ms,
        );
        expect(claims.email).toBe("user@contoso.com");
      });

      it("throws when no email claim is available from any fallback", () => {
        expect(() =>
          extractClaims({ sub: "ms-8", name: "No Email" }, ms),
        ).toThrow("No email found");
      });

      it("handles guest user claims (external email via preferred_username)", () => {
        const claims = extractClaims(
          {
            sub: "ms-guest-1",
            preferred_username: "guest@external.com",
            name: "Guest User",
          },
          ms,
        );
        expect(claims.email).toBe("guest@external.com");
        expect(claims.name).toBe("Guest User");
      });

      it("handles B2B guest with onmicrosoft.com UPN", () => {
        const claims = extractClaims(
          {
            sub: "ms-b2b-1",
            upn: "guest_external.com#EXT#@contoso.onmicrosoft.com",
          },
          ms,
        );
        expect(claims.email).toBe("guest_external.com#ext#@contoso.onmicrosoft.com");
      });

      it("extracts sub claim as pairwise identifier", () => {
        const claims = extractClaims(
          { sub: "aBcDeFgHiJkLmN-1234567890", email: "user@contoso.com" },
          ms,
        );
        expect(claims.sub).toBe("aBcDeFgHiJkLmN-1234567890");
      });
    });

    describe("isMicrosoftMultiTenant", () => {
      it("detects common endpoint as multi-tenant", () => {
        expect(isMicrosoftMultiTenant("https://login.microsoftonline.com/common/v2.0")).toBe(true);
      });

      it("detects organizations endpoint as multi-tenant", () => {
        expect(isMicrosoftMultiTenant("https://login.microsoftonline.com/organizations/v2.0")).toBe(true);
      });

      it("returns false for single-tenant with UUID", () => {
        expect(isMicrosoftMultiTenant("https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0")).toBe(false);
      });

      it("returns false for non-Microsoft URLs", () => {
        expect(isMicrosoftMultiTenant("https://accounts.google.com")).toBe(false);
      });

      it("is case-insensitive", () => {
        expect(isMicrosoftMultiTenant("https://LOGIN.MICROSOFTONLINE.COM/COMMON/v2.0")).toBe(true);
      });

      it("returns false for consumers endpoint", () => {
        expect(isMicrosoftMultiTenant("https://login.microsoftonline.com/consumers/v2.0")).toBe(false);
      });
    });

    describe("validateMicrosoftIssuer", () => {
      it("accepts valid single-tenant URL", () => {
        expect(validateMicrosoftIssuer("https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0")).toBeNull();
      });

      it("accepts common multi-tenant URL", () => {
        expect(validateMicrosoftIssuer("https://login.microsoftonline.com/common/v2.0")).toBeNull();
      });

      it("accepts organizations multi-tenant URL", () => {
        expect(validateMicrosoftIssuer("https://login.microsoftonline.com/organizations/v2.0")).toBeNull();
      });

      it("accepts URL with trailing slash", () => {
        expect(validateMicrosoftIssuer("https://login.microsoftonline.com/common/v2.0/")).toBeNull();
      });

      it("rejects empty URL", () => {
        expect(validateMicrosoftIssuer("")).toBe("Issuer URL is required");
      });

      it("rejects non-Microsoft URL", () => {
        expect(validateMicrosoftIssuer("https://accounts.google.com")).toBe("Microsoft issuer URL must be on login.microsoftonline.com");
      });

      it("rejects URL without v2.0", () => {
        expect(validateMicrosoftIssuer("https://login.microsoftonline.com/common")).toContain("Expected format");
      });

      it("rejects URL with v1.0 endpoint", () => {
        expect(validateMicrosoftIssuer("https://login.microsoftonline.com/common/v1.0")).toContain("Expected format");
      });

      it("rejects URL without tenant segment", () => {
        expect(validateMicrosoftIssuer("https://login.microsoftonline.com/v2.0")).toContain("Expected format");
      });
    });

    describe("detectProvider with Microsoft URLs", () => {
      it("detects single-tenant URL", () => {
        expect(detectProvider("https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0")).toBe("microsoft");
      });

      it("detects common (multi-tenant) URL", () => {
        expect(detectProvider("https://login.microsoftonline.com/common/v2.0")).toBe("microsoft");
      });

      it("detects organizations (multi-tenant) URL", () => {
        expect(detectProvider("https://login.microsoftonline.com/organizations/v2.0")).toBe("microsoft");
      });

      it("detects consumers URL", () => {
        expect(detectProvider("https://login.microsoftonline.com/consumers/v2.0")).toBe("microsoft");
      });

      it("detects login.microsoft.com variant", () => {
        expect(detectProvider("https://login.microsoft.com/common/v2.0")).toBe("microsoft");
      });
    });

    describe("scopes for Microsoft OIDC flow", () => {
      it("builds correct scope string with User.Read", () => {
        const providerDef = OIDC_PROVIDERS.microsoft;
        const scopes = ["openid", "email", "profile", ...providerDef.extraScopes].join(" ");
        expect(scopes).toBe("openid email profile User.Read");
      });

      it("User.Read scope enables Graph API profile photo access", () => {
        // User.Read is required to call GET /me/photo/$value on Microsoft Graph
        expect(OIDC_PROVIDERS.microsoft.extraScopes).toContain("User.Read");
        // No other unexpected scopes
        expect(OIDC_PROVIDERS.microsoft.extraScopes).toHaveLength(1);
      });
    });
  });
});
