import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { setupTestApp, teardownTestApp, adminAgent, memberAgent, getDefaultOrgId } from "./helpers.js";
import { setDocument } from "../services/documentStore.js";
import { ensureDefaultDataSource } from "../services/dataSourceStore.js";
import type { Document } from "@edgebric/types";

describe("Documents API", () => {
  let orgId: string;
  let dsId: string;
  let docId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();

    // Create a default data source tied to the org
    const ds = ensureDefaultDataSource("admin@test.com", orgId);
    dsId = ds.id;

    // Seed a test document
    docId = randomUUID();
    const doc: Document = {
      id: docId,
      name: "test-policy.md",
      type: "md",
      classification: "policy",
      uploadedAt: new Date(),
      updatedAt: new Date(),
      status: "ready",
      sectionHeadings: ["Section A", "Section B"],
      storageKey: "/tmp/nonexistent-test-file.md",
      dataSourceId: dsId,
    };
    setDocument(doc);
  });

  afterAll(async () => {
    // Wait for fire-and-forget background jobs (upload → ingestDocument) to settle
    await new Promise((r) => setTimeout(r, 500));
    teardownTestApp();
  });

  // ─── GET /api/documents ───────────────────────────────────────────────

  describe("GET /api/documents", () => {
    it("returns document list for admin", async () => {
      const res = await adminAgent(orgId).get("/api/documents");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = res.body.find((d: any) => d.id === docId);
      expect(doc).toBeDefined();
      expect(doc.name).toBe("test-policy.md");
      expect(doc.type).toBe("md");
      expect(doc.status).toBe("ready");
      expect(doc.sectionHeadings).toEqual(["Section A", "Section B"]);
    });

    it("includes isStale field on each document", async () => {
      const res = await adminAgent(orgId).get("/api/documents");
      expect(res.status).toBe(200);
      for (const doc of res.body) {
        expect(typeof doc.isStale).toBe("boolean");
      }
    });

    it("rejects non-admin requests", async () => {
      const res = await memberAgent(orgId).get("/api/documents");
      expect(res.status).toBe(403);
    });
  });

  // ─── GET /api/documents/:id ───────────────────────────────────────────

  describe("GET /api/documents/:id", () => {
    it("returns a single document by ID", async () => {
      const res = await adminAgent(orgId).get(`/api/documents/${docId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(docId);
      expect(res.body.name).toBe("test-policy.md");
      expect(res.body.classification).toBe("policy");
    });

    it("returns 404 for non-existent document", async () => {
      const res = await adminAgent(orgId).get(`/api/documents/${randomUUID()}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });
  });

  // ─── GET /api/documents/:id/content ─────────────────────────────────────────

  describe("GET /api/documents/:id/content", () => {
    it("returns document content for member (source viewing enabled by default)", async () => {
      const res = await memberAgent(orgId).get(`/api/documents/${docId}/content`);
      expect(res.status).toBe(200);
      expect(res.body.document).toBeDefined();
      expect(res.body.document.id).toBe(docId);
      expect(res.body.document.name).toBe("test-policy.md");
      expect(Array.isArray(res.body.sections)).toBe(true);
    });

    it("returns document content for admin", async () => {
      const res = await adminAgent(orgId).get(`/api/documents/${docId}/content`);
      expect(res.status).toBe(200);
      expect(res.body.document.id).toBe(docId);
    });

    it("returns 404 for non-existent document", async () => {
      const res = await memberAgent(orgId).get(`/api/documents/${randomUUID()}/content`);
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });
  });

  // ─── POST /api/documents/:id/approve-pii ─────────────────────────────

  describe("POST /api/documents/:id/approve-pii", () => {
    it("rejects when document is not in pii_review status", async () => {
      // Our test doc is in "ready" status, not "pii_review"
      const res = await adminAgent(orgId)
        .post(`/api/documents/${docId}/approve-pii`);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("not pending PII review");
    });

    it("approves PII and resumes ingestion for pii_review doc", async () => {
      // Create a doc in pii_review state
      const piiDocId = randomUUID();
      setDocument({
        id: piiDocId,
        name: "pii-doc.md",
        type: "md",
        classification: "policy",
        uploadedAt: new Date(),
        updatedAt: new Date(),
        status: "pii_review",
        sectionHeadings: [],
        storageKey: "/tmp/nonexistent-pii.md",
        dataSourceId: dsId,
        piiWarnings: [{ chunkIndex: 0, excerpt: "123-45-6789", pattern: "SSN" }],
      });

      const res = await adminAgent(orgId)
        .post(`/api/documents/${piiDocId}/approve-pii`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("processing");
      expect(res.body.message).toContain("Ingestion resumed");
    });

    it("returns 404 for non-existent document", async () => {
      const res = await adminAgent(orgId)
        .post(`/api/documents/${randomUUID()}/approve-pii`);
      expect(res.status).toBe(404);
    });

    it("rejects non-UUID id param", async () => {
      const res = await adminAgent(orgId)
        .post("/api/documents/not-a-uuid/approve-pii");
      expect(res.status).toBe(400);
    });

  });

  // ─── POST /api/documents/:id/reject-pii ──────────────────────────────

  describe("POST /api/documents/:id/reject-pii", () => {
    it("rejects when document is not in pii_review status", async () => {
      const res = await adminAgent(orgId)
        .post(`/api/documents/${docId}/reject-pii`);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("not pending PII review");
    });

    it("rejects PII doc and sets status to rejected", async () => {
      const rejectDocId = randomUUID();
      setDocument({
        id: rejectDocId,
        name: "reject-me.md",
        type: "md",
        classification: "policy",
        uploadedAt: new Date(),
        updatedAt: new Date(),
        status: "pii_review",
        sectionHeadings: [],
        storageKey: "/tmp/nonexistent-reject.md",
        dataSourceId: dsId,
        piiWarnings: [{ chunkIndex: 1, excerpt: "999-99-9999", pattern: "SSN" }],
      });

      const res = await adminAgent(orgId)
        .post(`/api/documents/${rejectDocId}/reject-pii`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("rejected");
      expect(res.body.message).toContain("rejected");
    });

    it("rejects non-UUID id param", async () => {
      const res = await adminAgent(orgId)
        .post("/api/documents/not-a-uuid/reject-pii");
      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE /api/documents/:id ────────────────────────────────────────

  describe("DELETE /api/documents/:id", () => {
    it("deletes a document", async () => {
      // Create a throwaway doc
      const delId = randomUUID();
      setDocument({
        id: delId,
        name: "delete-me.md",
        type: "md",
        classification: "policy",
        uploadedAt: new Date(),
        updatedAt: new Date(),
        status: "ready",
        sectionHeadings: [],
        storageKey: "/tmp/nonexistent-delete.md",
        dataSourceId: dsId,
      });

      const res = await adminAgent(orgId)
        .delete(`/api/documents/${delId}`);
      expect(res.status).toBe(204);

      // Verify it's gone
      const check = await adminAgent(orgId)
        .get(`/api/documents/${delId}`);
      expect(check.status).toBe(404);
    });

    it("returns 404 for non-existent document", async () => {
      const res = await adminAgent(orgId)
        .delete(`/api/documents/${randomUUID()}`);
      expect(res.status).toBe(404);
    });

    it("rejects non-admin requests", async () => {
      const res = await memberAgent(orgId)
        .delete(`/api/documents/${docId}`);
      expect(res.status).toBe(403);
    });
  });

  // ─── POST /api/documents/upload ───────────────────────────────────────

  describe("POST /api/documents/upload", () => {
    it("rejects upload with no file", async () => {
      const res = await adminAgent(orgId)
        .post("/api/documents/upload");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("No file");
    });

    it("accepts a valid .txt file upload", async () => {
      const res = await adminAgent(orgId)
        .post("/api/documents/upload")
        .attach("file", Buffer.from("This is test content for the upload test."), "test-upload.txt");
      expect(res.status).toBe(202);
      expect(typeof res.body.documentId).toBe("string");
    });

    it("accepts a valid .md file upload", async () => {
      const res = await adminAgent(orgId)
        .post("/api/documents/upload")
        .attach("file", Buffer.from("# Test Markdown\n\nSome content here."), "test-upload.md");
      expect(res.status).toBe(202);
      expect(typeof res.body.documentId).toBe("string");
    });
  });
});
