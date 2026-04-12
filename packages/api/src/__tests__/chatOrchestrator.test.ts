import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initDatabase } from "../db/index.js";
import { initEncryptionKey } from "../lib/crypto.js";
import { clearTools } from "../services/toolRunner.js";
import { registerKnowledgeTools } from "../services/tools/knowledge.js";
import {
  extractExplicitDocumentRequest,
  prefersGroundedKnowledge,
  prefersNaturalChat,
  generatePlanForBenchmark,
  getFastSmallTalkResponse,
  isConciseLookupQuery,
  isDirectMemoryQuery,
  normalizePlannerPayload,
  runOrchestratedChat,
} from "../services/chatOrchestrator.js";
import type { OrchestrationRequest } from "../services/chatOrchestrator.js";

function buildRequest(query: string): OrchestrationRequest {
  return {
    label: "test",
    query,
    session: {
      id: "session-1",
      createdAt: new Date(),
      messages: [{ role: "user", content: query }],
    },
    strict: false,
    collectTelemetry: true,
    allowDirectMemoryActions: true,
    allowToolPlanning: true,
    sendEvent: () => undefined,
    search: {
      datasetName: "knowledge-base",
      datasetNames: ["knowledge-base"],
      useDecompose: false,
      useRerank: false,
      useIterativeRetrieval: false,
      execute: async () => ({
        results: [],
        candidateCount: 0,
        hybridBoost: false,
        meshNodesSearched: 0,
        meshNodesUnavailable: 0,
      }),
    },
    toolContext: {
      userEmail: "user@example.com",
      isAdmin: true,
      orgId: "org-1",
      allowWeb: true,
      allowMutations: true,
    },
  };
}

describe("chatOrchestrator helpers", () => {
  beforeAll(() => {
    initEncryptionKey();
    initDatabase();
  });

  beforeEach(() => {
    clearTools();
    registerKnowledgeTools();
  });

  it("normalizes planner payload aliases into the expected schema", () => {
    const normalized = normalizePlannerPayload({
      mode: "tool_plan",
      answerStrategy: "mixed",
      tasks: [
        {
          stepId: "lookup",
          goal: "Search internal policy docs",
          action: "search_knowledge",
          input: { query: "pto carryover" },
        },
        {
          step: "web-check",
          description: "Compare with web guidance",
          function: { name: "web_search" },
          params: { query: "pto carryover california" },
          dependencies: ["lookup"],
        },
      ],
    });

    expect(normalized).toEqual({
      mode: "planned_tool_execution",
      groundingPolicy: "mixed",
      completionCriteria: "Answer every part of the user's request.",
      checklist: [
        {
          id: "lookup",
          title: "Search internal policy docs",
          tool: "search_knowledge",
          arguments: { query: "pto carryover" },
          dependsOn: [],
        },
        {
          id: "web-check",
          title: "Compare with web guidance",
          tool: "web_search",
          arguments: { query: "pto carryover california" },
          dependsOn: ["lookup"],
        },
      ],
    });
  });

  it("detects concise lookup questions", () => {
    expect(isConciseLookupQuery("What does the PTO policy say about carryover?")).toBe(true);
    expect(isConciseLookupQuery("Compare the PTO policy with the latest web guidance and explain the differences.")).toBe(false);
  });

  it("detects direct memory commands", () => {
    expect(isDirectMemoryQuery("Remember that I prefer concise answers.")).toBe(true);
    expect(isDirectMemoryQuery("Please forget blue shirts")).toBe(true);
    expect(isDirectMemoryQuery("Hello there")).toBe(false);
  });

  it("extracts explicit document save requests with the requested title", () => {
    expect(extractExplicitDocumentRequest('Save this plan as a new document called "Boats and Hoes"')).toEqual({
      title: "Boats and Hoes",
    });
  });

  it("prefers natural chat for open-ended personal and creative prompts", () => {
    expect(prefersNaturalChat("If I wanted to use this chat to create a daily journal, how would you recommend we format it?")).toBe(true);
    expect(prefersNaturalChat("Help me brainstorm a better morning routine.")).toBe(true);
    expect(prefersGroundedKnowledge("If I wanted to use this chat to create a daily journal, how would you recommend we format it?", true)).toBe(false);
  });

  it("prefers grounded knowledge for local source-shaped questions", () => {
    expect(prefersGroundedKnowledge("What does our PTO policy say about carryover?", true)).toBe(true);
    expect(prefersGroundedKnowledge("Search my docs for the onboarding checklist.", true)).toBe(true);
    expect(prefersNaturalChat("What does our PTO policy say about carryover?")).toBe(false);
  });

  it("uses deterministic planning for obvious multi-intent requests", async () => {
    const query = "Search my docs for the PTO policy, compare it with the latest web guidance, and remember that I care about California rules.";
    const { plan } = await generatePlanForBenchmark(query, buildRequest(query));

    expect(plan.mode).toBe("planned_tool_execution");
    expect(plan.checklist.map((task) => task.tool)).toEqual([
      "search_knowledge",
      "web_search",
      "save_memory",
    ]);
  });

  it("returns a fast canned response for exact small talk", async () => {
    expect(getFastSmallTalkResponse("Hello")).toBe("Hello. What do you want to work on?");

    const result = await runOrchestratedChat({
      ...buildRequest("Hello"),
      search: {
        datasetNames: [],
        useDecompose: false,
        useRerank: false,
        useIterativeRetrieval: false,
        execute: async () => ({
          results: [],
          candidateCount: 0,
          hybridBoost: false,
          meshNodesSearched: 0,
          meshNodesUnavailable: 0,
        }),
      },
    });

    expect(result.mode).toBe("direct_chat");
    expect(result.answer).toBe("Hello. What do you want to work on?");
    expect(result.toolUses).toBeUndefined();
  });

  it("turns explicit document saves into a confirmable action proposal", async () => {
    const result = await runOrchestratedChat({
      ...buildRequest('Save this plan as a new document called "Boats and Hoes"'),
      session: {
        id: "session-1",
        createdAt: new Date(),
        messages: [
          { role: "assistant", content: "Daily Diary Entry Template:\n- Date\n- Mood\n- Highlights" },
          { role: "user", content: 'Save this plan as a new document called "Boats and Hoes"' },
        ],
      },
      search: {
        datasetNames: [],
        useDecompose: false,
        useRerank: false,
        useIterativeRetrieval: false,
        execute: async () => ({
          results: [],
          candidateCount: 0,
          hybridBoost: false,
          meshNodesSearched: 0,
          meshNodesUnavailable: 0,
        }),
      },
    });

    expect(result.mode).toBe("document_action");
    expect(result.answer).toContain("Review the details below and confirm.");
    expect(result.actionProposal?.tool).toBe("save_to_vault");
    expect(result.actionProposal?.arguments).toMatchObject({
      title: "Boats and Hoes",
      content: "Daily Diary Entry Template:\n- Date\n- Mood\n- Highlights",
    });
    expect(result.executionPlan?.[0]?.tool).toBe("save_to_vault");
    expect(result.executionPlan?.[0]?.status).toBe("planned");
  });
});
