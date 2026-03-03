import type { EdgeConfig } from "@edgebric/types";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export const config = {
  port: parseInt(process.env["PORT"] ?? "3001", 10),
  dataDir: process.env["DATA_DIR"] ?? "./data",
  adminPassword: process.env["ADMIN_PASSWORD"] ?? "changeme",
  companyName: process.env["COMPANY_NAME"] ?? "Your Company",

  edge: {
    baseUrl: process.env["MIMIK_BASE_URL"] ?? "http://localhost:8083",
    apiKey: process.env["MIMIK_API_KEY"] ?? "1234",
    milmModel: process.env["MILM_MODEL"] ?? "Qwen3-4B-Instruct-GGUF",
    embeddingModel: process.env["EMBEDDING_MODEL"] ?? "nomic-embed-text",
  } satisfies EdgeConfig,
} as const;

export type Config = typeof config;
