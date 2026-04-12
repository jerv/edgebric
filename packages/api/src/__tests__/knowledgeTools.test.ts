import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { clearTools, executeTool, getTool } from "../services/toolRunner.js";
import { registerKnowledgeTools } from "../services/tools/knowledge.js";
import { createDataSource, getDataSource, deleteDataSource } from "../services/dataSourceStore.js";
import { setDocument } from "../services/documentStore.js";
import type { ToolContext } from "../services/toolRunner.js";
import type { Document } from "@edgebric/types";
import { setupTestApp, teardownTestApp, getDefaultOrgId } from "./helpers.js";

let orgId: string;

const adminCtx: ToolContext = { userEmail: "admin@test.com", isAdmin: true, orgId: "" };
const memberCtx: ToolContext = { userEmail: "member@test.com", isAdmin: false, orgId: "" };

function makeDoc(overrides: Partial<Document> & { id: string; name: string; dataSourceId: string }): Document {
  return {
    type: "txt",
    classification: "policy",
    uploadedAt: new Date(),
    updatedAt: new Date(),
    status: "ready",
    sectionHeadings: ["Section 1", "Section 2"],
    storageKey: `/tmp/test-${overrides.id}.txt`,
    ...overrides,
  };
}

describe("Knowledge Tools", () => {
  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
    adminCtx.orgId = orgId;
    memberCtx.orgId = orgId;
  });
  afterAll(() => { teardownTestApp(); });
  beforeEach(() => { clearTools(); registerKnowledgeTools(); });

  // ─── Registration ─────────────────────────────────────────────────────

  describe("registration", () => {
    it("registers all 12 knowledge tools", () => {
      const expectedTools = [
        "search_knowledge", "list_sources", "list_documents",
        "get_source_summary", "create_source", "update_source", "upload_document",
        "rename_document", "delete_document", "delete_source", "save_to_vault",
        "compare_documents", "cite_check", "find_related",
      ];
      for (const name of expectedTools) {
        expect(getTool(name)).toBeDefined();
      }
    });
  });

  // ─── list_sources ─────────────────────────────────────────────────────

  describe("list_sources", () => {
    it("returns accessible data sources for admin", async () => {
      const ds = createDataSource({ name: "Test Source", ownerId: "admin@test.com", orgId });
      const result = await executeTool("list_sources", {}, adminCtx);
      expect(result.success).toBe(true);
      const data = result.data as { sourceCount: number; sources: Array<{ id: string; name: string }> };
      expect(data.sourceCount).toBeGreaterThanOrEqual(1);
      const names = data.sources.map((s) => s.name);
      expect(names).toContain("Test Source");
      deleteDataSource(ds.id);
    });
  });

  // ─── list_documents ───────────────────────────────────────────────────

  describe("list_documents", () => {
    it("returns documents in a source", async () => {
      const ds = createDataSource({ name: "Doc Source", ownerId: "admin@test.com", orgId });
      const doc = makeDoc({ id: "doc-list-1", name: "test.txt", dataSourceId: ds.id });
      setDocument(doc);

      const result = await executeTool("list_documents", { sourceId: ds.id }, adminCtx);
      expect(result.success).toBe(true);
      const data = result.data as { documentCount: number; documents: Array<{ name: string }> };
      expect(data.documentCount).toBe(1);
      expect(data.documents[0]!.name).toBe("test.txt");

      deleteDataSource(ds.id);
    });

    it("returns error for non-existent source", async () => {
      const result = await executeTool("list_documents", { sourceId: "nonexistent" }, adminCtx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/);
    });

    it("denies access for unauthorized member", async () => {
      const ds = createDataSource({
        name: "Restricted",
        ownerId: "admin@test.com",
        orgId: "other-org",
      });
      const result = await executeTool("list_documents", { sourceId: ds.id }, memberCtx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Access denied/);
      deleteDataSource(ds.id);
    });
  });

  // ─── get_source_summary ───────────────────────────────────────────────

  describe("get_source_summary", () => {
    it("returns source summary with documents", async () => {
      const ds = createDataSource({ name: "Summary Source", ownerId: "admin@test.com", orgId });
      const doc = makeDoc({ id: "doc-sum-1", name: "policy.pdf", dataSourceId: ds.id });
      setDocument(doc);

      const result = await executeTool("get_source_summary", { sourceId: ds.id }, adminCtx);
      expect(result.success).toBe(true);
      const data = result.data as { sourceName: string; documentCount: number };
      expect(data.sourceName).toBe("Summary Source");
      expect(data.documentCount).toBe(1);

      deleteDataSource(ds.id);
    });
  });

  // ─── create_source ────────────────────────────────────────────────────

  describe("create_source", () => {
    it("creates a new data source", async () => {
      const result = await executeTool("create_source", {
        name: "New Knowledge Base",
        description: "Created by tool",
      }, adminCtx);
      expect(result.success).toBe(true);
      const data = result.data as { id: string; name: string };
      expect(data.name).toBe("New Knowledge Base");
      expect(data.id).toBeTruthy();

      // Verify it was created
      const ds = getDataSource(data.id);
      expect(ds).toBeDefined();
      expect(ds!.name).toBe("New Knowledge Base");

      deleteDataSource(data.id);
    });

    it("requires name parameter", async () => {
      const result = await executeTool("create_source", {}, adminCtx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Missing required/);
    });
  });

  describe("update_source", () => {
    it("updates access and security settings on a source", async () => {
      const ds = createDataSource({ name: "Mutable Source", ownerId: "admin@test.com", orgId });
      const result = await executeTool("update_source", {
        sourceId: ds.id,
        accessMode: "restricted",
        accessList: ["member@test.com"],
        allowSourceViewing: false,
        allowVaultSync: false,
        piiMode: "warn",
      }, adminCtx);
      expect(result.success).toBe(true);
      const data = result.data as {
        accessMode: string;
        accessList: string[];
        allowSourceViewing: boolean;
        allowVaultSync: boolean;
        piiMode: string;
      };
      expect(data.accessMode).toBe("restricted");
      expect(data.accessList).toEqual(["member@test.com"]);
      expect(data.allowSourceViewing).toBe(false);
      expect(data.allowVaultSync).toBe(false);
      expect(data.piiMode).toBe("warn");
      deleteDataSource(ds.id);
    });
  });

  // ─── delete_source ────────────────────────────────────────────────────

  describe("delete_source", () => {
    it("deletes a source (admin only)", async () => {
      const ds = createDataSource({ name: "To Delete", ownerId: "admin@test.com", orgId });
      const result = await executeTool("delete_source", { sourceId: ds.id }, adminCtx);
      expect(result.success).toBe(true);
      expect(getDataSource(ds.id)).toBeUndefined();
    });

    it("rejects non-admin deletion", async () => {
      const ds = createDataSource({ name: "Protected", ownerId: "admin@test.com", orgId });
      const result = await executeTool("delete_source", { sourceId: ds.id }, memberCtx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Admin access required/);
      deleteDataSource(ds.id);
    });

    it("returns error for non-existent source", async () => {
      const result = await executeTool("delete_source", { sourceId: "nonexistent" }, adminCtx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/);
    });
  });

  // ─── compare_documents ────────────────────────────────────────────────

  describe("compare_documents", () => {
    it("compares two documents by section headings", async () => {
      const ds = createDataSource({ name: "Compare Source", ownerId: "admin@test.com", orgId });
      const doc1 = makeDoc({
        id: "cmp-1",
        name: "doc1.txt",
        dataSourceId: ds.id,
        sectionHeadings: ["Intro", "Benefits", "Terms"],
      });
      const doc2 = makeDoc({
        id: "cmp-2",
        name: "doc2.txt",
        dataSourceId: ds.id,
        sectionHeadings: ["Intro", "Pricing", "Terms"],
      });
      setDocument(doc1);
      setDocument(doc2);

      const result = await executeTool("compare_documents", {
        docId1: "cmp-1",
        docId2: "cmp-2",
      }, adminCtx);
      expect(result.success).toBe(true);
      const data = result.data as {
        sectionsOnlyIn1: string[];
        sectionsOnlyIn2: string[];
        sharedSections: string[];
      };
      expect(data.sectionsOnlyIn1).toEqual(["Benefits"]);
      expect(data.sectionsOnlyIn2).toEqual(["Pricing"]);
      expect(data.sharedSections).toEqual(["Intro", "Terms"]);

      deleteDataSource(ds.id);
    });

    it("returns error for missing document", async () => {
      const result = await executeTool("compare_documents", {
        docId1: "nonexistent",
        docId2: "also-nonexistent",
      }, adminCtx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/);
    });
  });

  // ─── upload_document ──────────────────────────────────────────────────

  describe("upload_document", () => {
    it("requires all parameters", async () => {
      const result = await executeTool("upload_document", { sourceId: "x" }, adminCtx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Missing required/);
    });

    it("returns error for non-existent source", async () => {
      const result = await executeTool("upload_document", {
        sourceId: "nonexistent",
        content: "test content",
        filename: "test.txt",
      }, adminCtx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/);
    });
  });

  describe("rename_document", () => {
    it("renames an accessible document by name", async () => {
      const ds = createDataSource({ name: "Rename Source", ownerId: "admin@test.com", orgId });
      const doc = makeDoc({ id: "doc-rename-1", name: "old-name.txt", dataSourceId: ds.id });
      setDocument(doc);

      const result = await executeTool("rename_document", {
        documentName: "old-name.txt",
        newName: "new-name.txt",
      }, adminCtx);
      expect(result.success).toBe(true);
      const data = result.data as { previousName: string; newName: string };
      expect(data.previousName).toBe("old-name.txt");
      expect(data.newName).toBe("new-name.txt");

      deleteDataSource(ds.id);
    });
  });

  // ─── save_to_vault ────────────────────────────────────────────────────

  describe("save_to_vault", () => {
    it("requires content and title", async () => {
      const result = await executeTool("save_to_vault", { content: "test" }, adminCtx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Missing required/);
    });
  });

  // ─── search_knowledge ─────────────────────────────────────────────────

  describe("search_knowledge", () => {
    it("requires query parameter", async () => {
      const result = await executeTool("search_knowledge", {}, adminCtx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Missing required/);
    });
  });

  // ─── cite_check ───────────────────────────────────────────────────────

  describe("cite_check", () => {
    it("requires claim parameter", async () => {
      const result = await executeTool("cite_check", {}, adminCtx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Missing required/);
    });
  });

  // ─── find_related ─────────────────────────────────────────────────────

  describe("find_related", () => {
    it("returns error for non-existent document", async () => {
      const result = await executeTool("find_related", { documentId: "nonexistent" }, adminCtx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/);
    });
  });

  // ─── delete_document ──────────────────────────────────────────────────

  describe("delete_document", () => {
    it("returns error for non-existent document", async () => {
      const result = await executeTool("delete_document", { documentId: "nonexistent" }, adminCtx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/);
    });
  });
});
