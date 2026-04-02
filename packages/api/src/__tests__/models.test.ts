import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { setupTestApp, teardownTestApp, adminAgent, memberAgent, getDefaultOrgId } from "./helpers.js";

// Mock inferenceClient before any route imports
vi.mock("../services/inferenceClient.js", () => ({
  isRunning: vi.fn().mockResolvedValue(true),
  listInstalled: vi.fn().mockResolvedValue([
    {
      tag: "qwen3-4b",
      filename: "Qwen3-4B-Q4_K_M.gguf",
      name: "Qwen 3 4B",
      sizeBytes: 2_700_000_000,
      modifiedAt: "2026-03-20T00:00:00Z",
      status: "installed",
    },
    {
      tag: "nomic-embed-text",
      filename: "nomic-embed-text-v1.5.Q8_0.gguf",
      name: "Nomic Embed Text",
      sizeBytes: 150_000_000,
      modifiedAt: "2026-03-20T00:00:00Z",
      status: "installed",
    },
  ]),
  listRunning: vi.fn().mockResolvedValue(
    new Map([["qwen3-4b", { ramUsageBytes: 3_500_000_000 }]]),
  ),
  loadModel: vi.fn().mockResolvedValue(undefined),
  unloadModel: vi.fn().mockResolvedValue(undefined),
  deleteModel: vi.fn().mockResolvedValue(undefined),
  getSystemResources: vi.fn().mockReturnValue({
    ramTotalBytes: 16 * 1024 ** 3,
    ramAvailableBytes: 8 * 1024 ** 3,
    diskFreeBytes: 100 * 1024 ** 3,
    diskTotalBytes: 500 * 1024 ** 3,
  }),
  getStorageBreakdown: vi.fn().mockReturnValue({
    modelsBytes: 5 * 1024 ** 3,
    uploadsBytes: 2 * 1024 ** 3,
    dbBytes: 0,
    vaultBytes: 0,
  }),
}));

