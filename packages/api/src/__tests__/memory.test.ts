import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestApp, teardownTestApp, getDefaultOrgId, adminAgent } from "./helpers.js";
import {
  getOrCreateMemoryDataSource,
  saveMemory,
  listMemories,
  getMemory,
  updateMemory,
  deleteMemory,
  isMemoryDataSource,
  isMemoryEnabled,
  getMemoryDatasetName,
} from "../services/memoryStore.js";
import { getIntegrationConfig, setIntegrationConfig } from "../services/integrationConfigStore.js";
import { clearTools, executeTool, getTool } from "../services/toolRunner.js";
import { registerMemoryTools } from "../services/tools/memory.js";
import { extractMemories } from "../services/memoryExtractor.js";
import { buildMemoryContext } from "@edgebric/core/rag";
import type { ToolContext } from "../services/toolRunner.js";

let orgId: string;
const adminCtx: ToolContext = { userEmail: "admin@test.com", isAdmin: true, orgId: "" };

describe("Memory System", () => {
  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
    adminCtx.orgId = orgId;
  });
  afterAll(() => { teardownTestApp(); });

  // ─── Memory Store ──────────────────────────────────────────────────────

  describe("memoryStore", () => {
    describe("getOrCreateMemoryDataSource", () => {
      it("creates a memory data source for solo mode", () => {
        const ds = getOrCreateMemoryDataSource();
        expect(ds).toBeDefined();
        expect(ds.name).toBe("Memory");
        expect(ds.type).toBe("personal");
        expect(ds.datasetName).toBe("memory");
      });

      it("returns the same data source on subsequent calls (idempotent)", () => {
        const ds1 = getOrCreateMemoryDataSource();
        const ds2 = getOrCreateMemoryDataSource();
        expect(ds1.id).toBe(ds2.id);
      });

      it("creates a per-user data source in org mode", () => {
        const ds = getOrCreateMemoryDataSource(orgId, "user@test.com");
        expect(ds).toBeDefined();
        expect(ds.name).toBe("Memory");
        expect(ds.datasetName).toMatch(/^memory-user-test-com/);
      });

      it("creates separate data sources for different users", () => {
        const ds1 = getOrCreateMemoryDataSource(orgId, "alice@test.com");
        const ds2 = getOrCreateMemoryDataSource(orgId, "bob@test.com");
        expect(ds1.id).not.toBe(ds2.id);
        expect(ds1.datasetName).not.toBe(ds2.datasetName);
      });
    });

    describe("isMemoryDataSource", () => {
      it("identifies memory data sources", () => {
        const ds = getOrCreateMemoryDataSource();
        expect(isMemoryDataSource(ds)).toBe(true);
      });
    });

    describe("isMemoryEnabled", () => {
      it("returns true by default", () => {
        expect(isMemoryEnabled()).toBe(true);
      });

      it("returns false when disabled in config", () => {
        const cfg = getIntegrationConfig();
        setIntegrationConfig({ ...cfg, memoryEnabled: false } as typeof cfg & { memoryEnabled: boolean });
        expect(isMemoryEnabled()).toBe(false);
        // Restore
        setIntegrationConfig({ ...cfg, memoryEnabled: true } as typeof cfg & { memoryEnabled: boolean });
      });
    });

    describe("CRUD operations", () => {
      it("saves a memory entry", async () => {
        const entry = await saveMemory({
          content: "User prefers dark mode",
          category: "preference",
          userId: "crud@test.com",
        });
        expect(entry.id).toBeDefined();
        expect(entry.content).toBe("User prefers dark mode");
        expect(entry.category).toBe("preference");
        expect(entry.confidence).toBe(1.0);
        expect(entry.source).toBe("explicit");
      });

      it("lists memories for a user", async () => {
        await saveMemory({
          content: "Works in engineering",
          category: "fact",
          userId: "list@test.com",
        });
        await saveMemory({
          content: "Prefers bullet points",
          category: "preference",
          userId: "list@test.com",
        });

        const memories = listMemories(undefined, "list@test.com");
        expect(memories.length).toBeGreaterThanOrEqual(2);
        expect(memories.some((m) => m.content === "Works in engineering")).toBe(true);
        expect(memories.some((m) => m.content === "Prefers bullet points")).toBe(true);
      });

      it("gets a memory by ID", async () => {
        const entry = await saveMemory({
          content: "Name is Alice",
          category: "fact",
          userId: "getmem@test.com",
        });
        const retrieved = getMemory(entry.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.content).toBe("Name is Alice");
        expect(retrieved!.category).toBe("fact");
      });

      it("updates a memory entry", async () => {
        const entry = await saveMemory({
          content: "Prefers JSON",
          category: "preference",
          userId: "update@test.com",
        });
        const updated = await updateMemory(
          entry.id,
          { content: "Prefers YAML" },
          undefined,
          "update@test.com",
        );
        expect(updated).not.toBeNull();
        expect(updated!.content).toBe("Prefers YAML");
        expect(updated!.category).toBe("preference");
      });

      it("deletes a memory entry", async () => {
        const entry = await saveMemory({
          content: "To be deleted",
          category: "fact",
          userId: "delete@test.com",
        });
        const deleted = deleteMemory(entry.id, undefined, "delete@test.com");
        expect(deleted).toBe(true);
        const retrieved = getMemory(entry.id);
        expect(retrieved).toBeNull();
      });

      it("returns false when deleting non-existent memory", () => {
        const deleted = deleteMemory("non-existent-id");
        expect(deleted).toBe(false);
      });

      it("returns null when getting non-existent memory", () => {
        const retrieved = getMemory("non-existent-id");
        expect(retrieved).toBeNull();
      });
    });

    describe("getMemoryDatasetName", () => {
      it("returns null when no memory data source exists", () => {
        const name = getMemoryDatasetName(undefined, "nobody@test.com");
        expect(name).toBeNull();
      });

      it("returns dataset name after creating a memory", async () => {
        await saveMemory({
          content: "test",
          category: "fact",
          userId: "dsname@test.com",
        });
        const name = getMemoryDatasetName(undefined, "dsname@test.com");
        expect(name).not.toBeNull();
        expect(name).toMatch(/^memory-/);
      });
    });
  });

  // ─── Memory Tools ─────────────────────────────────────────────────────

  describe("memory tools", () => {
    beforeEach(() => { clearTools(); registerMemoryTools(); });

    it("registers all 3 memory tools", () => {
      expect(getTool("save_memory")).toBeDefined();
      expect(getTool("list_memories")).toBeDefined();
      expect(getTool("delete_memory")).toBeDefined();
    });

    it("save_memory creates a memory entry", async () => {
      const result = await executeTool("save_memory", {
        content: "Prefers concise answers",
        category: "preference",
      }, adminCtx);
      expect(result.success).toBe(true);
      const data = result.data as { id: string; content: string; category: string };
      expect(data.content).toBe("Prefers concise answers");
      expect(data.category).toBe("preference");
    });

    it("save_memory rejects content over 500 chars", async () => {
      const result = await executeTool("save_memory", {
        content: "x".repeat(501),
        category: "fact",
      }, adminCtx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("too long");
    });

    it("list_memories returns saved memories", async () => {
      await executeTool("save_memory", {
        content: "Works at Acme Corp",
        category: "fact",
      }, adminCtx);

      const result = await executeTool("list_memories", {}, adminCtx);
      expect(result.success).toBe(true);
      const data = result.data as { count: number; memories: Array<{ content: string }> };
      expect(data.count).toBeGreaterThan(0);
      expect(data.memories.some((m) => m.content === "Works at Acme Corp")).toBe(true);
    });

    it("list_memories filters by category", async () => {
      await executeTool("save_memory", {
        content: "Never use emojis",
        category: "instruction",
      }, adminCtx);

      const result = await executeTool("list_memories", { category: "instruction" }, adminCtx);
      expect(result.success).toBe(true);
      const data = result.data as { memories: Array<{ category: string }> };
      expect(data.memories.every((m) => m.category === "instruction")).toBe(true);
    });

    it("delete_memory removes a memory", async () => {
      const saveResult = await executeTool("save_memory", {
        content: "To be deleted via tool",
        category: "fact",
      }, adminCtx);
      const data = (saveResult.data as { id: string });

      const deleteResult = await executeTool("delete_memory", { memoryId: data.id }, adminCtx);
      expect(deleteResult.success).toBe(true);
    });

    it("delete_memory fails for non-existent ID", async () => {
      const result = await executeTool("delete_memory", { memoryId: "fake-id" }, adminCtx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("tools return error when memory is disabled", async () => {
      const cfg = getIntegrationConfig();
      setIntegrationConfig({ ...cfg, memoryEnabled: false } as typeof cfg & { memoryEnabled: boolean });

      const saveResult = await executeTool("save_memory", {
        content: "test",
        category: "fact",
      }, adminCtx);
      expect(saveResult.success).toBe(false);
      expect(saveResult.error).toContain("disabled");

      const listResult = await executeTool("list_memories", {}, adminCtx);
      expect(listResult.success).toBe(false);

      const deleteResult = await executeTool("delete_memory", { memoryId: "x" }, adminCtx);
      expect(deleteResult.success).toBe(false);

      // Restore
      setIntegrationConfig({ ...cfg, memoryEnabled: true } as typeof cfg & { memoryEnabled: boolean });
    });
  });

  // ─── Memory Extractor ─────────────────────────────────────────────────

  describe("memoryExtractor", () => {
    describe("extractMemories", () => {
      it("extracts preference from 'I prefer' patterns", () => {
        const results = extractMemories("I prefer dark mode for all interfaces");
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.category).toBe("preference");
      });

      it("extracts preference from 'always use' patterns", () => {
        const results = extractMemories("Always use bullet points in your responses");
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.category).toBe("preference");
      });

      it("extracts preference from 'never' patterns", () => {
        const results = extractMemories("Never use emojis in your responses to me");
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.category).toBe("preference");
      });

      it("extracts fact from 'I am a' patterns", () => {
        const results = extractMemories("I am a software engineer at Google");
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.category).toBe("fact");
      });

      it("extracts fact from 'my role is' patterns", () => {
        const results = extractMemories("My role is senior product manager");
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.category).toBe("fact");
      });

      it("extracts fact from 'I work in' patterns", () => {
        const results = extractMemories("I work in the legal department");
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.category).toBe("fact");
      });

      it("extracts correction from 'no, I meant' patterns", () => {
        const results = extractMemories("No, I meant the quarterly report not the annual one");
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.category).toBe("instruction");
      });

      it("extracts correction from 'actually' patterns", () => {
        const results = extractMemories("Actually, I need the output in CSV format not JSON");
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.category).toBe("instruction");
      });

      it("returns empty for questions", () => {
        const results = extractMemories("Do you prefer dark mode?");
        expect(results).toEqual([]);
      });

      it("returns empty for very short messages", () => {
        const results = extractMemories("hi");
        expect(results).toEqual([]);
      });

      it("returns empty for unmatched messages", () => {
        const results = extractMemories("Tell me about the company vacation policy");
        expect(results).toEqual([]);
      });

      it("truncates very long extracted content", () => {
        const longMsg = "I prefer " + "x".repeat(300) + " for everything";
        const results = extractMemories(longMsg);
        if (results.length > 0) {
          expect(results[0]!.content.length).toBeLessThanOrEqual(200);
        }
      });
    });
  });

  // ─── Memory Context ───────────────────────────────────────────────────

  describe("memoryContext", () => {
    describe("buildMemoryContext", () => {
      it("returns empty string when no memories found", async () => {
        const result = await buildMemoryContext("test query", async () => []);
        expect(result).toBe("");
      });

      it("formats memories into a user_context block", async () => {
        const mockSearch = async () => [
          { content: "Prefers PDF format", category: "preference", confidence: 0.9 },
          { content: "Works in legal department", category: "fact", confidence: 0.8 },
        ];
        const result = await buildMemoryContext("what format", mockSearch);
        expect(result).toContain("<user_context>");
        expect(result).toContain("</user_context>");
        expect(result).toContain("Prefers PDF format");
        expect(result).toContain("Works in legal department");
        expect(result).toContain("[1]");
        expect(result).toContain("[2]");
      });

      it("respects max character limit", async () => {
        const mockSearch = async () =>
          Array.from({ length: 20 }, (_, i) => ({
            content: `Memory item ${i} with some extra text to fill space`,
            category: "fact",
            confidence: 0.9,
          }));
        const result = await buildMemoryContext("test", mockSearch);
        // Should be under ~1000 chars total (800 content + tags)
        expect(result.length).toBeLessThan(1200);
      });

      it("limits to maxResults", async () => {
        let requestedTopK = 0;
        const mockSearch = async (_q: string, topK: number) => {
          requestedTopK = topK;
          return [];
        };
        await buildMemoryContext("test", mockSearch, 3);
        expect(requestedTopK).toBe(3);
      });
    });
  });

  // ─── Memory API Routes ────────────────────────────────────────────────

  describe("API routes", () => {
    it("GET /api/memory returns memories", async () => {
      const agent = adminAgent(orgId);
      const res = await agent.get("/api/memory");
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(Array.isArray(res.body.memories)).toBe(true);
    });

    it("POST /api/memory creates a memory", async () => {
      const agent = adminAgent(orgId);
      const res = await agent
        .post("/api/memory")
        .send({ content: "Prefers verbose responses", category: "preference" });
      expect(res.status).toBe(201);
      expect(res.body.content).toBe("Prefers verbose responses");
      expect(res.body.category).toBe("preference");
      expect(res.body.confidence).toBe(1.0);
      expect(res.body.source).toBe("explicit");
      expect(res.body.id).toBeDefined();
    });

    it("POST /api/memory validates input", async () => {
      const agent = adminAgent(orgId);
      const res = await agent
        .post("/api/memory")
        .send({ content: "", category: "preference" });
      expect(res.status).toBe(400);
    });

    it("POST /api/memory rejects invalid category", async () => {
      const agent = adminAgent(orgId);
      const res = await agent
        .post("/api/memory")
        .send({ content: "test", category: "invalid" });
      expect(res.status).toBe(400);
    });

    it("PUT /api/memory/:id updates a memory", async () => {
      const agent = adminAgent(orgId);
      const createRes = await agent
        .post("/api/memory")
        .send({ content: "Old content", category: "fact" });
      const id = createRes.body.id;

      const updateRes = await agent
        .put(`/api/memory/${id}`)
        .send({ content: "Updated content" });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.content).toBe("Updated content");
    });

    it("PUT /api/memory/:id returns 404 for non-existent", async () => {
      const agent = adminAgent(orgId);
      const res = await agent
        .put("/api/memory/non-existent")
        .send({ content: "test" });
      expect(res.status).toBe(404);
    });

    it("DELETE /api/memory/:id removes a memory", async () => {
      const agent = adminAgent(orgId);
      const createRes = await agent
        .post("/api/memory")
        .send({ content: "To delete", category: "fact" });
      const id = createRes.body.id;

      const deleteRes = await agent.delete(`/api/memory/${id}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.deleted).toBe(true);
    });

    it("DELETE /api/memory/:id returns 404 for non-existent", async () => {
      const agent = adminAgent(orgId);
      const res = await agent.delete("/api/memory/non-existent");
      expect(res.status).toBe(404);
    });

    it("PATCH /api/memory/toggle enables/disables memory", async () => {
      const agent = adminAgent(orgId);

      const disableRes = await agent
        .patch("/api/memory/toggle")
        .send({ enabled: false });
      expect(disableRes.status).toBe(200);
      expect(disableRes.body.enabled).toBe(false);

      // Verify it's disabled
      const listRes = await agent.get("/api/memory");
      expect(listRes.body.enabled).toBe(false);

      // Re-enable
      const enableRes = await agent
        .patch("/api/memory/toggle")
        .send({ enabled: true });
      expect(enableRes.status).toBe(200);
      expect(enableRes.body.enabled).toBe(true);
    });

    it("POST /api/memory returns 403 when disabled", async () => {
      const agent = adminAgent(orgId);

      await agent.patch("/api/memory/toggle").send({ enabled: false });

      const res = await agent
        .post("/api/memory")
        .send({ content: "test", category: "fact" });
      expect(res.status).toBe(403);

      // Re-enable
      await agent.patch("/api/memory/toggle").send({ enabled: true });
    });

    it("requires authentication", async () => {
      setupTestApp();
      const supertest = await import("supertest");
      // Create agent without auth
      const express = await import("express");
      const { createApp } = await import("../app.js");
      const testApp = createApp({
        skipSession: true,
        skipCsrf: true,
        skipRateLimit: true,
        skipRequestLogging: true,
      });
      const wrapper = express.default();
      wrapper.use((req: any, _res: any, next: any) => {
        req.session = { save: (cb: any) => cb?.(), destroy: (cb: any) => cb?.() };
        next();
      });
      wrapper.use(testApp);

      const res = await supertest.default(wrapper).get("/api/memory");
      expect(res.status).toBe(401);
    });
  });
});
