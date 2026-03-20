import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { users } from "../db/schema.js";
import type { User, UserRole, UserStatus } from "@edgebric/types";

function rowToUser(row: typeof users.$inferSelect): User {
  const user: User = {
    id: row.id,
    email: row.email,
    role: row.role as UserRole,
    status: (row.status ?? "active") as UserStatus,
    orgId: row.orgId,
    createdAt: new Date(row.createdAt),
  };
  if (row.name != null) user.name = row.name;
  if (row.picture != null) user.picture = row.picture;
  if (row.lastLoginAt != null) user.lastLoginAt = new Date(row.lastLoginAt);
  if (row.invitedBy != null) user.invitedBy = row.invitedBy;
  if (row.canCreateKBs) user.canCreateKBs = true;
  if (row.canCreateGroupChats) user.canCreateGroupChats = true;
  if (row.defaultGroupChatNotifLevel != null) user.defaultGroupChatNotifLevel = row.defaultGroupChatNotifLevel as "all" | "mentions" | "none";
  return user;
}

export function getUserByEmail(email: string): User | undefined {
  const db = getDb();
  const row = db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
  return row ? rowToUser(row) : undefined;
}

/** Get a user record for a specific (email, org) pair. */
export function getUserInOrg(email: string, orgId: string): User | undefined {
  const db = getDb();
  const row = db.select().from(users)
    .where(and(eq(users.email, email.toLowerCase()), eq(users.orgId, orgId)))
    .get();
  return row ? rowToUser(row) : undefined;
}

/** Get all user records for an email across all orgs. */
export function getUsersByEmail(email: string): User[] {
  const db = getDb();
  const rows = db.select().from(users).where(eq(users.email, email.toLowerCase())).all();
  return rows.map(rowToUser);
}

export function getUser(id: string): User | undefined {
  const db = getDb();
  const row = db.select().from(users).where(eq(users.id, id)).get();
  return row ? rowToUser(row) : undefined;
}

export function upsertUser(data: {
  email: string;
  name?: string;
  picture?: string;
  role: UserRole;
  orgId: string;
}): User {
  const db = getDb();
  const existing = db.select().from(users).where(eq(users.email, data.email)).get();

  if (existing) {
    const updates: Record<string, string> = {
      lastLoginAt: new Date().toISOString(),
    };
    if (data.name !== undefined) updates.name = data.name;
    if (data.picture !== undefined) updates.picture = data.picture;
    // Don't downgrade role: if existing is owner/admin, keep it unless explicitly changing
    if (data.role !== undefined) updates.role = data.role;
    // Activate invited users on login
    if (existing.status === "invited") updates.status = "active";

    db.update(users).set(updates).where(eq(users.email, data.email)).run();
    const updated = db.select().from(users).where(eq(users.email, data.email)).get();
    return rowToUser(updated!);
  }

  const row = {
    id: randomUUID(),
    email: data.email,
    name: data.name ?? null,
    picture: data.picture ?? null,
    role: data.role,
    status: "active",
    orgId: data.orgId,
    invitedBy: null,
    canCreateKBs: 0,
    canCreateGroupChats: 0,
    defaultGroupChatNotifLevel: "all",
    lastLoginAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  db.insert(users).values(row).run();
  return rowToUser(row);
}

/** Invite a user by email. Creates a placeholder record with status "invited". */
export function inviteUser(data: {
  email: string;
  role: UserRole;
  orgId: string;
  invitedBy: string;
}): User {
  const db = getDb();
  const existing = db.select().from(users).where(eq(users.email, data.email.toLowerCase())).get();

  if (existing) {
    // User already exists — just return them
    return rowToUser(existing);
  }

  const row = {
    id: randomUUID(),
    email: data.email.toLowerCase().trim(),
    name: null,
    picture: null,
    role: data.role,
    status: "invited",
    orgId: data.orgId,
    invitedBy: data.invitedBy,
    canCreateKBs: 0,
    canCreateGroupChats: 0,
    defaultGroupChatNotifLevel: "all",
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
  };
  db.insert(users).values(row).run();
  return rowToUser(row);
}

/** Update a user's role. */
export function updateUserRole(userId: string, role: UserRole): User | undefined {
  const db = getDb();
  const existing = db.select().from(users).where(eq(users.id, userId)).get();
  if (!existing) return undefined;

  db.update(users)
    .set({ role })
    .where(eq(users.id, userId))
    .run();
  return getUser(userId);
}

/** Remove a user from the organization. */
export function removeUser(userId: string): boolean {
  const db = getDb();
  const result = db.delete(users).where(eq(users.id, userId)).run();
  return result.changes > 0;
}

/** Update a user's display name. */
export function updateUserName(email: string, orgId: string, name: string): User | undefined {
  const db = getDb();
  const existing = db.select().from(users)
    .where(and(eq(users.email, email.toLowerCase()), eq(users.orgId, orgId)))
    .get();
  if (!existing) return undefined;

  db.update(users)
    .set({ name })
    .where(eq(users.id, existing.id))
    .run();
  return getUser(existing.id);
}

/** Update a user's permissions (e.g. canCreateKBs, canCreateGroupChats). */
export function updateUserPermissions(
  userId: string,
  permissions: { canCreateKBs?: boolean | undefined; canCreateGroupChats?: boolean | undefined },
): User | undefined {
  const db = getDb();
  const existing = db.select().from(users).where(eq(users.id, userId)).get();
  if (!existing) return undefined;

  const updates: Record<string, unknown> = {};
  if (permissions.canCreateKBs !== undefined) {
    updates.canCreateKBs = permissions.canCreateKBs ? 1 : 0;
  }
  if (permissions.canCreateGroupChats !== undefined) {
    updates.canCreateGroupChats = permissions.canCreateGroupChats ? 1 : 0;
  }

  if (Object.keys(updates).length > 0) {
    db.update(users).set(updates).where(eq(users.id, userId)).run();
  }
  return getUser(userId);
}

/** Update a user's default group chat notification level. */
export function updateUserNotifPrefs(
  email: string,
  orgId: string,
  defaultGroupChatNotifLevel: "all" | "mentions" | "none",
): User | undefined {
  const db = getDb();
  const existing = db.select().from(users)
    .where(and(eq(users.email, email.toLowerCase()), eq(users.orgId, orgId)))
    .get();
  if (!existing) return undefined;

  db.update(users)
    .set({ defaultGroupChatNotifLevel })
    .where(eq(users.id, existing.id))
    .run();
  return getUser(existing.id);
}

export function listUsers(orgId: string): User[] {
  const db = getDb();
  const rows = db.select().from(users).where(eq(users.orgId, orgId)).all();
  return rows.map(rowToUser);
}
