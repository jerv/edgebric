import type { EdgeConfig, OidcProviderId } from "@edgebric/types";
import { detectProvider } from "./lib/oidcProviders.js";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

const sessionSecret = process.env["SESSION_SECRET"] ?? "dev-secret-change-in-production";
if (process.env["NODE_ENV"] === "production" && sessionSecret === "dev-secret-change-in-production") {
  throw new Error(
    "SESSION_SECRET must be set in production. " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
  );
}

/** Auth mode: "oidc" = full SSO, "none" = solo mode (no login, auto-admin). */
const authMode = (process.env["AUTH_MODE"] ?? "oidc") as "oidc" | "none";

export const config = {
  port: parseInt(process.env["PORT"] ?? "3001", 10),
  /** Listen host: 127.0.0.1 for solo mode (local only), 0.0.0.0 for org mode (LAN-accessible). */
  listenHost: process.env["LISTEN_HOST"] ?? (authMode === "none" ? "127.0.0.1" : "0.0.0.0"),
  dataDir: process.env["DATA_DIR"] ?? "./data",
  sessionSecret,
  authMode,
  // In production, frontend is served by the same origin as the API.
  // In dev, Vite runs on a separate port.
  frontendUrl: process.env["FRONTEND_URL"] ?? "http://localhost:5173",

  oidc: authMode === "oidc" ? {
    provider: (process.env["OIDC_PROVIDER"] ?? detectProvider(process.env["OIDC_ISSUER"] ?? "")) as OidcProviderId,
    issuer: process.env["OIDC_ISSUER"] ?? "https://accounts.google.com",
    clientId: requireEnv("OIDC_CLIENT_ID"),
    clientSecret: requireEnv("OIDC_CLIENT_SECRET"),
    redirectUri:
      process.env["OIDC_REDIRECT_URI"] ?? "http://localhost:3001/api/auth/callback",
  } : {
    provider: "generic" as OidcProviderId,
    issuer: "",
    clientId: "",
    clientSecret: "",
    redirectUri: "",
  },

  // Comma-separated list of emails granted admin access after OIDC login
  adminEmails: (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  edge: {
    baseUrl: process.env["MIMIK_BASE_URL"] ?? "http://localhost:8083",
    apiKey: process.env["MIMIK_API_KEY"] ?? "1234",
    milmModel: process.env["MILM_MODEL"] ?? "qwen2.5-1.5b-instruct",
    embeddingModel: process.env["EMBEDDING_MODEL"] ?? "nomic-embed-text",
  } satisfies EdgeConfig,

  // Ollama inference endpoint — manages local LLM models.
  // Defaults to Ollama's standard port. Override with OLLAMA_BASE_URL.
  ollama: {
    baseUrl: process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434",
  },

  // Chat inference endpoint — points to Ollama's OpenAI-compatible API by default.
  // Can be overridden to use mILM, llama-server, or any OpenAI-compatible endpoint.
  chat: {
    baseUrl: process.env["CHAT_BASE_URL"] ?? `${process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434"}/v1`,
    apiKey: process.env["CHAT_API_KEY"] ?? "ollama",
    model: process.env["CHAT_MODEL"] ?? "qwen3:4b",
  },
};

// Mutable edge config — used by mkb/embed clients (stays on mILM).
export const runtimeEdgeConfig: EdgeConfig = { ...config.edge };

// Mutable chat config — allows hot-swapping the active model without restart.
export const runtimeChatConfig = { ...config.chat };

export type Config = typeof config;
