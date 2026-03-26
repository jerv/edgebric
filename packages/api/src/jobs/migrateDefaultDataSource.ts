import { ensureDefaultDataSource, refreshDocumentCount } from "../services/dataSourceStore.js";
import { getAllDocuments, setDocument } from "../services/documentStore.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

/**
 * Idempotent migration: ensures a default data source exists and assigns
 * any documents that don't have a dataSourceId to it.
 *
 * Safe to run on every startup — only modifies orphaned documents.
 */
export function migrateOrphanedDocumentsToDefaultDataSource(): void {
  const adminEmail = config.adminEmails[0] ?? "admin@edgebric.local";
  const defaultDS = ensureDefaultDataSource(adminEmail);

  const docs = getAllDocuments();
  let migratedCount = 0;

  for (const doc of docs) {
    if (!doc.dataSourceId) {
      setDocument({ ...doc, dataSourceId: defaultDS.id });
      migratedCount++;
    }
  }

  if (migratedCount > 0) {
    refreshDocumentCount(defaultDS.id);
    logger.info({ count: migratedCount, dsName: defaultDS.name }, "Migrated documents to default data source");
  }
}