describe("Models API", () => {
  let orgId: string;

  beforeAll(() => {
    setupTestApp();
    orgId = getDefaultOrgId();
  });
  afterAll(() => { teardownTestApp(); });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET /api/admin/models ──────────────────────────────────────────────────

  describe("GET /api/admin/models", () => {
    it("returns models, catalog, active model, and system resources", async () => {
      const res = await adminAgent(orgId).get("/api/admin/models");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.models)).toBe(true);
      expect(Array.isArray(res.body.catalog)).toBe(true);
      expect(typeof res.body.activeModel).toBe("string");
      expect(res.body.system).toBeDefined();
      expect(typeof res.body.system.ramTotalBytes).toBe("number");
      expect(typeof res.body.system.diskFreeBytes).toBe("number");
    });

    it("includes loaded status on running models", async () => {
      const res = await adminAgent(orgId).get("/api/admin/models");
      const qwen = res.body.models.find((m: any) => m.tag === "qwen3-4b");
      expect(qwen).toBeDefined();
      expect(qwen.status).toBe("loaded");
      expect(typeof qwen.ramUsageBytes).toBe("number");
    });

    it("marks non-running models as installed", async () => {
      const res = await adminAgent(orgId).get("/api/admin/models");
      const embed = res.body.models.find((m: any) => m.tag === "nomic-embed-text");
      expect(embed).toBeDefined();
      expect(embed.status).toBe("installed");
    });

    it("returns empty models list when inference server is down", async () => {
      const { isRunning } = await import("../services/inferenceClient.js");
      (isRunning as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const res = await adminAgent(orgId).get("/api/admin/models");
      expect(res.status).toBe(200);
      expect(res.body.models).toEqual([]);
      // Catalog and system should still be present
      expect(res.body.catalog.length).toBeGreaterThan(0);
      expect(res.body.system).toBeDefined();
    });

    it("rejects non-admin requests", async () => {
      const res = await memberAgent(orgId).get("/api/admin/models");
      expect(res.status).toBe(403);
    });
  });

  // ─── POST /api/admin/models/load ────────────────────────────────────────────

  describe("POST /api/admin/models/load", () => {
    it("loads a model and sets it as active", async () => {
      const res = await adminAgent(orgId)
        .post("/api/admin/models/load")
        .send({ tag: "qwen3-4b" });
      expect(res.status).toBe(200);
      expect(res.body.loaded).toBe(true);
      expect(res.body.tag).toBe("qwen3-4b");
      expect(res.body.activeModel).toBe("qwen3-4b");
    });

    it("rejects empty tag", async () => {
      const res = await adminAgent(orgId)
        .post("/api/admin/models/load")
        .send({ tag: "" });
      expect(res.status).toBe(400);
    });

    it("returns 500 when load fails", async () => {
      const { loadModel } = await import("../services/inferenceClient.js");
      (loadModel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("OOM"));

      const res = await adminAgent(orgId)
        .post("/api/admin/models/load")
        .send({ tag: "huge-model-70b" });
      expect(res.status).toBe(500);
      expect(res.body.error).toContain("OOM");
    });
  });

  // ─── POST /api/admin/models/unload ──────────────────────────────────────────

  describe("POST /api/admin/models/unload", () => {
    it("unloads a non-active model", async () => {
      // First set a different active model so we can unload qwen
      await adminAgent(orgId)
        .put("/api/admin/models/active")
        .send({ tag: "other-model-7b" });

      const res = await adminAgent(orgId)
        .post("/api/admin/models/unload")
        .send({ tag: "qwen3-4b" });
      expect(res.status).toBe(200);
      expect(res.body.unloaded).toBe(true);
      expect(res.body.tag).toBe("qwen3-4b");
    });

    it("unloads the active model and auto-switches", async () => {
      // Set active model back
      await adminAgent(orgId)
        .put("/api/admin/models/active")
        .send({ tag: "qwen3-4b" });

      const res = await adminAgent(orgId)
        .post("/api/admin/models/unload")
        .send({ tag: "qwen3-4b" });
      expect(res.status).toBe(200);
      expect(res.body.unloaded).toBe(true);
      expect(res.body.tag).toBe("qwen3-4b");
    });
  });

  // ─── PUT /api/admin/models/active ───────────────────────────────────────────

  describe("PUT /api/admin/models/active", () => {
    it("sets the active model", async () => {
      const res = await adminAgent(orgId)
        .put("/api/admin/models/active")
        .send({ tag: "llama4-scout" });
      expect(res.status).toBe(200);
      expect(res.body.activeModel).toBe("llama4-scout");
    });

    it("rejects empty tag", async () => {
      const res = await adminAgent(orgId)
        .put("/api/admin/models/active")
        .send({ tag: "" });
      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE /api/admin/models/:tag ──────────────────────────────────────────

  describe("DELETE /api/admin/models/:tag", () => {
    it("deletes a model", async () => {
      const res = await adminAgent(orgId)
        .delete("/api/admin/models/qwen3-4b");
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);
      expect(res.body.tag).toBe("qwen3-4b");
    });

    it("prevents deleting the embedding model", async () => {
      const res = await adminAgent(orgId)
        .delete("/api/admin/models/nomic-embed-text");
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("embedding model");
    });

    it("returns 500 when delete fails", async () => {
      const { deleteModel } = await import("../services/inferenceClient.js");
      (deleteModel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Not found"));

      const res = await adminAgent(orgId)
        .delete("/api/admin/models/nonexistent-1b");
      expect(res.status).toBe(500);
    });
  });

  // ─── POST /api/admin/models/pull/cancel ─────────────────────────────────────

  describe("POST /api/admin/models/pull/cancel", () => {
    it("returns 404 when no active download exists", async () => {
      const res = await adminAgent(orgId)
        .post("/api/admin/models/pull/cancel")
        .send({ tag: "qwen3-4b" });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("No active download");
    });
  });
});
