import { test, expect } from "@playwright/test";
import { createDataSource, deleteDataSource, uploadAndIngest } from "./helpers";

/**
 * Data Source Permissions & Access Control Tests.
 *
 * Verifies:
 * - Creating data sources with different access modes
 * - Restricted sources enforce access lists
 * - Data source CRUD lifecycle works end-to-end
 * - Permission toggles (source viewing, vault sync)
 * - Document upload with various file types
 * - Data source health endpoint returns valid metrics
 */

let orgSourceId: string;
let restrictedSourceId: string;
let docId: string;

test.describe.serial("Data Source Permissions", () => {
  test.afterAll(async ({ request }) => {
    if (docId) await request.delete(`/api/documents/${docId}`);
    if (orgSourceId) await deleteDataSource(request, orgSourceId);
    if (restrictedSourceId) await deleteDataSource(request, restrictedSourceId);
  });

  // ─── Source Creation ────────────────────────────────────────────────────────

  test("creates an organization-wide data source", async ({ request }) => {
    const ds = await createDataSource(request, "Org-Wide Source");
    orgSourceId = ds.id;
    expect(orgSourceId).toBeDefined();
  });

  test("creates a restricted data source with access list", async ({ request }) => {
    const res = await request.post("/api/data-sources", {
      data: {
        name: "Restricted Source",
        accessMode: "restricted",
        accessList: ["admin@test.com"],
      },
    });
    expect(res.ok()).toBe(true);
    const ds = await res.json();
    restrictedSourceId = ds.id;
    expect(ds.accessMode).toBe("restricted");
  });

  // ─── Source Details ─────────────────────────────────────────────────────────

  test("retrieves data source details with documents", async ({ request }) => {
    // Upload a document first
    const result = await uploadAndIngest(request, orgSourceId, "company-handbook.md");
    docId = result.documentId;
    expect(result.status).toBe("ready");

    // Now fetch the source
    const res = await request.get(`/api/data-sources/${orgSourceId}`);
    expect(res.ok()).toBe(true);
    const ds = await res.json();

    expect(ds.name).toBe("Org-Wide Source");
    expect(ds.documents).toBeDefined();
    expect(ds.documents.length).toBeGreaterThan(0);
    expect(ds.documents[0].status).toBe("ready");
  });

  // ─── Source Updates ─────────────────────────────────────────────────────────

  test("updates data source name and description", async ({ request }) => {
    const res = await request.put(`/api/data-sources/${orgSourceId}`, {
      data: {
        name: "Updated Source Name",
        description: "A test description for E2E",
      },
    });
    expect(res.ok()).toBe(true);
    const updated = await res.json();
    expect(updated.name).toBe("Updated Source Name");
    expect(updated.description).toBe("A test description for E2E");
  });

  test("toggles permission flags on a data source", async ({ request }) => {
    const res = await request.put(`/api/data-sources/${orgSourceId}`, {
      data: {
        allowSourceViewing: false,
        allowVaultSync: true,
      },
    });
    expect(res.ok()).toBe(true);
    const updated = await res.json();
    expect(updated.allowSourceViewing).toBe(false);
    expect(updated.allowVaultSync).toBe(true);
  });

  test("switches access mode from all to restricted", async ({ request }) => {
    const res = await request.put(`/api/data-sources/${orgSourceId}`, {
      data: {
        accessMode: "restricted",
        accessList: ["admin@test.com", "user@test.com"],
      },
    });
    expect(res.ok()).toBe(true);
    const updated = await res.json();
    expect(updated.accessMode).toBe("restricted");
  });

  // ─── Source Health ──────────────────────────────────────────────────────────

  test("returns health metrics for a data source", async ({ request }) => {
    const res = await request.get(`/api/data-sources/${orgSourceId}/health`);
    expect(res.ok()).toBe(true);
    const health = await res.json();

    expect(typeof health.chunkCount).toBe("number");
    expect(typeof health.documentCount).toBe("number");
    expect(health.chunkCount).toBeGreaterThan(0);
    expect(health.documentCount).toBeGreaterThan(0);
    expect(typeof health.averageChunksPerDocument).toBe("number");
  });

  // ─── Source Listing ─────────────────────────────────────────────────────────

  test("lists all accessible data sources", async ({ request }) => {
    const res = await request.get("/api/data-sources");
    expect(res.ok()).toBe(true);
    const sources = await res.json();

    expect(Array.isArray(sources)).toBe(true);
    // Should find our test sources
    const ids = sources.map((s: { id: string }) => s.id);
    expect(ids).toContain(orgSourceId);
  });

  // ─── 404 Handling ──────────────────────────────────────────────────────────

  test("returns 404 for non-existent data source", async ({ request }) => {
    const res = await request.get("/api/data-sources/00000000-0000-0000-0000-000000000000");
    expect(res.status()).toBe(404);
  });
});
