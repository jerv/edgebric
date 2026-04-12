import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { MODEL_CATALOG_MAP } from "@edgebric/types";
import type {
  OrchestrationMode,
  OrchestrationResult,
  OrchestrationRequest,
  SearchExecutionResult,
} from "../services/chatOrchestrator.js";
import type { Session } from "@edgebric/types";

interface BenchmarkCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

interface BenchmarkRecord {
  scenarioId: string;
  label: string;
  kind: "orchestrated" | "planning";
  iteration: number;
  mode: OrchestrationMode;
  model: string;
  support: string;
  totalMs: number;
  firstTokenMs?: number;
  firstProgressMs?: number;
  planningMs?: number;
  retrievalMs?: number;
  toolExecutionMs?: number;
  checklistCount: number;
  toolUseCount: number;
  checks: BenchmarkCheck[];
  passed: boolean;
  answerPreview?: string;
  tools?: string[];
  missingExpectedTools?: string[];
}

interface BenchmarkRun {
  generatedAt: string;
  label?: string;
  model: string;
  support: string;
  dataDir: string;
  iterations: number;
  warmup: boolean;
  git?: { branch?: string; commit?: string };
  records: BenchmarkRecord[];
}

type BenchmarkTransport = "auto" | "local" | "api";

interface BenchmarkScenarioContext {
  iteration: number;
  orgId: string;
  userEmail: string;
  label: string;
}

interface OrchestratedScenario {
  id: string;
  label: string;
  kind: "orchestrated";
  buildRequest(ctx: BenchmarkScenarioContext): Promise<OrchestrationRequest>;
  evaluate(result: OrchestrationResult): BenchmarkCheck[];
  cleanup?(ctx: BenchmarkScenarioContext): Promise<void>;
}

interface PlanningScenario {
  id: string;
  label: string;
  kind: "planning";
  build(ctx: BenchmarkScenarioContext): Promise<{ query: string; request: OrchestrationRequest; expectedTools: string[] }>;
  cleanup?(ctx: BenchmarkScenarioContext): Promise<void>;
}

type BenchmarkScenario = OrchestratedScenario | PlanningScenario;

interface RuntimeDeps {
  runtimeChatConfig: { model: string };
  isRunning: () => Promise<boolean>;
  runOrchestratedChat: (req: OrchestrationRequest) => Promise<OrchestrationResult>;
  generatePlanForBenchmark: (
    query: string,
    req: OrchestrationRequest,
  ) => Promise<{
    plan: {
      mode: OrchestrationMode;
      checklist: Array<{ tool: string }>;
      completionCriteria: string;
    };
    planningMs: number;
  }>;
  registerAllTools: () => void;
  deleteMemory: (memoryId: string, orgId: string, userId: string) => boolean;
  listMemories: (orgId: string, userId: string) => Array<{ id: string }>;
}

let runtimeDepsPromise: Promise<RuntimeDeps> | undefined;
let benchmarkDataDir: string | undefined;

function ensureBenchmarkEnvDefaults(): void {
  process.env["AUTH_MODE"] ??= "none";
  if (!process.env["DATA_DIR"]) {
    benchmarkDataDir ??= fs.mkdtempSync(path.join(os.tmpdir(), "edgebric-benchmark-"));
    process.env["DATA_DIR"] = benchmarkDataDir;
  }
}

