import type { EdgeConfig } from "@edgebric/types";

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

export const config = {
  port: parseInt(process.env["PORT"] ?? "3001", 10),
  dataDir: process.env["DATA_DIR"] ?? "./data",
  sessionSecret,
  // In production, frontend is served by the same origin as the API.
  // In dev, Vite runs on a separate port.
  frontendUrl: process.env["FRONTEND_URL"] ?? "http://localhost:5173",

  oidc: {
    issuer: process.env["OIDC_ISSUER"] ?? "https://accounts.google.com",
    clientId: requireEnv("OIDC_CLIENT_ID"),
    clientSecret: requireEnv("OIDC_CLIENT_SECRET"),
    redirectUri:
      process.env["OIDC_REDIRECT_URI"] ?? "http://localhost:3001/api/auth/callback",
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

  // Chat inference endpoint — separate from mILM so llama-server can be used
  // for models that mILM's bundled llama.cpp doesn't support (e.g. qwen3.5 arch).
  // Defaults to mILM. Override with CHAT_BASE_URL + CHAT_API_KEY + CHAT_MODEL.
  chat: {
    baseUrl: process.env["CHAT_BASE_URL"] ?? process.env["MIMIK_BASE_URL"] ?? "http://localhost:8083",
    apiKey: process.env["CHAT_API_KEY"] ?? process.env["MIMIK_API_KEY"] ?? "1234",
    // CHAT_MODEL overrides MILM_MODEL for the chat endpoint specifically
    model: process.env["CHAT_MODEL"] ?? process.env["MILM_MODEL"] ?? "qwen2.5-1.5b-instruct",
  },
};

// Mutable edge config — used by mkb/embed clients (stays on mILM).
export const runtimeEdgeConfig: EdgeConfig = { ...config.edge };

// Mutable chat config — allows hot-swapping the active model without restart.
export const runtimeChatConfig = { ...config.chat };

export type Config = typeof config;
