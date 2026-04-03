import type { OidcProviderId } from "@edgebric/types";
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

  // Inference endpoints — llama-server instances for chat and embeddings.
  // Chat server (port 8080) and embedding server (port 8081) run separately.
  inference: {
    chatBaseUrl: process.env["INFERENCE_CHAT_URL"] ?? "http://localhost:8080",
    embeddingBaseUrl: process.env["INFERENCE_EMBEDDING_URL"] ?? "http://localhost:8081",
    embeddingModel: process.env["EMBEDDING_MODEL"] ?? "nomic-embed-text",
    /** Embedding vector dimensions. Must match the model. nomic-embed-text = 768. */
    embeddingDim: parseInt(process.env["EMBEDDING_DIM"] ?? "768", 10),
    /** Path to models directory (for listing/managing GGUF files). */
    modelsDir: process.env["MODELS_DIR"] ?? "",
  },

  // Cloud storage integrations (OAuth clients — separate from OIDC login)
  cloud: {
    google: {
      clientId: process.env["GOOGLE_DRIVE_CLIENT_ID"] ?? "362624227663-kqbtiuen6jgmtsv2ua41v64kl058nk98.apps.googleusercontent.com",
      clientSecret: process.env["GOOGLE_DRIVE_CLIENT_SECRET"] ?? "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",
    },
    onedrive: {
      clientId: process.env["ONEDRIVE_CLIENT_ID"] ?? "",
      clientSecret: process.env["ONEDRIVE_CLIENT_SECRET"] ?? "",
    },
    confluence: {
      clientId: process.env["CONFLUENCE_CLIENT_ID"] ?? "",
      clientSecret: process.env["CONFLUENCE_CLIENT_SECRET"] ?? "",
    },
  },

  // Chat inference endpoint — points to llama-server's OpenAI-compatible API.
  // Can be overridden to use any OpenAI-compatible endpoint.
  chat: {
    baseUrl: process.env["CHAT_BASE_URL"] ?? `${process.env["INFERENCE_CHAT_URL"] ?? "http://localhost:8080"}/v1`,
    apiKey: process.env["CHAT_API_KEY"] ?? "no-key",
    model: process.env["CHAT_MODEL"] ?? "qwen3-4b",
  },
};

// Mutable chat config — allows hot-swapping the active model without restart.
export const runtimeChatConfig = { ...config.chat };

export type Config = typeof config;