async function loadRuntimeDeps(): Promise<RuntimeDeps> {
  ensureBenchmarkEnvDefaults();
  if (!runtimeDepsPromise) {
    runtimeDepsPromise = Promise.all([
      import("../lib/crypto.js"),
      import("../db/index.js"),
      import("../config.js"),
      import("../services/inferenceClient.js"),
      import("../services/chatOrchestrator.js"),
      import("../services/tools/index.js"),
      import("../services/memoryStore.js"),
    ]).then(([crypto, db, config, inferenceClient, chatOrchestrator, toolIndex, memoryStore]) => {
      crypto.initEncryptionKey();
      db.initDatabase();
      return {
      runtimeChatConfig: config.runtimeChatConfig,
      isRunning: inferenceClient.isRunning,
      runOrchestratedChat: chatOrchestrator.runOrchestratedChat,
      generatePlanForBenchmark: chatOrchestrator.generatePlanForBenchmark,
      registerAllTools: toolIndex.registerAllTools,
      deleteMemory: memoryStore.deleteMemory,
      listMemories: memoryStore.listMemories,
      };
    });
  }

  return runtimeDepsPromise;
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
      continue;
    }
    args.set(key, next);
    i += 1;
  }

  return {
    iterations: Math.max(1, Number(args.get("iterations") ?? "1")),
    out: typeof args.get("out") === "string" ? String(args.get("out")) : undefined,
    label: typeof args.get("label") === "string" ? String(args.get("label")) : undefined,
    strict: args.get("strict") === true,
    warmup: args.get("no-warmup") !== true,
    transport: typeof args.get("transport") === "string" ? String(args.get("transport")) as BenchmarkTransport : "auto",
  };
}

function createSession(query: string): Session {
  return {
    id: randomUUID(),
    createdAt: new Date(),
    messages: [{ role: "user", content: query }],
  };
}

function syntheticSearchResults(query: string): SearchExecutionResult {
  return {
    candidateCount: 3,
    hybridBoost: true,
    results: [
      {
        chunkId: "benchmark-policy-1",
        chunk: `PTO policy benchmark context for query "${query}". Employees may carry over up to 40 hours of unused PTO into the next calendar year. Additional carryover requires manager approval.`,
        similarity: 0.92,
        metadata: {
          sourceDocument: "benchmark-policy-doc",
          documentName: "Employee Handbook",
          sectionPath: ["Policies", "PTO"],
          pageNumber: 14,
          heading: "Paid Time Off",
          chunkIndex: 0,
          parentContent: "Paid time off policy and carryover details.",
        },
      },
      {
        chunkId: "benchmark-policy-2",
        chunk: "California employees follow the same carryover baseline, but payroll closes on January 5 and exceptions are reviewed manually.",
        similarity: 0.88,
        metadata: {
          sourceDocument: "benchmark-policy-doc",
          documentName: "Employee Handbook",
          sectionPath: ["Policies", "PTO", "California"],
          pageNumber: 15,
          heading: "California Notes",
          chunkIndex: 1,
        },
      },
    ],
    meshNodesSearched: 0,
    meshNodesUnavailable: 0,
  };
}

function noopEvent(): void {
  // Intentionally empty. The orchestrator still records timing for the first emitted event.
}

function allChecksPassed(checks: BenchmarkCheck[]): boolean {
  return checks.every((check) => check.passed);
}

function coverageChecks(expectedTools: string[], actualTools: string[]): BenchmarkCheck[] {
  const actual = new Set(actualTools);
  return expectedTools.map((tool) => (
    actual.has(tool)
      ? {
          name: `planner includes ${tool}`,
          passed: true,
        }
      : {
          name: `planner includes ${tool}`,
          passed: false,
          detail: `Missing expected tool ${tool}`,
        }
  ));
}

function trimPreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
}

function aggregate(records: BenchmarkRecord[]) {
  const groups = new Map<string, BenchmarkRecord[]>();
  for (const record of records) {
    const arr = groups.get(record.scenarioId) ?? [];
    arr.push(record);
    groups.set(record.scenarioId, arr);
  }

  return [...groups.entries()].map(([scenarioId, items]) => {
    const avg = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    const totalMs = avg(items.map((item) => item.totalMs));
    const firstTokenValues = items.map((item) => item.firstTokenMs).filter((value): value is number => value != null);
    const planningValues = items.map((item) => item.planningMs).filter((value): value is number => value != null);
    return {
      scenarioId,
      label: items[0]!.label,
      mode: items[0]!.mode,
      passed: items.every((item) => item.passed),
      totalMs,
      firstTokenMs: firstTokenValues.length > 0 ? avg(firstTokenValues) : undefined,
      planningMs: planningValues.length > 0 ? avg(planningValues) : undefined,
      checklistCount: avg(items.map((item) => item.checklistCount)),
      toolUseCount: avg(items.map((item) => item.toolUseCount)),
      failures: items.flatMap((item) => item.checks.filter((check) => !check.passed).map((check) => check.name)),
    };
  });
}

