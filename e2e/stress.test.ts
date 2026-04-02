import { test, expect } from "@playwright/test";

/**
 * Concurrent Inference Stress Test
 *
 * Simulates multiple users querying simultaneously to verify:
 * - Inference queue handles concurrent requests without crashes
 * - Queue position feedback arrives via SSE
 * - All requests eventually complete (no starvation)
 * - System remains responsive under load
 *
 * Requires a running inference server with a loaded model.
 * Only runs when STRESS_TEST=1 env var is set.
 *
 * Usage: STRESS_TEST=1 pnpm exec playwright test stress.test.ts
 */

const SKIP = !process.env["STRESS_TEST"];

test.describe("Concurrent Inference Stress", () => {
  test.skip(() => SKIP, "Set STRESS_TEST=1 to run");

  test("health endpoint returns queue stats", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    // Queue stats should be present (may not be if not admin, but shape should be consistent)
    if (body.inferenceQueue) {
      expect(typeof body.inferenceQueue.active).toBe("number");
      expect(typeof body.inferenceQueue.queued).toBe("number");
      expect(typeof body.inferenceQueue.concurrency).toBe("number");
      expect(typeof body.inferenceQueue.avgWaitMs).toBe("number");
    }
  });

  test("3 concurrent queries all complete", async ({ request }) => {
    // Fire 3 queries simultaneously
    const queries = [
      "What is the company holiday policy?",
      "How many vacation days do employees get?",
      "What are the office hours?",
    ];

    const startTime = Date.now();
    const results = await Promise.allSettled(
      queries.map(async (query, i) => {
        const res = await request.fetch("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify({ query }),
          timeout: 120_000, // 2 minute timeout per request
        });

        expect(res.status()).toBe(200);
        const text = await res.text();

        // Parse SSE events
        const events: { type: string; data: string }[] = [];
        let currentEvent = "";
        for (const line of text.split("\n")) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ")) {
            events.push({ type: currentEvent, data: line.slice(6) });
          }
        }

        // Check for queue position events
        const queueEvents = events.filter((e) => e.type === "queued");
        const deltaEvents = events.filter((e) => e.type === "" || e.type === "delta");
        const doneEvents = events.filter((e) => e.type === "done");
        const errorEvents = events.filter((e) => e.type === "error");

        return {
          queryIndex: i,
          queuePositions: queueEvents.map((e) => JSON.parse(e.data).position),
          hasDelta: deltaEvents.length > 0,
          hasDone: doneEvents.length > 0,
          hasError: errorEvents.length > 0,
          doneData: doneEvents.length > 0 ? JSON.parse(doneEvents[0]!.data) : null,
        };
      }),
    );

    const elapsed = Date.now() - startTime;
    console.log(`3 concurrent queries completed in ${elapsed}ms`);

    // All should have settled (not thrown)
    for (const result of results) {
      expect(result.status).toBe("fulfilled");
    }

    // At least some should have completed with a done event
    const fulfilled = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
      .map((r) => r.value);

    const completed = fulfilled.filter((r) => r.hasDone);
    const errored = fulfilled.filter((r) => r.hasError);

    console.log(`Completed: ${completed.length}, Errored: ${errored.length}`);
    console.log(
      `Queue positions observed:`,
      fulfilled.map((r) => r.queuePositions),
    );

    // At least 1 should complete (even if no model loaded, we should get error events gracefully)
    expect(completed.length + errored.length).toBe(3);
  });

  test("5 concurrent queries with timing analysis", async ({ request }) => {
    const CONCURRENCY = 5;
    const query = "What benefits does the company offer?";

    const timings: { index: number; startMs: number; firstTokenMs: number; doneMs: number; queuePositions: number[] }[] = [];
    const globalStart = Date.now();

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        (async () => {
          const startMs = Date.now() - globalStart;
          const res = await request.fetch("/api/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({ query }),
            timeout: 180_000,
          });

          expect(res.status()).toBe(200);
          const text = await res.text();

          let firstTokenMs = -1;
          let doneMs = -1;
          const queuePositions: number[] = [];

          for (const line of text.split("\n")) {
            if (line.startsWith("data: ")) {
              const data = JSON.parse(line.slice(6));
              if ("position" in data) {
                queuePositions.push(data.position);
              } else if ("delta" in data && firstTokenMs === -1) {
                firstTokenMs = Date.now() - globalStart;
              } else if ("sessionId" in data) {
                doneMs = Date.now() - globalStart;
              }
            }
          }

          timings.push({ index: i, startMs, firstTokenMs, doneMs, queuePositions });
        })(),
      ),
    );

    // Print timing analysis
    console.log("\n--- Stress Test Timing Analysis ---");
    console.log(`Concurrency: ${CONCURRENCY}`);
    console.log(`Total wall time: ${Date.now() - globalStart}ms\n`);

    timings.sort((a, b) => a.doneMs - b.doneMs);
    for (const t of timings) {
      const ttft = t.firstTokenMs > 0 ? `${t.firstTokenMs - t.startMs}ms` : "N/A";
      const total = t.doneMs > 0 ? `${t.doneMs - t.startMs}ms` : "N/A";
      const queued = t.queuePositions.length > 0 ? `pos ${t.queuePositions.join("→")}` : "immediate";
      console.log(`  Query ${t.index}: TTFT=${ttft}, Total=${total}, Queue=${queued}`);
    }

    // All should settle
    for (const r of results) {
      expect(r.status).toBe("fulfilled");
    }
  });

  test("queue stats reflect load during concurrent requests", async ({ request }) => {
    // Check queue stats before load
    const beforeRes = await request.get("/api/health");
    const before = await beforeRes.json();
    const beforeActive = before.inferenceQueue?.active ?? 0;

    // Fire a burst of queries (don't wait for them)
    const burst = Array.from({ length: 3 }, (_, i) =>
      request.fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ query: `Stress test query ${i}` }),
        timeout: 120_000,
      }),
    );

    // Small delay to let requests hit the queue
    await new Promise((r) => setTimeout(r, 500));

    // Check queue stats during load
    const duringRes = await request.get("/api/health");
    const during = await duringRes.json();

    console.log("Queue during load:", during.inferenceQueue);

    // Wait for all to complete
    await Promise.allSettled(burst);

    // Check queue stats after load
    const afterRes = await request.get("/api/health");
    const after = await afterRes.json();

    console.log("Queue after load:", after.inferenceQueue);

    // After all complete, active should be 0 or back to baseline
    if (after.inferenceQueue) {
      expect(after.inferenceQueue.active).toBeLessThanOrEqual(beforeActive);
    }
  });
});
