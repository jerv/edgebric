#!/usr/bin/env tsx
/**
 * Model Benchmark Runner
 *
 * Runs all benchmark questions against each recommended model via the Edgebric API.
 * Captures raw answers, latency, citations, and auto-scores for strict keywords.
 * Outputs a JSON results file for the grading UI.
 *
 * Usage:
 *   pnpm exec tsx e2e-live/benchmark/run.ts
 *   pnpm exec tsx e2e-live/benchmark/run.ts --models qwen3:4b,phi4-mini
 *   pnpm exec tsx e2e-live/benchmark/run.ts --skip-pull
 */

import fs from "fs";
import path from "path";
import { BENCHMARK_QUESTIONS, type BenchmarkQuestion } from "./questions";

const BASE_URL = process.env["EDGEBRIC_URL"] ?? "http://localhost:3001";
const OLLAMA_URL = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
const RESULTS_DIR = path.join(__dirname, "results");

// Per-question timeout in ms (2 minutes — anything longer is bad UX anyway)
const QUESTION_TIMEOUT_MS = 120_000;

// Models to benchmark (from the Edgebric catalog)
const DEFAULT_MODELS = ["phi4-mini", "gemma3:4b", "qwen3:4b", "qwen3:8b", "gemma3:12b", "qwen3:14b"];

interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

interface QueryResult {
  answer: string;
  citations: Array<{ documentName?: string; excerpt?: string }>;
  hasConfidentAnswer: boolean;
  conversationId?: string;
  contextUsage?: { usedTokens: number; maxTokens: number; truncated: boolean };
  events: SSEEvent[];
}

interface BenchmarkResult {
  questionId: string;
  question: string;
  category: string;
  groundTruth: string;
  rubric: string;
  sourceDoc: string;
  answer: string;
  latencyMs: number;
  citations: Array<{ documentName?: string; excerpt?: string }>;
  hasConfidentAnswer: boolean;
  contextUsage?: { usedTokens: number; maxTokens: number; truncated: boolean };
  // Auto-scoring
  strictKeywordsFound: string[];
  strictKeywordsMissing: string[];
  autoScore: "pass" | "fail" | "manual"; // pass = all strict keywords found, fail = none, manual = no strict keywords
}

interface ModelBenchmark {
  model: string;
  runDate: string;
  totalQuestions: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  autoPassCount: number;
  autoFailCount: number;
  manualCount: number;
  results: BenchmarkResult[];
}

export interface BenchmarkOutput {
  version: 1;
  generatedAt: string;
  dataSourceId: string;
  models: ModelBenchmark[];
}

// ─── SSE Parsing ─────────────────────────────────────────────────────────────

function parseSSE(body: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  let currentType = "";
  for (const line of body.split("\n")) {
    if (line.startsWith("event: ")) {
      currentType = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      try {
        events.push({ type: currentType, data: JSON.parse(line.slice(6)) });
      } catch { /* skip malformed */ }
    }
  }
  return events;
}

function extractAnswer(events: SSEEvent[]): QueryResult {
  const deltas = events.filter((e) => e.type === "delta" || "delta" in e.data);
  const doneEvent = events.find((e) => e.type === "done");
  const streamedAnswer = deltas.map((e) => e.data.delta as string).join("");
  const finalData = doneEvent?.data ?? {};
  return {
    answer: (finalData.answer as string) ?? (finalData.content as string) ?? streamedAnswer,
    citations: (finalData.citations as QueryResult["citations"]) ?? [],
    hasConfidentAnswer: (finalData.hasConfidentAnswer as boolean) ?? false,
    conversationId: finalData.conversationId as string | undefined,
    contextUsage: finalData.contextUsage as QueryResult["contextUsage"],
    events,
  };
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

async function createDataSource(name: string): Promise<{ id: string; datasetName: string }> {
  const res = await fetch(`${BASE_URL}/api/data-sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to create data source: ${res.status}`);
  return res.json();
}

async function uploadAndIngest(dataSourceId: string, fixtureName: string): Promise<string> {
  const filePath = path.join(__dirname, "..", "fixtures", fixtureName);
  const buffer = fs.readFileSync(filePath);
  const mimeType = fixtureName.endsWith(".pdf") ? "application/pdf" : "text/markdown";

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), fixtureName);

  const res = await fetch(`${BASE_URL}/api/data-sources/${dataSourceId}/documents/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
  const { documentId } = await res.json() as { documentId: string };

  // Poll for ingestion
  const start = Date.now();
  while (Date.now() - start < 120_000) {
    const docRes = await fetch(`${BASE_URL}/api/documents/${documentId}`);
    const doc = await docRes.json() as { status: string };
    if (doc.status === "ready") return documentId;
    if (doc.status === "failed") throw new Error(`Ingestion failed for ${fixtureName}`);
    if (doc.status === "pii_review") {
      await fetch(`${BASE_URL}/api/documents/${documentId}/approve-pii`, { method: "POST" });
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Ingestion timed out for ${fixtureName}`);
}