function formatSummary(run: BenchmarkRun): string {
  const rows = aggregate(run.records);
  const header = [
    "Scenario".padEnd(28),
    "Mode".padEnd(22),
    "Avg Total".padEnd(10),
    "1st Token".padEnd(10),
    "Plan".padEnd(8),
    "Checks",
  ].join(" | ");
  const divider = "-".repeat(header.length);
  const body = rows.map((row) => [
    row.label.slice(0, 28).padEnd(28),
    row.mode.padEnd(22),
    `${row.totalMs}ms`.padEnd(10),
    `${row.firstTokenMs ?? "-"}`.padEnd(10),
    `${row.planningMs ?? "-"}`.padEnd(8),
    row.passed ? "pass" : `fail (${row.failures.join(", ")})`,
  ].join(" | "));

  return [
    `Model: ${run.model} (${run.support})`,
    `Generated: ${run.generatedAt}`,
    "",
    header,
    divider,
    ...body,
  ].join("\n");
}

function gitMeta(): { branch?: string; commit?: string } {
  try {
    return {
      branch: execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim(),
      commit: execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(),
    };
  } catch {
    return {};
  }
}

function desktopDataDir(): string {
  return path.join(os.homedir(), "Edgebric");
}

function seedInferenceKeysFromRunningServer(): void {
  if (process.env["CHAT_API_KEY"] && process.env["EMBEDDING_API_KEY"]) return;

  const pidFile = path.join(desktopDataDir(), ".edgebric.pid");
  if (!fs.existsSync(pidFile)) return;

  const pid = fs.readFileSync(pidFile, "utf8").trim();
  if (!pid) return;

  try {
    const proc = execSync(`ps eww -p ${pid}`, { encoding: "utf8" });
    const chatKey = proc.match(/\bCHAT_API_KEY=([^\s]+)/)?.[1];
    const embeddingKey = proc.match(/\bEMBEDDING_API_KEY=([^\s]+)/)?.[1];
    if (chatKey) process.env["CHAT_API_KEY"] ??= chatKey;
    if (embeddingKey) process.env["EMBEDDING_API_KEY"] ??= embeddingKey;
  } catch {
    // If process inspection fails, fall back to explicit env vars or API proxy mode.
  }
}

function detectApiBaseUrl(): string {
  if (process.env["FRONTEND_URL"]) return process.env["FRONTEND_URL"];

  const desktopEnvPath = path.join(desktopDataDir(), ".env");
  if (fs.existsSync(desktopEnvPath)) {
    const envContent = fs.readFileSync(desktopEnvPath, "utf8");
    const frontendMatch = envContent.match(/^FRONTEND_URL=(.+)$/m);
    if (frontendMatch?.[1]) return frontendMatch[1].trim();
    const portMatch = envContent.match(/^PORT=(\d+)$/m);
    if (portMatch?.[1]) return `http://127.0.0.1:${portMatch[1]}`;
  }

  const desktopConfigPath = path.join(desktopDataDir(), ".edgebric.json");
  if (fs.existsSync(desktopConfigPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(desktopConfigPath, "utf8")) as { port?: number };
      if (parsed.port) return `http://127.0.0.1:${parsed.port}`;
    } catch {
      // Ignore malformed local config and fall back to the default port.
    }
  }

  return "http://127.0.0.1:3001";
}

