/**
 * User mesh group assignments — maps users to node groups for access control.
 *
 * Users can only search remote mesh nodes that belong to groups they're assigned to.
 * Admins can search all groups regardless of assignment.
 */
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "../db/index.js";
import { userMeshGroups, nodeGroups } from "../db/schema.js";

export interface UserMeshGroup {
  id: string;
  userId: string;
  groupId: string;
  groupName: string;
  groupColor: string;
  orgId: string;
  assignedAt: string;
  assignedBy: string;
}

/** Get all group assignments for a user. */
export function getUserGroups(userId: string): UserMeshGroup[] {
  const db = getDb();
  const rows = db.select().from(userMeshGroups)
    .where(eq(userMeshGroups.userId, userId))
    .all();

  return rows.map((row) => {
    const group = db.select().from(nodeGroups)
      .where(eq(nodeGroups.id, row.groupId)).get();
    return {
      id: row.id,
      userId: row.userId,
      groupId: row.groupId,
      groupName: group?.name ?? "Unknown",
      groupColor: group?.color ?? "#3b82f6",
      orgId: row.orgId,
      assignedAt: row.assignedAt,
      assignedBy: row.assignedBy,
    };
  });
}

/** Get the group IDs a user is allowed to search. Returns empty array if no assignments. */
export function getUserGroupIds(userId: string): string[] {
  const db = getDb();
  const rows = db.select({ groupId: userMeshGroups.groupId })
    .from(userMeshGroups)
    .where(eq(userMeshGroups.userId, userId))
    .all();
  return rows.map((r) => r.groupId);
}

/** Assign a user to a mesh group. No-op if already assigned. */
export function assignUserToGroup(opts: {
  userId: string;
  groupId: string;
  orgId: string;
  assignedBy: string;
}): UserMeshGroup | null {
  const db = getDb();

  // Check if already assigned
  const existing = db.select().from(userMeshGroups)
    .where(and(
      eq(userMeshGroups.userId, opts.userId),
      eq(userMeshGroups.groupId, opts.groupId),
    ))
    .get();
  if (existing) return null; // Already assigned

  const id = randomUUID();
  const now = new Date().toISOString();

  db.insert(userMeshGroups).values({
    id,
    userId: opts.userId,
    groupId: opts.groupId,
    orgId: opts.orgId,
    assignedAt: now,
    assignedBy: opts.assignedBy,
  }).run();

  const assignments = getUserGroups(opts.userId);
  return assignments.find((a) => a.id === id) ?? null;
}

/** Remove a user from a mesh group. */
export function removeUserFromGroup(userId: string, groupId: string): boolean {
  const db = getDb();
  const result = db.delete(userMeshGroups)
    .where(and(
      eq(userMeshGroups.userId, userId),
      eq(userMeshGroups.groupId, groupId),
    ))
    .run();
  return result.changes > 0;
}

/** Remove all group assignments for a user (used when user is removed from org). */
export function removeAllUserGroups(userId: string): number {
  const db = getDb();
  const result = db.delete(userMeshGroups)
    .where(eq(userMeshGroups.userId, userId))
    .run();
  return result.changes;
}

/** Get all users assigned to a specific group. Returns user IDs. */
export function getGroupMembers(groupId: string): string[] {
  const db = getDb();
  const rows = db.select({ userId: userMeshGroups.userId })
    .from(userMeshGroups)
    .where(eq(userMeshGroups.groupId, groupId))
    .all();
  return rows.map((r) => r.userId);
}

/** Set a user's group assignments (replaces all existing). */
export function setUserGroups(opts: {
  userId: string;
  groupIds: string[];
  orgId: string;
  assignedBy: string;
}): void {
  const db = getDb();
  // Remove existing
  db.delete(userMeshGroups)
    .where(eq(userMeshGroups.userId, opts.userId))
    .run();

  // Add new
  const now = new Date().toISOString();
  for (const groupId of opts.groupIds) {
    db.insert(userMeshGroups).values({
      id: randomUUID(),
      userId: opts.userId,
      groupId,
      orgId: opts.orgId,
      assignedAt: now,
      assignedBy: opts.assignedBy,
    }).run();
  }
}
