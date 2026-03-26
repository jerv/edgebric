/**
 * Test helpers — creates a test app with an isolated in-memory database,
 * mock sessions, and no CSRF/rate-limiting.
 */
import express from "express";
import type { Express } from "express";
import supertest from "supertest";
import { initDatabase, closeDatabase, getDb } from "../db/index.js";
import { organizations } from "../db/schema.js";
import { createApp } from "../app.js";
import { ensureDefaultOrg } from "../services/orgStore.js";
import { initEncryptionKey } from "../lib/crypto.js";

let app: Express;

/**
 * Initialize the test app and database.
 * Call in beforeAll() or beforeEach() depending on isolation needs.
 */
export function setupTestApp(): Express {
  // Initialize encryption + DB (uses DATA_DIR from setup.ts env)
  initEncryptionKey();
  initDatabase();
  ensureDefaultOrg();

  app = createApp({
    skipSession: true,
    skipCsrf: true,
    skipRateLimit: true,
    skipRequestLogging: true,
  });

  return app;
}

/**
 * Clean up the database. Call in afterAll().
 */
export function teardownTestApp(): void {
  closeDatabase();
}

interface SessionData {
  queryToken?: string;
  isAdmin?: boolean;
  email?: string;
  name?: string;
  orgId?: string;
  orgSlug?: string;
}

/**
 * Create a supertest agent with a mock session injected.
 */
export function createAgent(sessionData: SessionData = {}) {
  const testApp = createApp({
    skipSession: true,
    skipCsrf: true,
    skipRateLimit: true,
    skipRequestLogging: true,
  });

  // Create a wrapper app that injects session before delegating to the real app
  const wrapper = express();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrapper.use((req: any, _res: express.Response, next: express.NextFunction) => {
    req.session = {
      queryToken: "queryToken" in sessionData ? sessionData.queryToken : "test-token",
      isAdmin: sessionData.isAdmin ?? false,
      email: "email" in sessionData ? sessionData.email : "user@test.com",
      name: sessionData.name ?? "Test User",
      orgId: sessionData.orgId,
      orgSlug: sessionData.orgSlug,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      save: (cb: any) => cb?.(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      destroy: (cb: any) => cb?.(),
    };
    next();
  });
  wrapper.use(testApp);

  return supertest(wrapper);
}

/**
 * Get a supertest agent for an authenticated admin user with org selected.
 */
export function adminAgent(orgId: string) {
  return createAgent({
    email: "admin@test.com",
    isAdmin: true,
    orgId,
    orgSlug: "test-org",
  });
}

/**
 * Get a supertest agent for an authenticated member user with org selected.
 */
export function memberAgent(orgId: string, email = "member@test.com") {
  return createAgent({
    email,
    isAdmin: false,
    orgId,
    orgSlug: "test-org",
  });
}

/**
 * Get a supertest agent with no authentication.
 */
export function unauthAgent() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createAgent({ queryToken: undefined, email: undefined } as any);
}

/**
 * Get the default org ID from the database.
 */
export function getDefaultOrgId(): string {
  const db = getDb();
  const row = db.select().from(organizations).limit(1).get();
  return row?.id ?? "";
}
