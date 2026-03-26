/**
 * OIDC Provider Definitions
 *
 * Each provider has a claims mapping (ordered list of claim names to try)
 * and CSP img-src domains for profile pictures.
 *
 * The core OIDC flow (openid-client + Issuer.discover()) is already
 * provider-agnostic — this module handles the cosmetic differences.
 */

export type OidcProviderId = "google" | "microsoft" | "okta" | "onelogin" | "ping" | "generic";

export interface OidcProviderDef {
  id: OidcProviderId;
  name: string;
  defaultIssuer?: string;
  /** CSP img-src domains for profile pictures served by this provider. */
  imgSrcDomains: string[];
  /** Additional OIDC scopes beyond "openid email profile". */
  extraScopes: string[];
  claimsMapping: {
    email: string[];
    name: string[];
    picture: string[];
  };
}

export const OIDC_PROVIDERS: Record<OidcProviderId, OidcProviderDef> = {
  google: {
    id: "google",
    name: "Google Workspace",
    defaultIssuer: "https://accounts.google.com",
    imgSrcDomains: ["https://lh3.googleusercontent.com"],
    extraScopes: [],
    claimsMapping: {
      email: ["email"],
      name: ["name"],
      picture: ["picture"],
    },
  },
  microsoft: {
    id: "microsoft",
    name: "Microsoft Entra ID",
    // Tenant-specific: https://login.microsoftonline.com/{tenantId}/v2.0
    imgSrcDomains: [],
    extraScopes: ["User.Read"], // needed for Graph API photo fetch
    claimsMapping: {
      email: ["email", "preferred_username", "upn"],
      name: ["name"],
      picture: [], // fetched via Graph API, not in ID token
    },
  },
  okta: {
    id: "okta",
    name: "Okta",
    imgSrcDomains: [],
    extraScopes: [],
    claimsMapping: {
      email: ["email"],
      name: ["name"],
      picture: ["picture"],
    },
  },
  onelogin: {
    id: "onelogin",
    name: "OneLogin",
    imgSrcDomains: [],
    extraScopes: [],
    claimsMapping: {
      email: ["email"],
      name: ["name"],
      picture: ["picture"],
    },
  },
  ping: {
    id: "ping",
    name: "Ping Identity",
    imgSrcDomains: [],
    extraScopes: [],
    claimsMapping: {
      email: ["email"],
      name: ["name"],
      picture: ["picture"],
    },
  },
  generic: {
    id: "generic",
    name: "OIDC Provider",
    imgSrcDomains: [],
    extraScopes: [],
    claimsMapping: {
      email: ["email", "preferred_username"],
      name: ["name", "given_name"],
      picture: ["picture"],
    },
  },
};

export interface ExtractedClaims {
  email: string;
  name?: string | undefined;
  picture?: string | undefined;
  sub: string;
}

/**
 * Extract and normalize claims from an OIDC ID token using the provider's
 * claims mapping. Tries each claim name in order and returns the first
 * non-empty value.
 */
export function extractClaims(
  rawClaims: Record<string, unknown>,
  providerDef: OidcProviderDef,
): ExtractedClaims {
  const email = findClaim(rawClaims, providerDef.claimsMapping.email);
  if (!email) {
    throw new Error(
      `No email found in ID token. Tried claims: ${providerDef.claimsMapping.email.join(", ")}. ` +
      `Ensure the 'email' scope is granted by your ${providerDef.name} configuration.`,
    );
  }

  const sub = rawClaims["sub"];
  if (typeof sub !== "string" || !sub) {
    throw new Error("No 'sub' claim in ID token — invalid OIDC response.");
  }

  return {
    email: email.toLowerCase(),
    name: findClaim(rawClaims, providerDef.claimsMapping.name) ?? undefined,
    picture: findClaim(rawClaims, providerDef.claimsMapping.picture) ?? undefined,
    sub,
  };
}

/** Try claim names in order, return first non-empty string value. */
function findClaim(claims: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const val = claims[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return null;
}

/**
 * Auto-detect provider ID from the OIDC issuer URL.
 * Used as fallback when OIDC_PROVIDER env var is not set.
 */
export function detectProvider(issuerUrl: string): OidcProviderId {
  const url = issuerUrl.toLowerCase();
  if (url.includes("google")) return "google";
  if (url.includes("microsoftonline") || url.includes("login.microsoft")) return "microsoft";
  if (url.includes("okta.com")) return "okta";
  if (url.includes("onelogin.com")) return "onelogin";
  if (url.includes("pingidentity") || url.includes("pingone")) return "ping";
  return "generic";
}
