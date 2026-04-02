import { defineConfig, devices } from "@playwright/test";

/**
 * Live E2E config — tests against a running Edgebric instance with real inference.
 *
 * Prerequisites:
 *   1. Desktop app running (or `pnpm --filter api exec tsx src/server.ts`)
 *   2. llama-server running with a model loaded (e.g. qwen3:4b)
 *   3. At least one data source exists (tests create their own)
 *
 * Usage:
 *   pnpm exec playwright test --config=playwright.live.config.ts
 *   pnpm exec playwright test --config=playwright.live.config.ts -g "RAG pipeline"
 */
export default defineConfig({
  testDir: "./e2e-live",
  globalSetup: "./e2e-live/global-setup.ts",
  fullyParallel: false, // sequential — tests build on each other
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 180_000, // 3 minutes — real inference is slow

  use: {
    baseURL: process.env["EDGEBRIC_URL"] ?? "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // No global Content-Type — multipart uploads need their own content type.
    // JSON requests set Content-Type per-call via helpers.
  },

  projects: [
    {
      name: "live",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // No webServer — we test against the already-running instance
});
