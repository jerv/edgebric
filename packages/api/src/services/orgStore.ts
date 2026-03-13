import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { organizations, users } from "../db/schema.js";
import type { Organization, OrgSettings } from "@edgebric/types";

function rowToOrg(row: typeof organizations.$inferSelect): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan as Organization["plan"],
    settings: JSON.parse(row.settings) as OrgSettings,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export function createOrg(name: string): Organization {
  const db = getDb();
  const now = new Date().toISOString();
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const row = {
    id: randomUUID(),
    name,
    slug,
    plan: "free",
    settings: "{}",
    createdAt: now,
    updatedAt: now,
  };
  db.insert(organizations).values(row).run();
  return rowToOrg(row);
}

export function getOrg(id: string): Organization | undefined {
  const db = getDb();
  const row = db.select().from(organizations).where(eq(organizations.id, id)).get();
  return row ? rowToOrg(row) : undefined;
}

export function getDefaultOrg(): Organization | undefined {
  const db = getDb();
  const row = db.select().from(organizations).limit(1).get();
  return row ? rowToOrg(row) : undefined;
}

export function getOrgBySlug(slug: string): Organization | undefined {
  const db = getDb();
  const row = db.select().from(organizations).where(eq(organizations.slug, slug)).get();
  return row ? rowToOrg(row) : undefined;
}

/** Get all orgs a user email belongs to. */
export function getOrgsForUser(email: string): Organization[] {
  const db = getDb();
  const userRows = db.select({ orgId: users.orgId }).from(users)
    .where(eq(users.email, email.toLowerCase()))
    .all();
  const orgIds = [...new Set(userRows.map((r) => r.orgId))];
  if (orgIds.length === 0) return [];
  const rows = db.select().from(organizations).where(inArray(organizations.id, orgIds)).all();
  return rows.map(rowToOrg);
}

export function updateOrg(id: string, updates: { name?: string; settings?: OrgSettings }): Organization | undefined {
  const db = getDb();
  const existing = db.select().from(organizations).where(eq(organizations.id, id)).get();
  if (!existing) return undefined;

  const values: Record<string, string> = { updatedAt: new Date().toISOString() };
  if (updates.name !== undefined) values.name = updates.name;
  if (updates.settings !== undefined) values.settings = JSON.stringify(updates.settings);

  db.update(organizations).set(values).where(eq(organizations.id, id)).run();
  const updated = db.select().from(organizations).where(eq(organizations.id, id)).get();
  return updated ? rowToOrg(updated) : undefined;
}

/**
 * Ensures a default organization exists. Idempotent.
 * Called at server startup before other services.
 */
export function ensureDefaultOrg(orgName = "Edgebric"): Organization {
  const existing = getDefaultOrg();
  if (existing) return existing;
  return createOrg(orgName);
}
