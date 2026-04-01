import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

/**
 * Data Sources & Documents — full lifecycle E2E tests.
 *
 * Covers: create source, upload document, processing status, document content,
 * update source settings, health check, avatar upload, delete document, delete source.
 *
 * Runs in solo mode (AUTH_MODE=none) — auto-admin, no OIDC needed.
 */

test.describe("Data Source CRUD", () => {
  let sourceId: string;

  test("creates a new data source", async ({ request }) => {
    const res = await request.post("/api/data-sources", {
      data: {
        name: "E2E Test Source",
        description: "Created by Playwright E2E test",
        type: "organization",
      },
    });
    expect(res.ok()).toBe(true);
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("E2E Test Source");
    expect(body.description).toBe("Created by Playwright E2E test");
    expect(body.type).toBe("organization");
    expect(body.id).toBeTruthy();
    sourceId = body.id;
  });

  test("lists data sources and finds the new one", async ({ request }) => {
    const res = await request.get("/api/data-sources");
    expect(res.ok()).toBe(true);
    const sources = await res.json();
    expect(Array.isArray(sources)).toBe(true);
    const found = sources.find((s: { id: string }) => s.id === sourceId);
    expect(found).toBeDefined();
    expect(found.name).toBe("E2E Test Source");
  });

  test("gets source details by ID", async ({ request }) => {
    const res = await request.get(`/api/data-sources/${sourceId}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.name).toBe("E2E Test Source");
    expect(body.documents).toBeDefined();
    expect(Array.isArray(body.documents)).toBe(true);
  });

  test("updates source name and description", async ({ request }) => {
    const res = await request.put(`/api/data-sources/${sourceId}`, {
      data: {
        name: "E2E Renamed Source",
        description: "Updated description",
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.name).toBe("E2E Renamed Source");
    expect(body.description).toBe("Updated description");
  });

  test("updates source security settings", async ({ request }) => {
    const res = await request.put(`/api/data-sources/${sourceId}`, {
      data: {
        allowSourceViewing: true,
        allowVaultSync: true,
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.allowSourceViewing).toBe(true);
    expect(body.allowVaultSync).toBe(true);
  });

  test("toggles access mode to restricted", async ({ request }) => {
    const res = await request.put(`/api/data-sources/${sourceId}`, {
      data: {
        accessMode: "restricted",
        accessList: ["alice@test.com", "bob@test.com"],
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.accessMode).toBe("restricted");
    expect(body.accessList).toContain("alice@test.com");
    expect(body.accessList).toContain("bob@test.com");
  });

  test("gets source health report", async ({ request }) => {
    const res = await request.get(`/api/data-sources/${sourceId}/health`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.chunkCount).toBe("number");
    expect(typeof body.documentCount).toBe("number");
    expect(typeof body.stalenessThresholdDays).toBe("number");
  });

  test("returns 404 for non-existent source", async ({ request }) => {
    const res = await request.get("/api/data-sources/00000000-0000-0000-0000-000000000000");
    expect(res.status()).toBe(404);
  });

  test("deletes (archives) the source", async ({ request }) => {
    const res = await request.delete(`/api/data-sources/${sourceId}`);
    expect(res.ok()).toBe(true);

    // Source is soft-deleted (archived), no longer in the list
    const listRes = await request.get("/api/data-sources");
    const sources = await listRes.json();
    const found = sources.find((s: { id: string }) => s.id === sourceId);
    expect(found).toBeUndefined();
  });
});

test.describe("Document Upload & Lifecycle", () => {
  let sourceId: string;
  let docId: string;

  test.beforeAll(async ({ request }) => {
    // Create a source for document uploads
    const res = await request.post("/api/data-sources", {
      data: { name: "E2E Doc Source" },
    });
    const body = await res.json();
    sourceId = body.id;
  });

  test("uploads a text document", async ({ request }) => {
    // Create a temp file
    const tmpDir = "/tmp/edgebric-e2e";
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, "test-policy.md");
    fs.writeFileSync(filePath, "# Employee Handbook\n\nThis is the company policy on PTO.\n\nEmployees receive 15 days of paid time off per year.\n\n## Sick Leave\n\nEmployees receive 10 days of sick leave per year.\n");

    const res = await request.post(`/api/data-sources/${sourceId}/documents/upload`, {
      multipart: {
        file: {
          name: "test-policy.md",
          mimeType: "text/markdown",
          buffer: fs.readFileSync(filePath),
        },
      },
    });
    expect(res.status()).toBe(202);
    const body = await res.json();
    expect(body.documentId).toBeTruthy();
    expect(body.dataSourceId).toBe(sourceId);
    docId = body.documentId;
  });

  test("document appears in source document list", async ({ request }) => {
    const res = await request.get(`/api/data-sources/${sourceId}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    const doc = body.documents.find((d: { id: string }) => d.id === docId);
    expect(doc).toBeDefined();
    expect(doc.name).toBe("test-policy.md");
  });

  test("lists all documents via admin endpoint", async ({ request }) => {
    const res = await request.get("/api/documents");
    expect(res.ok()).toBe(true);
    const docs = await res.json();
    const doc = docs.find((d: { id: string }) => d.id === docId);
    expect(doc).toBeDefined();
    expect(doc.name).toBe("test-policy.md");
    expect(typeof doc.isStale).toBe("boolean");
  });

  test("gets document by ID", async ({ request }) => {
    const res = await request.get(`/api/documents/${docId}`);
    expect(res.ok()).toBe(true);
    const doc = await res.json();
    expect(doc.id).toBe(docId);
    expect(doc.name).toBe("test-policy.md");
    expect(doc.type).toBe("md");
  });

  test("returns 404 for non-existent document", async ({ request }) => {
    const res = await request.get("/api/documents/00000000-0000-0000-0000-000000000000");
    expect(res.status()).toBe(404);
  });

  test("rejects upload of unsupported file type", async ({ request }) => {
    const res = await request.post(`/api/data-sources/${sourceId}/documents/upload`, {
      multipart: {
        file: {
          name: "malicious.exe",
          mimeType: "application/octet-stream",
          buffer: Buffer.from("not a real file"),
        },
      },
    });
    expect(res.ok()).toBe(false);
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("deletes a document", async ({ request }) => {
    const res = await request.delete(`/api/documents/${docId}`);
    expect(res.status()).toBe(204);

    // Verify it's gone
    const check = await request.get(`/api/documents/${docId}`);
    expect(check.status()).toBe(404);
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/data-sources/${sourceId}`);
  });
});

test.describe("Data Source Avatar", () => {
  let sourceId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/data-sources", {
      data: { name: "E2E Avatar Source" },
    });
    const body = await res.json();
    sourceId = body.id;
  });

  test("uploads an avatar image", async ({ request }) => {
    // Create a minimal 1x1 PNG
    const pngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );

    const res = await request.post(`/api/data-sources/${sourceId}/avatar`, {
      multipart: {
        avatar: {
          name: "avatar.png",
          mimeType: "image/png",
          buffer: pngBuffer,
        },
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.avatarUrl).toBeTruthy();
  });

  test("deletes the avatar", async ({ request }) => {
    const res = await request.delete(`/api/data-sources/${sourceId}/avatar`);
    expect(res.ok()).toBe(true);
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/data-sources/${sourceId}`);
  });
});