async function runViaApiServer(options?: {
  iterations?: number;
  label?: string;
  warmup?: boolean;
}): Promise<BenchmarkRun> {
  const params = new URLSearchParams();
  if (options?.iterations != null) params.set("iterations", String(options.iterations));
  if (options?.label) params.set("label", options.label);
  if (options?.warmup != null) params.set("warmup", options.warmup ? "true" : "false");

  const baseUrl = detectApiBaseUrl().replace(/\/$/, "");
  const url = `${baseUrl}/api/admin/benchmarks/chat${params.size > 0 ? `?${params.toString()}` : ""}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Benchmark API request failed (${response.status}) at ${url}: ${body || response.statusText}`,
    );
  }

  return await response.json() as BenchmarkRun;
}

async function cleanupBenchmarkMemories(orgId: string, userEmail: string): Promise<void> {
  const { deleteMemory, listMemories } = await loadRuntimeDeps();
  const memories = listMemories(orgId, userEmail);
  for (const memory of memories) {
    deleteMemory(memory.id, orgId, userEmail);
  }
}

const scenarios: BenchmarkScenario[] = [
  {
    id: "simple_greeting",
    label: "Simple Greeting",
    kind: "orchestrated",
    async buildRequest(ctx) {
      const query = "Hello";
      return {
        label: `${ctx.label}-simple-greeting`,
        query,
        session: createSession(query),
        strict: false,
        collectTelemetry: true,
        allowDirectMemoryActions: true,
        allowToolPlanning: true,
        sendEvent: noopEvent,
        search: {
          datasetNames: [],
          useDecompose: false,
          useRerank: false,
          useIterativeRetrieval: false,
          execute: async () => ({ results: [], candidateCount: 0, hybridBoost: false, meshNodesSearched: 0, meshNodesUnavailable: 0 }),
        },
        toolContext: {
          userEmail: ctx.userEmail,
          isAdmin: true,
          orgId: ctx.orgId,
          allowWeb: false,
          allowMutations: true,
        },
      };
    },
    evaluate(result) {
      return [
        { name: "mode is direct_chat", passed: result.mode === "direct_chat" },
        { name: "answer is non-empty", passed: result.answer.trim().length > 0 },
        { name: "no tool uses", passed: (result.toolUses?.length ?? 0) === 0 },
      ];
    },
  },
  {
    id: "memory_save",
    label: "Save Memory",
    kind: "orchestrated",
    async buildRequest(ctx) {
      const query = "Remember that I prefer concise answers when summarizing policies.";
      return {
        label: `${ctx.label}-memory-save`,
        query,
        session: createSession(query),
        strict: false,
        collectTelemetry: true,
        allowDirectMemoryActions: true,
        allowToolPlanning: true,
        sendEvent: noopEvent,
        search: {
          datasetNames: [],
          useDecompose: false,
          useRerank: false,
          useIterativeRetrieval: false,
          execute: async () => ({ results: [], candidateCount: 0, hybridBoost: false, meshNodesSearched: 0, meshNodesUnavailable: 0 }),
        },
        toolContext: {
          userEmail: ctx.userEmail,
          isAdmin: true,
          orgId: ctx.orgId,
          allowWeb: false,
          allowMutations: true,
        },
      };
    },
    evaluate(result) {
      return [
        { name: "mode is memory_action", passed: result.mode === "memory_action" },
        { name: "execution plan completed", passed: result.executionPlan?.some((step) => step.status === "completed") === true },
        { name: "assistant confirms memory save", passed: /remember/i.test(result.answer) },
      ];
    },
    async cleanup(ctx) {
      await cleanupBenchmarkMemories(ctx.orgId, ctx.userEmail);
    },
  },
  {
    id: "rag_policy_lookup",
    label: "Grounded Policy Lookup",
    kind: "orchestrated",
    async buildRequest(ctx) {
      const query = "What does the PTO policy say about carryover?";
      return {
        label: `${ctx.label}-rag-policy`,
        query,
        session: createSession(query),
        strict: true,
        collectTelemetry: true,
        allowDirectMemoryActions: true,
        allowToolPlanning: true,
        sendEvent: noopEvent,
        search: {
          datasetName: "benchmark-policy",
          datasetNames: ["benchmark-policy"],
          useDecompose: false,
          useRerank: false,
          useIterativeRetrieval: false,
          execute: async (searchQuery) => syntheticSearchResults(searchQuery),
        },
        toolContext: {
          userEmail: ctx.userEmail,
          isAdmin: true,
          orgId: ctx.orgId,
          allowWeb: false,
          allowMutations: true,
        },
      };
    },
    evaluate(result) {
      return [
        { name: "mode is rag_answer", passed: result.mode === "rag_answer" },
        { name: "answer is non-empty", passed: result.answer.trim().length > 0 },
        { name: "search results were used", passed: (result.searchResults?.length ?? 0) > 0 },
      ];
    },
  },
  {
    id: "planner_multi_intent",
    label: "Planner Multi-Intent Coverage",
    kind: "planning",
    async build(ctx) {
      const query = "Search my docs for the PTO policy, compare it with the latest web guidance, and remember that I care about California rules.";
      return {
        query,
        expectedTools: ["search_knowledge", "web_search", "save_memory"],
        request: {
          label: `${ctx.label}-planner-multi-intent`,
          query,
          session: createSession(query),
          strict: false,
          collectTelemetry: true,
          allowDirectMemoryActions: false,
          allowToolPlanning: true,
          sendEvent: noopEvent,
          search: {
            datasetName: "benchmark-policy",
            datasetNames: ["benchmark-policy"],
            useDecompose: false,
            useRerank: false,
            useIterativeRetrieval: false,
            execute: async (searchQuery) => syntheticSearchResults(searchQuery),
          },
          toolContext: {
            userEmail: ctx.userEmail,
            isAdmin: true,
            orgId: ctx.orgId,
            allowWeb: true,
            allowMutations: true,
          },
        },
      };
    },
  },
];

