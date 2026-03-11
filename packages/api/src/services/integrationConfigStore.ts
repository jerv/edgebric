import type { IntegrationConfig } from "@edgebric/types";
import { getDb } from "../db/index.js";
import { integrationConfig } from "../db/schema.js";
import { eq } from "drizzle-orm";

const KEY = "main";

export function getIntegrationConfig(): IntegrationConfig {
  const db = getDb();
  const row = db
    .select()
    .from(integrationConfig)
    .where(eq(integrationConfig.key, KEY))
    .get();
  if (!row) return {};
  return JSON.parse(row.config) as IntegrationConfig;
}

export function setIntegrationConfig(cfg: IntegrationConfig): void {
  const db = getDb();
  db.insert(integrationConfig)
    .values({ key: KEY, config: JSON.stringify(cfg) })
    .onConflictDoUpdate({
      target: integrationConfig.key,
      set: { config: JSON.stringify(cfg) },
    })
    .run();
}
