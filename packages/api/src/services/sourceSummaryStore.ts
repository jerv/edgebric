/**
 * Source Summary Store — caches AI-generated summaries of data sources.
 * Summaries are regenerated when the source's updatedAt changes.
 */
import { getDb } from "../db/index.js";
import { sourceSummaries } from "../db/schema.js";
import { eq } from "drizzle-orm";

export interface SourceSummary {
  dataSourceId: string;
  summary: string;
  topTopics: string[];
  documentCount: number;
  generatedAt: string;
  sourceUpdatedAt: string;
}

function rowToSummary(row: typeof sourceSummaries.$inferSelect): SourceSummary {
  return {
    dataSourceId: row.dataSourceId,
    summary: row.summary,
    topTopics: JSON.parse(row.topTopics) as string[],
    documentCount: row.documentCount,
    generatedAt: row.generatedAt,
    sourceUpdatedAt: row.sourceUpdatedAt,
  };
}

export function getSourceSummary(dataSourceId: string): SourceSummary | undefined {
  const db = getDb();
  const row = db.select().from(sourceSummaries).where(eq(sourceSummaries.dataSourceId, dataSourceId)).get();
  return row ? rowToSummary(row) : undefined;
}

export function upsertSourceSummary(summary: SourceSummary): void {
  const db = getDb();
  const existing = db.select().from(sourceSummaries).where(eq(sourceSummaries.dataSourceId, summary.dataSourceId)).get();
  if (existing) {
    db.update(sourceSummaries)
      .set({
        summary: summary.summary,
        topTopics: JSON.stringify(summary.topTopics),
        documentCount: summary.documentCount,
        generatedAt: summary.generatedAt,
        sourceUpdatedAt: summary.sourceUpdatedAt,
      })
      .where(eq(sourceSummaries.dataSourceId, summary.dataSourceId))
      .run();
  } else {
    db.insert(sourceSummaries).values({
      dataSourceId: summary.dataSourceId,
      summary: summary.summary,
      topTopics: JSON.stringify(summary.topTopics),
      documentCount: summary.documentCount,
      generatedAt: summary.generatedAt,
      sourceUpdatedAt: summary.sourceUpdatedAt,
    }).run();
  }
}