async function query(
  text: string,
  opts?: { conversationId?: string; dataSourceIds?: string[] },
): Promise<QueryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUESTION_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: text,
        conversationId: opts?.conversationId,
        dataSourceIds: opts?.dataSourceIds,
      }),
      signal: controller.signal,
    });
    if (res.status !== 200) throw new Error(`Query failed: ${res.status} ${await res.text()}`);

    // Stream the response to avoid buffering huge SSE bodies in memory.
    // Parse events incrementally instead of res.text().
    const events: SSEEvent[] = [];
    let currentType = "";
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep incomplete last line
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          try {
            events.push({ type: currentType, data: JSON.parse(line.slice(6)) });
          } catch { /* skip malformed */ }
        }
      }
    }
    // Process remaining buffer
    if (buffer.startsWith("data: ")) {
      try { events.push({ type: currentType, data: JSON.parse(buffer.slice(6)) }); } catch {}
    }
    return extractAnswer(events);
  } finally {
    clearTimeout(timer);
  }
}

async function setActiveModel(tag: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/admin/models/active`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag }),
  });
  if (!res.ok) console.warn(`Failed to set active model: ${await res.text()}`);
}

async function loadModel(tag: string): Promise<void> {
  console.log(`  Loading ${tag} into Ollama...`);
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    body: JSON.stringify({ model: tag, keep_alive: "30m", prompt: "" }),
  });
  if (!res.ok) throw new Error(`Failed to load model ${tag}: ${res.status}`);
  // Consume the response body
  await res.text();
  console.log(`  ${tag} loaded.`);
}

async function unloadModel(tag: string): Promise<void> {
  await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    body: JSON.stringify({ model: tag, keep_alive: "0", prompt: "" }),
  });
}

async function pullModel(tag: string): Promise<void> {
  console.log(`  Pulling ${tag}...`);
  const res = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: "POST",
    body: JSON.stringify({ name: tag }),
  });
  if (!res.ok) throw new Error(`Failed to pull ${tag}: ${res.status}`);

  // Stream progress
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let lastPct = -1;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    for (const line of text.split("\n").filter(Boolean)) {
      try {
        const data = JSON.parse(line) as { status?: string; completed?: number; total?: number };
        if (data.total && data.completed) {
          const pct = Math.round((data.completed / data.total) * 100);
          if (pct !== lastPct && pct % 10 === 0) {
            process.stdout.write(`  ${tag}: ${pct}%\n`);
            lastPct = pct;
          }
        }
      } catch { /* skip */ }
    }
  }
  console.log(`  ${tag} pulled.`);
}

async function isModelInstalled(tag: string): Promise<boolean> {
  const res = await fetch(`${OLLAMA_URL}/api/tags`);
  const { models } = await res.json() as { models: Array<{ name: string }> };
  return models.some((m) => m.name === tag || m.name === `${tag}:latest`);
}

// ─── Auto-scoring ────────────────────────────────────────────────────────────

function autoScore(q: BenchmarkQuestion, answer: string): Pick<BenchmarkResult, "strictKeywordsFound" | "strictKeywordsMissing" | "autoScore"> {
  if (q.strictKeywords.length === 0) {
    return { strictKeywordsFound: [], strictKeywordsMissing: [], autoScore: "manual" };
  }
  const lower = answer.toLowerCase();
  const found = q.strictKeywords.filter((k) => lower.includes(k.toLowerCase()));
  const missing = q.strictKeywords.filter((k) => !lower.includes(k.toLowerCase()));
  return {
    strictKeywordsFound: found,
    strictKeywordsMissing: missing,
    autoScore: found.length === q.strictKeywords.length ? "pass" : "fail",
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const skipPull = args.includes("--skip-pull");
  const modelsArg = args.find((a) => a.startsWith("--models="))?.split("=")[1];
  const models = modelsArg ? modelsArg.split(",") : DEFAULT_MODELS;

  console.log("=== Edgebric Model Benchmark ===\n");
  console.log(`Models: ${models.join(", ")}`);
  console.log(`Questions: ${BENCHMARK_QUESTIONS.length}`);
  console.log(`API: ${BASE_URL}`);
  console.log(`Ollama: ${OLLAMA_URL}\n`);

  // 1. Verify API is running
  const health = await fetch(`${BASE_URL}/api/health`);
  if (!health.ok) throw new Error(`API not reachable at ${BASE_URL}`);
  console.log("API is healthy.\n");

  // 2. Create a benchmark data source and ingest documents
  console.log("Setting up test data source...");
  const ds = await createDataSource("Benchmark Source");
  const docIds: string[] = [];
  for (const fixture of ["company-handbook.md", "it-security-policy.md"]) {
    const docId = await uploadAndIngest(ds.id, fixture);
    docIds.push(docId);
    console.log(`  Ingested ${fixture}`);
  }
  console.log();

  // 3. Pull models if needed
  if (!skipPull) {
    for (const model of models) {
      if (await isModelInstalled(model)) {
        console.log(`${model} already installed.`);
      } else {
        await pullModel(model);
      }
    }
    console.log();
  }

  // 4. Run benchmark for each model
  const allBenchmarks: ModelBenchmark[] = [];

  for (const model of models) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`BENCHMARKING: ${model}`);
    console.log(`${"=".repeat(60)}\n`);

    // Load model
    await loadModel(model);
    await setActiveModel(model);

    // Wait a moment for model to be ready
    await new Promise((r) => setTimeout(r, 2000));

    const results: BenchmarkResult[] = [];
    let totalLatency = 0;

    // Track conversation IDs for multi-turn questions
    const multiTurnConvos = new Map<string, string>(); // "multi-1" -> conversationId

    for (const q of BENCHMARK_QUESTIONS) {
      process.stdout.write(`  [${q.id}] ${q.question.slice(0, 60)}...`);

      const start = Date.now();
      try {
        // For multi-turn "b" questions, use the conversation from the "a" question
        const multiKey = q.id.replace(/[ab]$/, "");
        const isFollowUp = q.id.endsWith("b");
        const conversationId = isFollowUp ? multiTurnConvos.get(multiKey) : undefined;

        const result = await query(q.question, {
          conversationId,
          dataSourceIds: [ds.id],
        });
        const latency = Date.now() - start;
        totalLatency += latency;

        // Store conversation ID for multi-turn pairs
        if (q.id.endsWith("a") && result.conversationId) {
          multiTurnConvos.set(multiKey, result.conversationId);
        }

        const scoring = autoScore(q, result.answer);

        results.push({
          questionId: q.id,
          question: q.question,
          category: q.category,
          groundTruth: q.groundTruth,
          rubric: q.rubric,
          sourceDoc: q.sourceDoc,
          answer: result.answer,
          latencyMs: latency,
          citations: result.citations,
          hasConfidentAnswer: result.hasConfidentAnswer,
          contextUsage: result.contextUsage,
          ...scoring,
        });

        const scoreIcon = scoring.autoScore === "pass" ? "PASS" : scoring.autoScore === "fail" ? "FAIL" : "----";
        console.log(` [${scoreIcon}] ${(latency / 1000).toFixed(1)}s`);
      } catch (err) {
        const latency = Date.now() - start;
        totalLatency += latency;
        const isTimeout = (err as Error).name === "AbortError";
        const label = isTimeout ? "TIMEOUT" : "ERROR";
        const msg = isTimeout ? `Exceeded ${QUESTION_TIMEOUT_MS / 1000}s limit` : (err as Error).message;
        console.log(` [${label}] ${msg.slice(0, 60)}`);
        results.push({
          questionId: q.id,
          question: q.question,
          category: q.category,
          groundTruth: q.groundTruth,
          rubric: q.rubric,
          sourceDoc: q.sourceDoc,
          answer: `${label}: ${msg}`,
          latencyMs: latency,
          citations: [],
          hasConfidentAnswer: false,
          strictKeywordsFound: [],
          strictKeywordsMissing: q.strictKeywords,
          autoScore: "fail",
        });
      }
    }

    const autoPass = results.filter((r) => r.autoScore === "pass").length;
    const autoFail = results.filter((r) => r.autoScore === "fail").length;
    const manual = results.filter((r) => r.autoScore === "manual").length;

    allBenchmarks.push({
      model,
      runDate: new Date().toISOString(),
      totalQuestions: results.length,
      totalLatencyMs: totalLatency,
      avgLatencyMs: Math.round(totalLatency / results.length),
      autoPassCount: autoPass,
      autoFailCount: autoFail,
      manualCount: manual,
      results,
    });

    console.log(`\n  Summary for ${model}:`);
    console.log(`    Auto-pass: ${autoPass}/${results.length}`);
    console.log(`    Auto-fail: ${autoFail}/${results.length}`);
    console.log(`    Needs grading: ${manual}/${results.length}`);
    console.log(`    Avg latency: ${(totalLatency / results.length / 1000).toFixed(1)}s`);
    console.log(`    Total time: ${(totalLatency / 1000).toFixed(0)}s`);

    // Incremental save — don't lose progress if a later model crashes
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const partial: BenchmarkOutput = {
      version: 1,
      generatedAt: new Date().toISOString(),
      dataSourceId: ds.id,
      models: allBenchmarks,
    };
    fs.writeFileSync(path.join(RESULTS_DIR, "latest.json"), JSON.stringify(partial, null, 2));
    console.log(`  (incremental save: ${allBenchmarks.length} model(s) saved)`);

    // Unload model to free RAM for next one
    await unloadModel(model);
    await new Promise((r) => setTimeout(r, 3000));
  }

  // 5. Clean up test data
  console.log("\nCleaning up...");
  for (const docId of docIds) {
    await fetch(`${BASE_URL}/api/documents/${docId}`, { method: "DELETE" });
  }
  await fetch(`${BASE_URL}/api/data-sources/${ds.id}`, { method: "DELETE" });

  // 6. Save results
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const output: BenchmarkOutput = {
    version: 1,
    generatedAt: new Date().toISOString(),
    dataSourceId: ds.id,
    models: allBenchmarks,
  };

  const outPath = path.join(RESULTS_DIR, `benchmark-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${outPath}`);

  // Also save as "latest" for the grading UI
  const latestPath = path.join(RESULTS_DIR, "latest.json");
  fs.writeFileSync(latestPath, JSON.stringify(output, null, 2));
  console.log(`Symlinked to: ${latestPath}`);

  // 7. Print comparison table
  console.log("\n\n=== COMPARISON TABLE ===\n");
  const header = ["Metric", ...models];
  const rows: string[][] = [];

  rows.push(["Auto-pass", ...allBenchmarks.map((b) => `${b.autoPassCount}/${b.totalQuestions}`)]);
  rows.push(["Auto-fail", ...allBenchmarks.map((b) => `${b.autoFailCount}/${b.totalQuestions}`)]);
  rows.push(["Needs grading", ...allBenchmarks.map((b) => `${b.manualCount}/${b.totalQuestions}`)]);
  rows.push(["Avg latency", ...allBenchmarks.map((b) => `${(b.avgLatencyMs / 1000).toFixed(1)}s`)]);
  rows.push(["Total time", ...allBenchmarks.map((b) => `${(b.totalLatencyMs / 1000).toFixed(0)}s`)]);

  // Print as table
  const colWidths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const sep = colWidths.map((w) => "-".repeat(w + 2)).join("+");
  console.log(header.map((h, i) => ` ${h.padEnd(colWidths[i]!)} `).join("|"));
  console.log(sep);
  for (const row of rows) {
    console.log(row.map((c, i) => ` ${c.padEnd(colWidths[i]!)} `).join("|"));
  }

  console.log("\nOpen the grading UI to review and score results:");
  console.log("  pnpm exec tsx e2e-live/benchmark/serve-grader.ts");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