async function maybeWarmup(): Promise<void> {
  const { runOrchestratedChat } = await loadRuntimeDeps();
  const query = "Hello";
  await runOrchestratedChat({
    label: "benchmark-warmup",
    query,
    session: createSession(query),
    strict: false,
    allowDirectMemoryActions: true,
    allowToolPlanning: true,
    sendEvent: noopEvent,
    search: {
      datasetNames: [],
      useDecompose: false,
      useRerank: false,
      useIterativeRetrieval: false,
      execute: async () => ({ results: [], candidateCount: 0, hybridBoost: false, meshNodesSearched: 0, meshNodesUnavailable: 0 }),
    },
    toolContext: {
      userEmail: "benchmark-warmup@local",
      isAdmin: true,
      orgId: "benchmark-warmup-org",
      allowWeb: false,
      allowMutations: false,
    },
  });
}

async function runScenario(scenario: BenchmarkScenario, iteration: number): Promise<BenchmarkRecord> {
  const { generatePlanForBenchmark, runOrchestratedChat, runtimeChatConfig } = await loadRuntimeDeps();
  const ctx: BenchmarkScenarioContext = {
    iteration,
    orgId: `benchmark-org-${scenario.id}-${iteration}`,
    userEmail: `benchmark-${scenario.id}-${iteration}@local`,
    label: `benchmark-${scenario.id}-${iteration}`,
  };

  if (scenario.kind === "orchestrated") {
    try {
      const request = await scenario.buildRequest(ctx);
      const result = await runOrchestratedChat(request);
      const checks = scenario.evaluate(result);
      const telemetry = result.telemetry;
      return {
        scenarioId: scenario.id,
        label: scenario.label,
        kind: scenario.kind,
        iteration,
        mode: result.mode ?? "direct_chat",
        model: runtimeChatConfig.model,
        support: MODEL_CATALOG_MAP.get(runtimeChatConfig.model)?.support ?? "community",
        totalMs: telemetry?.totalMs ?? 0,
        ...(telemetry?.firstTokenMs != null ? { firstTokenMs: telemetry.firstTokenMs } : {}),
        ...(telemetry?.firstProgressMs != null ? { firstProgressMs: telemetry.firstProgressMs } : {}),
        ...(telemetry?.planningMs != null ? { planningMs: telemetry.planningMs } : {}),
        ...(telemetry?.retrievalMs != null ? { retrievalMs: telemetry.retrievalMs } : {}),
        ...(telemetry?.toolExecutionMs != null ? { toolExecutionMs: telemetry.toolExecutionMs } : {}),
        checklistCount: result.executionPlan?.length ?? 0,
        toolUseCount: result.toolUses?.length ?? 0,
        checks,
        passed: allChecksPassed(checks),
        ...(result.answer.trim().length > 0 ? { answerPreview: trimPreview(result.answer) } : {}),
        ...((result.toolUses?.length ?? 0) > 0 ? { tools: result.toolUses!.map((tool) => tool.name) } : {}),
      };
    } finally {
      await scenario.cleanup?.(ctx);
    }
  }

  try {
    const { query, request, expectedTools } = await scenario.build(ctx);
    const { plan, planningMs } = await generatePlanForBenchmark(query, request);
    const actualTools = plan.checklist.map((step) => step.tool);
    const checks = [
      { name: "planner selected planned execution", passed: plan.mode === "planned_tool_execution", detail: `mode=${plan.mode}` },
      { name: "planner produced checklist", passed: plan.checklist.length > 0, detail: `checklist=${plan.checklist.length}` },
      ...coverageChecks(expectedTools, actualTools),
    ];
    const missingExpectedTools = expectedTools.filter((tool) => !actualTools.includes(tool));
    return {
      scenarioId: scenario.id,
      label: scenario.label,
      kind: scenario.kind,
      iteration,
      mode: plan.mode,
      model: runtimeChatConfig.model,
      support: MODEL_CATALOG_MAP.get(runtimeChatConfig.model)?.support ?? "community",
      totalMs: planningMs,
      planningMs,
      checklistCount: plan.checklist.length,
      toolUseCount: 0,
      checks,
      passed: allChecksPassed(checks),
      answerPreview: trimPreview(plan.completionCriteria),
      tools: actualTools,
      missingExpectedTools,
    };
  } finally {
    await scenario.cleanup?.(ctx);
  }
}

