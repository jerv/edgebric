import { ensureDefaultKB, refreshDocumentCount } from "../services/knowledgeBaseStore.js";
import { getAllDocuments, setDocument } from "../services/documentStore.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

/**
 * Idempotent migration: ensures a default KB exists and assigns
 * any documents that don't have a knowledgeBaseId to it.
 *
 * Safe to run on every startup — only modifies orphaned documents.
 */
export function migrateOrphanedDocumentsToDefaultKB(): void {
  const adminEmail = config.adminEmails[0] ?? "admin@edgebric.local";
  const defaultKB = ensureDefaultKB(adminEmail);

  const docs = getAllDocuments();
  let migratedCount = 0;

  for (const doc of docs) {
    if (!doc.knowledgeBaseId) {
      setDocument({ ...doc, knowledgeBaseId: defaultKB.id });
      migratedCount++;
    }
  }

  if (migratedCount > 0) {
    refreshDocumentCount(defaultKB.id);
    logger.info({ count: migratedCount, kbName: defaultKB.name }, "Migrated documents to default KB");
  }
}
