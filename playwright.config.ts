import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config for Edgebric.
 *
 * Runs the API server in solo mode (AUTH_MODE=none) serving the built web app.
 * The web app must be built first: `pnpm --filter web build`
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 1, // single worker — shared server
  reporter: "list",
  timeout: 30_000,

  use: {
    baseURL: "http://localhost:3099",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "pnpm --filter api exec tsx src/server.ts",
    port: 3099,
    reuseExistingServer: !process.env["CI"],
    timeout: 15_000,
    env: {
      NODE_ENV: "test",
      AUTH_MODE: "none",
      PORT: "3099",
      DATA_DIR: "/tmp/edgebric-e2e",
      SESSION_SECRET: "e2e-test-secret",
      SERVE_STATIC: "1",
      FRONTEND_URL: "http://localhost:3099",
      OLLAMA_BASE_URL: "http://localhost:99999", // intentionally unreachable
      MIMIK_BASE_URL: "http://localhost:99999",
      MIMIK_API_KEY: "e2e-test-key",
      SKIP_CSRF: "1",
      SKIP_RATE_LIMIT: "1",
    },
  },
});
