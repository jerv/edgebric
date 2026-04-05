/**
 * Webhook Store — CRUD for agent API webhook registrations.
 * Webhooks fire when ingestion events occur (ingestion.complete, ingestion.failed).
 */
import { randomUUID } from "crypto";
import { getDb } from "../db/index.js";
import { webhooks } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export type WebhookEvent = "ingestion.complete" | "ingestion.failed";
const VALID_EVENTS: WebhookEvent[] = ["ingestion.complete", "ingestion.failed"];

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  orgId: string;
  apiKeyId: string;
  createdAt: string;
}

function rowToWebhook(row: typeof webhooks.$inferSelect): Webhook {
  return {
    id: row.id,
    url: row.url,
    events: JSON.parse(row.events) as WebhookEvent[],
    orgId: row.orgId,
    apiKeyId: row.apiKeyId,
    createdAt: row.createdAt,
  };
}

export function createWebhook(opts: {
  url: string;
  events: WebhookEvent[];
  orgId: string;
  apiKeyId: string;
}): Webhook {
  // Validate events
  for (const ev of opts.events) {
    if (!VALID_EVENTS.includes(ev)) {
      throw new Error(`Invalid event: ${ev}`);
    }
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const db = getDb();
  db.insert(webhooks).values({
    id,
    url: opts.url,
    events: JSON.stringify(opts.events),
    orgId: opts.orgId,
    apiKeyId: opts.apiKeyId,
    createdAt: now,
  }).run();

  return { id, url: opts.url, events: opts.events, orgId: opts.orgId, apiKeyId: opts.apiKeyId, createdAt: now };
}

export function getWebhook(id: string): Webhook | undefined {
  const db = getDb();
  const row = db.select().from(webhooks).where(eq(webhooks.id, id)).get();
  return row ? rowToWebhook(row) : undefined;
}

export function listWebhooksByOrg(orgId: string): Webhook[] {
  const db = getDb();
  const rows = db.select().from(webhooks).where(eq(webhooks.orgId, orgId)).all();
  return rows.map(rowToWebhook);
}

export function deleteWebhook(id: string): boolean {
  const db = getDb();
  const result = db.delete(webhooks).where(eq(webhooks.id, id)).run();
  return result.changes > 0;
}

/**
 * Get all webhooks for an org that are subscribed to a given event.
 */
export function getWebhooksForEvent(orgId: string, event: WebhookEvent): Webhook[] {
  const all = listWebhooksByOrg(orgId);
  return all.filter((w) => w.events.includes(event));
}

/**
 * Fire webhooks for an event. Non-blocking — errors are logged but never thrown.
 */
export async function fireWebhooks(
  orgId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const hooks = getWebhooksForEvent(orgId, event);
  if (hooks.length === 0) return;

  const body = JSON.stringify({ event, ...payload, timestamp: new Date().toISOString() });

  await Promise.allSettled(
    hooks.map(async (hook) => {
      try {
        const resp = await fetch(hook.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) {
          logger.warn({ webhookId: hook.id, url: hook.url, status: resp.status }, "Webhook delivery failed");
        }
      } catch (err) {
        logger.warn({ err, webhookId: hook.id, url: hook.url }, "Webhook delivery error");
      }
    }),
  );
}
