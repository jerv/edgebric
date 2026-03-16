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
  // Default to true if the contact method exists and the column is null (pre-migration rows)
  target.slackNotify = row.slackNotify != null ? !!row.slackNotify : !!row.slackUserId;
  target.emailNotify = row.emailNotify != null ? !!row.emailNotify : !!row.email;
  return target;
}

export function createTarget(data: {
  name: string;
  role?: string;
  slackUserId?: string;
  email?: string;
  slackNotify?: boolean;
  emailNotify?: boolean;
  orgId?: string;
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
  // Default notify to true if contact method exists
  target.slackNotify = data.slackNotify ?? !!data.slackUserId;
  target.emailNotify = data.emailNotify ?? !!data.email;
  db.insert(escalationTargets)
    .values({
      id: target.id,
      name: target.name,
      role: target.role ?? null,
      slackUserId: target.slackUserId ?? null,
      email: target.email ?? null,
      slackNotify: target.slackNotify ? 1 : 0,
      emailNotify: target.emailNotify ? 1 : 0,
      orgId: data.orgId ?? null,
      createdAt: target.createdAt.toISOString(),
    })
    .run();
  return target;
}

export function getTarget(id: string): (EscalationTarget & { orgId?: string | undefined }) | undefined {
  const db = getDb();
  const row = db.select().from(escalationTargets).where(eq(escalationTargets.id, id)).get();
  if (!row) return undefined;
  const target = rowToTarget(row);
  return { ...target, orgId: row.orgId ?? undefined };
}

export function listTargets(orgId?: string): EscalationTarget[] {
  const db = getDb();
  const query = orgId
    ? db.select().from(escalationTargets).where(eq(escalationTargets.orgId, orgId))
    : db.select().from(escalationTargets);
  const rows = query.orderBy(desc(escalationTargets.createdAt)).all();
  return rows.map(rowToTarget);
}

export function updateTarget(
  id: string,
  data: { name?: string; role?: string; slackUserId?: string; email?: string; slackNotify?: boolean; emailNotify?: boolean },
): EscalationTarget | undefined {
  const db = getDb();
  const existing = db.select().from(escalationTargets).where(eq(escalationTargets.id, id)).get();
  if (!existing) return undefined;

  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.role !== undefined) updates.role = data.role || null;
  if (data.slackUserId !== undefined) updates.slackUserId = data.slackUserId || null;
  if (data.email !== undefined) updates.email = data.email || null;
  if (data.slackNotify !== undefined) updates.slackNotify = data.slackNotify ? 1 : 0;
  if (data.emailNotify !== undefined) updates.emailNotify = data.emailNotify ? 1 : 0;

  if (Object.keys(updates).length > 0) {
    db.update(escalationTargets).set(updates).where(eq(escalationTargets.id, id)).run();
  }

  return getTarget(id);
}

export function deleteTarget(id: string): void {
  const db = getDb();
  db.delete(escalationTargets).where(eq(escalationTargets.id, id)).run();
}
