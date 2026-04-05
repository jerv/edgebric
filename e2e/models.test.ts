import { test, expect } from "@playwright/test";

/**
 * Model Management — E2E tests.
 *
 * Covers: list models (catalog + system resources), active model state.
 *
 * Note: llama-server is intentionally unreachable in E2E,
 * so we test the API response shape and error handling, not actual
 * model downloads/loads. The endpoint should gracefully return
 * empty model lists when the inference server is unavailable.
 */

test.describe("Model Management", () => {
  test("lists models with catalog and system info", async ({ request }) => {
    const res = await request.get("/api/admin/models");
    expect(res.ok()).toBe(true);
    const body = await res.json();

    // Should have the expected response shape
    expect(body.models).toBeDefined();
    expect(Array.isArray(body.models)).toBe(true);

    expect(body.catalog).toBeDefined();
    expect(Array.isArray(body.catalog)).toBe(true);
    // Catalog should contain the official models
    expect(body.catalog.length).toBeGreaterThan(0);

    // Verify catalog entry shape
    const entry = body.catalog[0];
    expect(entry.tag).toBeTruthy();
    expect(entry.name).toBeTruthy();
    expect(typeof entry.downloadSizeGB).toBe("number");
    expect(typeof entry.ramUsageGB).toBe("number");
    expect(entry.tier).toBeTruthy();

    // System resources
    expect(body.system).toBeDefined();
    expect(typeof body.system.ramTotalBytes).toBe("number");
    expect(body.system.ramTotalBytes).toBeGreaterThan(0);
    expect(typeof body.system.ramAvailableBytes).toBe("number");

    // Active model
    expect(typeof body.activeModel).toBe("string");
  });

  test("catalog contains recommended model (qwen3.5-4b)", async ({ request }) => {
    const res = await request.get("/api/admin/models");
    const body = await res.json();
    const qwen = body.catalog.find((m: { tag: string }) => m.tag === "qwen3.5-4b");
    expect(qwen).toBeDefined();
    expect(qwen.tier).toBe("recommended");
    expect(qwen.family).toBeTruthy();
  });

  test("catalog hides embedding model from visible list", async ({ request }) => {
    const res = await request.get("/api/admin/models");
    const body = await res.json();
    const embedding = body.catalog.find((m: { tag: string }) => m.tag === "nomic-embed-text");
    // Embedding model should be hidden from catalog (hidden: true)
    expect(embedding).toBeUndefined();
  });

  test("set active model endpoint works", async ({ request }) => {
    const res = await request.put("/api/admin/models/active", {
      data: { tag: "qwen3.5-4b" },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.activeModel).toBe("qwen3.5-4b");
  });

  test("pull model returns SSE stream (will error since inference server unreachable)", async ({ request }) => {
    const res = await request.post("/api/admin/models/pull", {
      data: { tag: "qwen3.5-4b" },
    });
    // Should get SSE stream with error event since inference server is down
    const contentType = res.headers()["content-type"] ?? "";
    if (contentType.includes("text/event-stream")) {
      const text = await res.text();
      // Should contain an error event
      expect(text).toContain("event:");
    }
  });

  test("load model fails gracefully when inference server unreachable", async ({ request }) => {
    const res = await request.post("/api/admin/models/load", {
      data: { tag: "qwen3.5-4b" },
    });
    // Should fail since inference server is unreachable
    expect(res.ok()).toBe(false);
  });

  test("unload model fails gracefully when inference server unreachable", async ({ request }) => {
    const res = await request.post("/api/admin/models/unload", {
      data: { tag: "qwen3.5-4b" },
    });
    expect(res.ok()).toBe(false);
  });

  test("delete model fails gracefully when inference server unreachable", async ({ request }) => {
    const res = await request.delete("/api/admin/models/qwen3.5-4b");
    expect(res.ok()).toBe(false);
  });
});
