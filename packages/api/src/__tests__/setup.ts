/**
 * Global test setup — runs before all test files.
 * Sets required env vars so config.ts doesn't throw on import.
 */

// Set env vars BEFORE any app code imports
process.env["NODE_ENV"] = "test";
process.env["OIDC_CLIENT_ID"] = "test-client-id";
process.env["OIDC_CLIENT_SECRET"] = "test-client-secret";
process.env["DATA_DIR"] = "/tmp/edgebric-test-" + process.pid;
process.env["SESSION_SECRET"] = "test-session-secret";
process.env["ADMIN_EMAILS"] = "admin@test.com";
