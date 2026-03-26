import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

/**
 * Document Content & PII — E2E tests for endpoints not covered by data-sources.test.ts.
 *
 * Covers: document content retrieval, raw file download, PII approve/reject.
 *
 * Runs in solo mode (AUTH_MODE=none) — auto-admin, no OIDC needed.
 */

test.describe("Document Content & PII", () => {
  let sourceId: string;
  let docId: string;

  test.beforeAll(async ({ request }) => {
    // Create a data source
    const srcRes = await request.post("/api/data-sources", {
      data: { name: "E2E Document Content Source" },
    });
    const srcBody = await srcRes.json();
    sourceId = srcBody.id;

    // Create a temp markdown file
    const tmpDir = "/tmp/edgebric-e2e";
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, "doc-test.md");
    fs.writeFileSync(filePath, "# Test Doc\n\nSome content for testing.\n");

    // Upload the document
    const uploadRes = await request.post(`/api/data-sources/${sourceId}/documents/upload`, {
      multipart: {
        file: {
          name: "doc-test.md",
          mimeType: "text/markdown",
          buffer: fs.readFileSync(filePath),
        },
      },
    });
    const uploadBody = await uploadRes.json();
    docId = uploadBody.documentId;
  });

  test("gets document content and sections", async ({ request }) => {
    const res = await request.get(`/api/documents/${docId}/content`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.document).toBeDefined();
    expect(body.document.id).toBe(docId);
    expect(body.document.name).toBe("doc-test.md");
    expect(body.sections).toBeDefined();
    expect(Array.isArray(body.sections)).toBe(true);
  });

  test("downloads raw file", async ({ request }) => {
    const res = await request.get(`/api/documents/${docId}/file`);
    expect(res.ok()).toBe(true);
    const buffer = await res.body();
    expect(buffer.length).toBeGreaterThan(0);
    const text = buffer.toString("utf-8");
    expect(text).toContain("# Test Doc");
  });

  test("approve-pii endpoint exists", async ({ request }) => {
    const res = await request.post(`/api/documents/${docId}/approve-pii`);
    // 200 if PII was pending, 400 if no PII to approve — either is acceptable
    expect([200, 400]).toContain(res.status());
  });

  test("reject-pii endpoint exists", async ({ request }) => {
    const res = await request.post(`/api/documents/${docId}/reject-pii`);
    // 200 if PII was pending, 400 if no PII to reject — either is acceptable
    expect([200, 400]).toContain(res.status());
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/documents/${docId}`);
    await request.delete(`/api/data-sources/${sourceId}`);
  });
});
