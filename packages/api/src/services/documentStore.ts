import type { Document, PIIWarning } from "@edgebric/types";
import { getDb } from "../db/index.js";
import { documents, dataSources } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";

/** Convert a DB row to the application Document type. */
function rowToDoc(row: typeof documents.$inferSelect): Document {
  const doc: Document = {
    id: row.id,
    name: row.name,
    type: row.type as Document["type"],
    classification: row.classification as Document["classification"],
    uploadedAt: new Date(row.uploadedAt),
    updatedAt: new Date(row.updatedAt),
    status: row.status as Document["status"],
    sectionHeadings: JSON.parse(row.sectionHeadings) as string[],
    storageKey: row.storageKey,
  };
  if (row.pageCount != null) doc.pageCount = row.pageCount;
  if (row.datasetName != null) doc.datasetName = row.datasetName;
  if (row.piiWarnings != null) doc.piiWarnings = JSON.parse(row.piiWarnings) as PIIWarning[];
  if (row.dataSourceId != null) doc.dataSourceId = row.dataSourceId;
  return doc;
}

/** Get all documents, newest first. */
export function getAllDocuments(): Document[] {
  const db = getDb();
  const rows = db.select().from(documents).all();
  return rows
    .map(rowToDoc)
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
}

/** Get a single document by ID. */
export function getDocument(id: string): Document | undefined {
  const db = getDb();
  const row = db.select().from(documents).where(eq(documents.id, id)).get();
  return row ? rowToDoc(row) : undefined;
}

/** Insert or update a document. */
export function setDocument(doc: Document): void {
  const db = getDb();
  db.insert(documents)
    .values({
      id: doc.id,
      name: doc.name,
      type: doc.type,
      classification: doc.classification,
      uploadedAt: doc.uploadedAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      status: doc.status,
      pageCount: doc.pageCount ?? null,
      sectionHeadings: JSON.stringify(doc.sectionHeadings),
      storageKey: doc.storageKey,
      datasetName: doc.datasetName ?? null,
      piiWarnings: doc.piiWarnings ? JSON.stringify(doc.piiWarnings) : null,
      dataSourceId: doc.dataSourceId ?? null,
    })
    .onConflictDoUpdate({
      target: documents.id,
      set: {
        name: doc.name,
        type: doc.type,
        classification: doc.classification,
        uploadedAt: doc.uploadedAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
        status: doc.status,
        pageCount: doc.pageCount ?? null,
        sectionHeadings: JSON.stringify(doc.sectionHeadings),
        storageKey: doc.storageKey,
        datasetName: doc.datasetName ?? null,
        piiWarnings: doc.piiWarnings ? JSON.stringify(doc.piiWarnings) : null,
        dataSourceId: doc.dataSourceId ?? null,
      },
    })
    .run();
}

/** Get all documents for data sources belonging to a specific org. */
export function getDocumentsByOrg(orgId: string): Document[] {
  const db = getDb();
  const orgDsIds = db
    .select({ id: dataSources.id })
    .from(dataSources)
    .where(eq(dataSources.orgId, orgId))
    .all()
    .map((r) => r.id);
  if (orgDsIds.length === 0) return [];
  const rows = db
    .select()
    .from(documents)
    .where(sql`${documents.dataSourceId} IN (${sql.join(orgDsIds.map((id) => sql`${id}`), sql`, `)})`)
    .all();
  return rows
    .map(rowToDoc)
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
}

/** Check if a document belongs to an org (via its data source). */
export function documentBelongsToOrg(docId: string, orgId: string): boolean {
  const doc = getDocument(docId);
  if (!doc?.dataSourceId) return false;
  const db = getDb();
  const ds = db
    .select({ orgId: dataSources.orgId })
    .from(dataSources)
    .where(eq(dataSources.id, doc.dataSourceId))
    .get();
  return ds?.orgId === orgId;
}

/** Get all documents for a specific data source. */
export function getDocumentsByDataSource(dataSourceId: string): Document[] {
  const db = getDb();
  const rows = db.select().from(documents).where(eq(documents.dataSourceId, dataSourceId)).all();
  return rows
    .map(rowToDoc)
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
}

/** Delete a document by ID. */
export function deleteDocument(id: string): void {
  const db = getDb();
  db.delete(documents).where(eq(documents.id, id)).run();
}
