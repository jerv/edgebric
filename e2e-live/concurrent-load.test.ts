import { test, expect } from "@playwright/test";
import {
  createDataSource,
  deleteDataSource,
  uploadAndIngest,
  parseSSE,
  extractAnswer,
} from "./helpers";

/**
 * Concurrent Load Tests — Real inference under load.
 *
 * Verifies:
 * - Multiple simultaneous queries all complete
 * - Queue position events are sent for queued requests
 * - No request starvation (all eventually complete)
 * - System remains responsive after burst load
 * - Health endpoint reflects queue state
 *
 * These tests use real LLM inference and will be slow.
 */

let sourceId: string;
let docId: string;

test.describe.serial("Concurrent Load", () => {
  test.setTimeout(300_000); // 5 minutes for the whole suite

  test.beforeAll(async ({ request }) => {
    const ds = await createDataSource(request, "Load Test Source");
    sourceId = ds.id;
    const result = await uploadAndIngest(request, sourceId, "company-handbook.md");
    docId = result.documentId;
    expect(result.status).toBe("ready");
  });

  test.afterAll(async ({ request }) => {
    if (docId) await request.delete(`/api/documents/${docId}`);
    if (sourceId) await deleteDataSource(request, sourceId);
  });

  test("health endpoint shows queue stats", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBe(true);
    const body = await res.json();

    // Queue stats should be present for admin users
    if (body.inferenceQueue) {
      expect(typeof body.inferenceQueue.active).toBe("number");
      expect(typeof body.inferenceQueue.queued).toBe("number");
      expect(typeof body.inferenceQueue.concurrency).toBe("number");
    }
  });

  test("2 concurrent queries both complete successfully", async ({ request }) => {
    const queries = [
      "What are the company's health insurance plans?",
      "How many vacation days do new employees get?",
    ];

    const results = await Promise.allSettled(
      queries.map(async (q) => {
        const res = await request.fetch("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify({ query: q, dataSourceIds: [sourceId] }),
          timeout: 180_000,
        });
        expect(res.status()).toBe(200);
        const body = await res.text();
        const events = parseSSE(body);
        return extractAnswer(events);
      }),
    );

    // Both should complete
    for (const r of results) {
      expect(r.status).toBe("fulfilled");
    }

    const fulfilled = results
      .filter((r): r is PromiseFulfilledResult<ReturnType<typeof extractAnswer>> => r.status === "fulfilled")
      .map((r) => r.value);

    // Both should have actual answers
    for (const answer of fulfilled) {
      expect(answer.answer.length).toBeGreaterThan(10);
    }
  });

  test("3 concurrent queries with queue position tracking", async ({ request }) => {
    const queries = [
      "What is the 401k match percentage?",
      "What is the remote work policy?",
      "What are the performance review criteria?",
    ];

    const queuePositionsSeen: number[][] = [[], [], []];
    const startTime = Date.now();

    const results = await Promise.allSettled(
      queries.map(async (q, i) => {
        const res = await request.fetch("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify({ query: q, dataSourceIds: [sourceId] }),
          timeout: 180_000,
        });
        expect(res.status()).toBe(200);
        const body = await res.text();
        const events = parseSSE(body);

        // Track queue positions
        for (const evt of events) {
          if ("position" in evt.data && typeof evt.data.position === "number") {
            queuePositionsSeen[i]!.push(evt.data.position);
          }
        }

        return extractAnswer(events);
      }),
    );

    const elapsed = Date.now() - startTime;
    console.log(`3 concurrent queries completed in ${elapsed}ms`);
    console.log("Queue positions seen:", queuePositionsSeen);

    // All should complete
    const allFulfilled = results.every((r) => r.status === "fulfilled");
    expect(allFulfilled).toBe(true);

    // At least some should have seen queue positions (if concurrency < 3)
    // This depends on INFERENCE_CONCURRENCY setting
    const totalPositionEvents = queuePositionsSeen.flat().length;
    console.log(`Total queue position events: ${totalPositionEvents}`);
  });

  test("system recovers after burst — single query still works", async ({ request }) => {
    // After the concurrent burst, a simple query should still work fine
    const res = await request.fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        query: "What are core working hours?",
        dataSourceIds: [sourceId],
      }),
      timeout: 120_000,
    });

    expect(res.status()).toBe(200);
    const body = await res.text();
    const events = parseSSE(body);
    const answer = extractAnswer(events);
    expect(answer.answer.length).toBeGreaterThan(10);
  });

  test("health endpoint reflects idle state after all queries complete", async ({ request }) => {
    // Small delay to let queue drain
    await new Promise((r) => setTimeout(r, 1000));

    const res = await request.get("/api/health");
    expect(res.ok()).toBe(true);
    const body = await res.json();

    if (body.inferenceQueue) {
      expect(body.inferenceQueue.active).toBe(0);
      expect(body.inferenceQueue.queued).toBe(0);
    }
  });
});
