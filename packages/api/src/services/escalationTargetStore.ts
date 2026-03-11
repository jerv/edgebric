import type { EscalationTarget } from "@edgebric/types";
import { getDb } from "../db/index.js";
import { escalationTargets } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

function rowToTarget(row: typeof escalationTargets.$inferSelect): EscalationTarget {
  const target: EscalationTarget = {
    id: row.id,
    name: row.name,
    createdAt: new Date(row.createdAt),
  };
  if (row.role != null) target.role = row.role;
  if (row.slackUserId != null) target.slackUserId = row.slackUserId;
  if (row.email != null) target.email = row.email;
  return target;
}

export function createTarget(data: {
  name: string;
  role?: string;
  slackUserId?: string;
  email?: string;
}): EscalationTarget {
  const db = getDb();
  const target: EscalationTarget = {
    id: randomUUID(),
    name: data.name,
    createdAt: new Date(),
  };
  if (data.role) target.role = data.role;
  if (data.slackUserId) target.slackUserId = data.slackUserId;
  if (data.email) target.email = data.email;
  db.insert(escalationTargets)
    .values({
      id: target.id,
      name: target.name,
      role: target.role ?? null,
      slackUserId: target.slackUserId ?? null,
      email: target.email ?? null,
      createdAt: target.createdAt.toISOString(),
    })
    .run();
  return target;
}

export function getTarget(id: string): EscalationTarget | undefined {
  const db = getDb();
  const row = db.select().from(escalationTargets).where(eq(escalationTargets.id, id)).get();
  return row ? rowToTarget(row) : undefined;
}

export function listTargets(): EscalationTarget[] {
  const db = getDb();
  const rows = db
    .select()
    .from(escalationTargets)
    .orderBy(desc(escalationTargets.createdAt))
    .all();
  return rows.map(rowToTarget);
}

export function updateTarget(
  id: string,
  data: { name?: string; role?: string; slackUserId?: string; email?: string },
): EscalationTarget | undefined {
  const db = getDb();
  const existing = db.select().from(escalationTargets).where(eq(escalationTargets.id, id)).get();
  if (!existing) return undefined;

  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.role !== undefined) updates.role = data.role || null;
  if (data.slackUserId !== undefined) updates.slackUserId = data.slackUserId || null;
  if (data.email !== undefined) updates.email = data.email || null;

  if (Object.keys(updates).length > 0) {
    db.update(escalationTargets).set(updates).where(eq(escalationTargets.id, id)).run();
  }

  return getTarget(id);
}

export function deleteTarget(id: string): void {
  const db = getDb();
  db.delete(escalationTargets).where(eq(escalationTargets.id, id)).run();
}
