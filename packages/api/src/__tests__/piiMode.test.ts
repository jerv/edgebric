import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { setupTestApp, teardownTestApp, adminAgent, memberAgent, getDefaultOrgId } from "./helpers.js";
import { createDataSource, getDataSource } from "../services/dataSourceStore.js";
import { setDocument, getDocument } from "../services/documentStore.js";
import type { Document } from "@edgebric/types";

describe("PII Mode", () => {
  let orgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
  });

  afterAll(() => {
    teardownTestApp();
  });

  // ─── Default piiMode values ────────────────────────────────────────────

  describe("default piiMode", () => {
    it("defaults to 'block' when no piiMode specified", () => {
      const ds = createDataSource({
        name: "Default PII Mode Source",
        ownerId: "admin@test.com",
        orgId,
      });
      expect(ds.piiMode).toBe("block");
    });

    it("respects explicit piiMode on creation", () => {
      const ds = createDataSource({
        name: "Warn PII Source",
        ownerId: "admin@test.com",
        orgId,
        piiMode: "warn",
      });
      expect(ds.piiMode).toBe("warn");
    });

    it("creates source with piiMode 'off'", () => {
      const ds = createDataSource({
        name: "No PII Source",
        ownerId: "admin@test.com",
        orgId,
        piiMode: "off",
      });
      expect(ds.piiMode).toBe("off");
    });
  });

  // ─── Update piiMode via API ───────────────────────────────────────────

  describe("PUT /api/data-sources/:id piiMode", () => {
    let dsId: string;

    beforeAll(() => {
      const ds = createDataSource({
        name: "Updatable PII Source",
        ownerId: "admin@test.com",
        orgId,
      });
      dsId = ds.id;
    });

    it("updates piiMode to 'warn'", async () => {
      const res = await adminAgent(orgId)
        .put(`/api/data-sources/${dsId}`)
        .send({ piiMode: "warn" });
      expect(res.status).toBe(200);
      expect(res.body.piiMode).toBe("warn");
    });

    it("updates piiMode to 'off'", async () => {
      const res = await adminAgent(orgId)
        .put(`/api/data-sources/${dsId}`)
        .send({ piiMode: "off" });
      expect(res.status).toBe(200);
      expect(res.body.piiMode).toBe("off");
    });

    it("updates piiMode back to 'block'", async () => {
      const res = await adminAgent(orgId)
        .put(`/api/data-sources/${dsId}`)
        .send({ piiMode: "block" });
      expect(res.status).toBe(200);
      expect(res.body.piiMode).toBe("block");
    });

    it("rejects invalid piiMode value", async () => {
      const res = await adminAgent(orgId)
        .put(`/api/data-sources/${dsId}`)
        .send({ piiMode: "invalid" });
      expect(res.status).toBe(400);
    });

    it("persists piiMode to database", async () => {
      await adminAgent(orgId)
        .put(`/api/data-sources/${dsId}`)
        .send({ piiMode: "warn" });
      const ds = getDataSource(dsId);
      expect(ds?.piiMode).toBe("warn");
    });
  });

  // ─── GET /api/data-sources returns piiMode ────────────────────────────

  describe("GET /api/data-sources", () => {
    it("includes piiMode in listed data sources", async () => {
      const ds = createDataSource({
        name: "Listed PII Source",
        ownerId: "admin@test.com",
        orgId,
        piiMode: "warn",
      });
      const res = await adminAgent(orgId).get("/api/data-sources");
      expect(res.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const found = res.body.find((d: any) => d.id === ds.id);
      expect(found).toBeDefined();
      expect(found.piiMode).toBe("warn");
    });
  });

  // ─── PII Summary endpoint ────────────────────────────────────────────

  describe("GET /api/data-sources/pii-summary", () => {
    it("returns empty summary when no documents have PII warnings", async () => {
      const res = await adminAgent(orgId).get("/api/data-sources/pii-summary");
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.summary).toBeDefined();
    });

    it("counts documents with PII warnings per source", async () => {
      const ds = createDataSource({
        name: "PII Summary Source",
        ownerId: "admin@test.com",
        orgId,
      });

      // Create a document with PII warnings
      const docId = randomUUID();
      const doc: Document = {
        id: docId,
        name: "pii-doc.md",
        type: "md",
        classification: "policy",
        uploadedAt: new Date(),
        updatedAt: new Date(),
        status: "ready",
        sectionHeadings: [],
        storageKey: "/tmp/test.md",
        dataSourceId: ds.id,
        piiWarnings: [
          { chunkIndex: 0, excerpt: "John Doe SSN 123-45-6789", pattern: "SSN" },
        ],
      };
      setDocument(doc);

      const res = await adminAgent(orgId).get("/api/data-sources/pii-summary");
      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.summary[ds.id]).toBeGreaterThanOrEqual(1);
    });

    it("accessible to non-admin members", async () => {
      const res = await memberAgent(orgId).get("/api/data-sources/pii-summary");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("total");
      expect(res.body).toHaveProperty("summary");
    });
  });

  // ─── ingestDocument respects piiMode ──────────────────────────────────

  describe("ingestDocument piiMode behavior", () => {
    it("piiMode 'off' skips PII detection entirely", async () => {
      const { ingestDocument } = await import("../jobs/ingestDocument.js");
      const ds = createDataSource({
        name: "Off PII Source",
        ownerId: "admin@test.com",
        orgId,
        piiMode: "off",
      });

      const docId = randomUUID();
      const doc: Document = {
        id: docId,
        name: "sensitive-doc.md",
        type: "md",
        classification: "policy",
        uploadedAt: new Date(),
        updatedAt: new Date(),
        status: "processing",
        sectionHeadings: [],
        storageKey: "/tmp/test-pii-off.md",
        dataSourceId: ds.id,
      };
      setDocument(doc);

      // Mock extractDocument to return content with PII-like patterns
      const extractors = await import("../jobs/extractors.js");
      const mockExtract = vi.spyOn(extractors, "extractDocument").mockResolvedValue({
        markdown: "Employee SSN: 123-45-6789\nContact: john@example.com",
        headingPageMap: new Map(),
      });

      // Mock embed to avoid needing inference server
      const inferenceClient = await import("../services/inferenceClient.js");
      const mockEmbed = vi.spyOn(inferenceClient, "embed").mockResolvedValue(new Array(768).fill(0));

      try {
        await ingestDocument(doc, { datasetName: ds.datasetName, piiMode: "off" });
        const result = getDocument(docId);
        expect(result?.status).toBe("ready");
        // No PII warnings should be stored
        expect(result?.piiWarnings).toBeUndefined();
      } finally {
        mockExtract.mockRestore();
        mockEmbed.mockRestore();
      }
    });

    it("piiMode 'warn' stores warnings but continues ingestion", async () => {
      const { ingestDocument } = await import("../jobs/ingestDocument.js");
      const ds = createDataSource({
        name: "Warn PII Source",
        ownerId: "admin@test.com",
        orgId,
        piiMode: "warn",
      });

      const docId = randomUUID();
      const doc: Document = {
        id: docId,
        name: "warn-doc.md",
        type: "md",
        classification: "policy",
        uploadedAt: new Date(),
        updatedAt: new Date(),
        status: "processing",
        sectionHeadings: [],
        storageKey: "/tmp/test-pii-warn.md",
        dataSourceId: ds.id,
      };
      setDocument(doc);

      const extractors = await import("../jobs/extractors.js");
      const mockExtract = vi.spyOn(extractors, "extractDocument").mockResolvedValue({
        markdown: "Employee SSN: 123-45-6789\nContact: john@example.com",
        headingPageMap: new Map(),
      });

      const inferenceClient = await import("../services/inferenceClient.js");
      const mockEmbed = vi.spyOn(inferenceClient, "embed").mockResolvedValue(new Array(768).fill(0));

      try {
        await ingestDocument(doc, { datasetName: ds.datasetName, piiMode: "warn" });
        const result = getDocument(docId);
        // Document should be "ready" (not "pii_review")
        expect(result?.status).toBe("ready");
        // But PII warnings should be stored
        expect(result?.piiWarnings).toBeDefined();
        expect(result!.piiWarnings!.length).toBeGreaterThan(0);
      } finally {
        mockExtract.mockRestore();
        mockEmbed.mockRestore();
      }
    });

    it("piiMode 'block' halts ingestion when PII found", async () => {
      const { ingestDocument } = await import("../jobs/ingestDocument.js");
      const ds = createDataSource({
        name: "Block PII Source",
        ownerId: "admin@test.com",
        orgId,
        piiMode: "block",
      });

      const docId = randomUUID();
      const doc: Document = {
        id: docId,
        name: "block-doc.md",
        type: "md",
        classification: "policy",
        uploadedAt: new Date(),
        updatedAt: new Date(),
        status: "processing",
        sectionHeadings: [],
        storageKey: "/tmp/test-pii-block.md",
        dataSourceId: ds.id,
      };
      setDocument(doc);

      const extractors = await import("../jobs/extractors.js");
      const mockExtract = vi.spyOn(extractors, "extractDocument").mockResolvedValue({
        markdown: "Employee SSN: 123-45-6789\nContact: john@example.com",
        headingPageMap: new Map(),
      });

      try {
        await ingestDocument(doc, { datasetName: ds.datasetName, piiMode: "block" });
        const result = getDocument(docId);
        // Document should be halted at "pii_review"
        expect(result?.status).toBe("pii_review");
        expect(result?.piiWarnings).toBeDefined();
        expect(result!.piiWarnings!.length).toBeGreaterThan(0);
      } finally {
        mockExtract.mockRestore();
      }
    });

    it("piiMode 'block' allows clean documents through", async () => {
      const { ingestDocument } = await import("../jobs/ingestDocument.js");
      const ds = createDataSource({
        name: "Block Clean Source",
        ownerId: "admin@test.com",
        orgId,
        piiMode: "block",
      });

      const docId = randomUUID();
      const doc: Document = {
        id: docId,
        name: "clean-doc.md",
        type: "md",
        classification: "policy",
        uploadedAt: new Date(),
        updatedAt: new Date(),
        status: "processing",
        sectionHeadings: [],
        storageKey: "/tmp/test-pii-clean.md",
        dataSourceId: ds.id,
      };
      setDocument(doc);

      const extractors = await import("../jobs/extractors.js");
      const mockExtract = vi.spyOn(extractors, "extractDocument").mockResolvedValue({
        markdown: "This is a clean document about company policies.",
        headingPageMap: new Map(),
      });

      const inferenceClient = await import("../services/inferenceClient.js");
      const mockEmbed = vi.spyOn(inferenceClient, "embed").mockResolvedValue(new Array(768).fill(0));

      try {
        await ingestDocument(doc, { datasetName: ds.datasetName, piiMode: "block" });
        const result = getDocument(docId);
        expect(result?.status).toBe("ready");
      } finally {
        mockExtract.mockRestore();
        mockEmbed.mockRestore();
      }
    });
  });
});