export async function runChatBenchmarks(options?: {
  iterations?: number;
  label?: string;
  warmup?: boolean;
  transport?: BenchmarkTransport;
}): Promise<BenchmarkRun> {
  const transport = options?.transport ?? "auto";
  seedInferenceKeysFromRunningServer();
  const hasDirectChatKey = Boolean(process.env["CHAT_API_KEY"]);

  if (transport !== "local" && !hasDirectChatKey) {
    try {
      return await runViaApiServer(options);
    } catch (err) {
      if (transport === "api") throw err;
    }
  }

  const { isRunning, registerAllTools, runtimeChatConfig } = await loadRuntimeDeps();
  const iterations = options?.iterations ?? 1;
  const warmup = options?.warmup ?? true;

  registerAllTools();

  const ready = await isRunning();
  if (!ready) {
    throw new Error("The chat inference server is not running. Load a model in Edgebric before benchmarking.");
  }

  if (warmup) {
    await maybeWarmup();
  }

  const records: BenchmarkRecord[] = [];
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    for (const scenario of scenarios) {
      records.push(await runScenario(scenario, iteration));
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    ...(options?.label ? { label: options.label } : {}),
    model: runtimeChatConfig.model,
    support: MODEL_CATALOG_MAP.get(runtimeChatConfig.model)?.support ?? "community",
    dataDir: process.env["DATA_DIR"] ?? "",
    iterations,
    warmup,
    git: gitMeta(),
    records,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const run = await runChatBenchmarks({
    iterations: args.iterations,
    ...(args.label ? { label: args.label } : {}),
    warmup: args.warmup,
    transport: args.transport,
  });

  const defaultDir = path.join(process.cwd(), "benchmark-results");
  const outPath = args.out ?? path.join(defaultDir, `chat-benchmark-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(run, null, 2));

  const summary = formatSummary(run);
  process.stdout.write(`${summary}\n\nSaved JSON results to ${outPath}\n`);

  if (args.strict && run.records.some((record) => !record.passed)) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
