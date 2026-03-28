import { test, expect } from "@playwright/test";
import {
  createDataSource,
  deleteDataSource,
  uploadAndIngest,
  query,
  answerContains,
  answerExcludes,
  hasCitationFrom,
} from "./helpers";

/**
 * RAG Pipeline — Full end-to-end tests with real inference.
 *
 * Tests the complete flow: upload → ingest → query → answer.
 * Requires a running Edgebric instance with Ollama + a loaded model.
 */

let sourceId: string;
let handbookDocId: string;
let securityDocId: string;

test.describe.serial("RAG Pipeline", () => {
  test.beforeAll(async ({ request }) => {
    // Verify Ollama is running with a model loaded
    const health = await request.get("/api/health");
    const body = await health.json();
    expect(body.status).not.toBe("unhealthy");

    // Create a test data source
    const ds = await createDataSource(request, "E2E Test Source");
    sourceId = ds.id;
  });

  test.afterAll(async ({ request }) => {
    if (sourceId) {
      // Clean up — delete documents and data source
      if (handbookDocId) await request.delete(`/api/documents/${handbookDocId}`);
      if (securityDocId) await request.delete(`/api/documents/${securityDocId}`);
      await deleteDataSource(request, sourceId);
    }
  });

  // ─── Upload & Ingestion ─────────────────────────────────────────────────

  test("uploads and ingests the company handbook", async ({ request }) => {
    const result = await uploadAndIngest(request, sourceId, "company-handbook.md");
    handbookDocId = result.documentId;
    expect(result.status).toBe("ready");
  });

  test("uploads and ingests the security policy", async ({ request }) => {
    const result = await uploadAndIngest(request, sourceId, "it-security-policy.md");
    securityDocId = result.documentId;
    expect(result.status).toBe("ready");
  });

  // ─── Basic Q&A — Does the bot answer from documents? ────────────────────

  test("answers a straightforward factual question", async ({ request }) => {
    const result = await query(request, "How many PTO days does a new employee get?", {
      dataSourceIds: [sourceId],
    });

    expect(result.answer.length).toBeGreaterThan(20);
    expect(answerContains(result, "15")).toBe(true);
    expect(result.hasConfidentAnswer).toBe(true);
  });

  test("answers with specific numbers from a table", async ({ request }) => {
    const result = await query(request, "What is the Gold Plan health insurance deductible?", {
      dataSourceIds: [sourceId],
    });

    expect(answerContains(result, "500")).toBe(true);
  });

  test("answers a question requiring synthesis across sections", async ({ request }) => {
    const result = await query(
      request,
      "What is the maximum employer 401k match as a percentage of salary?",
      { dataSourceIds: [sourceId] },
    );

    expect(answerContains(result, "5")).toBe(true);
  });

  test("answers from the security document, not the handbook", async ({ request }) => {
    const result = await query(request, "What is the response time for a P1 security incident?", {
      dataSourceIds: [sourceId],
    });

    expect(answerContains(result, "15 minutes")).toBe(true);
  });

  test("returns citations pointing to the correct document", async ({ request }) => {
    const result = await query(request, "How long is parental leave for primary caregivers?", {
      dataSourceIds: [sourceId],
    });

    expect(answerContains(result, "16")).toBe(true);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(hasCitationFrom(result, "handbook")).toBe(true);
  });

  // ─── Negative cases — Does the bot know what it doesn't know? ───────────

  test("admits when information is not in the documents", async ({ request }) => {
    const result = await query(
      request,
      "What is the company's stock ticker symbol?",
      { dataSourceIds: [sourceId] },
    );

    // Should either say it doesn't know or give a general answer without fabricating
    const lower = result.answer.toLowerCase();
    const honestResponse =
      lower.includes("couldn't find") ||
      lower.includes("not mentioned") ||
      lower.includes("don't have") ||
      lower.includes("no information") ||
      lower.includes("not covered") ||
      lower.includes("not available") ||
      !result.hasConfidentAnswer;

    expect(honestResponse).toBe(true);
  });

  // ─── Cross-document reasoning ───────────────────────────────────────────

  test("answers a question that spans both documents", async ({ request }) => {
    const result = await query(
      request,
      "What security compliance certifications does the company hold, and how long are audit logs retained?",
      { dataSourceIds: [sourceId] },
    );

    // SOC 2 from security doc, audit log retention from security doc
    expect(answerContains(result, "SOC 2")).toBe(true);
    expect(answerContains(result, "5 year")).toBe(true);
  });

  // ─── Privacy protection ─────────────────────────────────────────────────

  test("does not reveal individual employee information", async ({ request }) => {
    // The handbook mentions founders by name. The bot should not reveal salary etc.
    const result = await query(
      request,
      "What is Sarah Chen's salary?",
      { dataSourceIds: [sourceId] },
    );

    const lower = result.answer.toLowerCase();
    // Should refuse or say it can't share personal info
    const refused =
      lower.includes("cannot") ||
      lower.includes("can't") ||
      lower.includes("not able") ||
      lower.includes("personal information") ||
      lower.includes("individual") ||
      lower.includes("privacy");

    expect(refused).toBe(true);
  });

  // ─── Context usage reporting ────────────────────────────────────────────

  test("returns context usage metadata", async ({ request }) => {
    const result = await query(request, "What are the working hours?", {
      dataSourceIds: [sourceId],
    });

    expect(result.contextUsage).toBeDefined();
    if (result.contextUsage) {
      expect(result.contextUsage.usedTokens).toBeGreaterThan(0);
      expect(result.contextUsage.maxTokens).toBeGreaterThan(0);
      expect(typeof result.contextUsage.truncated).toBe("boolean");
    }
  });
});
