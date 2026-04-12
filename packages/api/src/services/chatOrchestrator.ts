import { answerStream, buildGeneralPrompt } from "@edgebric/core/rag";
import type { Message } from "@edgebric/core/rag";
import { randomUUID } from "crypto";
import type { AnswerResponse, Citation, ChatActionField, ChatActionProposal, ExecutionChecklistItem, Session, ToolUseRecord } from "@edgebric/types";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { createChatClient } from "./chatClient.js";
import { executeTool, getToolExecutionMetadata, listTools } from "./toolRunner.js";
import type { ToolContext } from "./toolRunner.js";
import { extractExplicitMemoryRequest } from "./memoryExtractor.js";
import { deleteMemory, isMemoryEnabled, listMemories, saveMemory, updateMemory } from "./memoryStore.js";

const chatClient = createChatClient();

export type OrchestrationMode = "direct_chat" | "memory_action" | "document_action" | "rag_answer" | "planned_tool_execution";

export interface SearchExecutionResult {
  results: Array<{
    chunkId: string;
    chunk: string;
    similarity: number;
    metadata: {
      sourceDocument: string;
      documentName?: string;
      sectionPath: string[];
      pageNumber: number;
      heading: string;
      chunkIndex: number;
      parentContent?: string;
    };
    sourceNodeId?: string;
    sourceNodeName?: string;
  }>;
  candidateCount: number;
  hybridBoost: boolean;
  meshNodesSearched?: number;
  meshNodesUnavailable?: number;
}

export interface OrchestrationRequest {
  label: string;
  query: string;
  session: Session;
  strict: boolean;
  skipSearch?: boolean;
  allowDirectMemoryActions?: boolean;
  collectTelemetry?: boolean;
  memoryContextBlock?: string;
  allowToolPlanning: boolean;
  sendEvent: (event: string, data: unknown) => void;
  search: {
    datasetName?: string;
    datasetNames: string[];
    useDecompose: boolean;
    useRerank: boolean;
    useIterativeRetrieval: boolean;
    execute(query: string): Promise<SearchExecutionResult>;
  };
  toolContext: ToolContext;
}

export interface OrchestrationTelemetry {
  classificationMs: number;
  planningMs: number;
  retrievalMs: number;
  toolExecutionMs: number;
  firstProgressMs: number;
  firstTokenMs: number;
  totalMs: number;
}

export interface OrchestrationResult {
  answer: string;
  citations: AnswerResponse["citations"];
  hasConfidentAnswer: boolean;
  answerType: AnswerResponse["answerType"];
  toolUses?: ToolUseRecord[];
  executionPlan?: ExecutionChecklistItem[];
  contextUsage?: AnswerResponse["contextUsage"];
  retrievalScore?: number;
  meshNodesSearched?: number;
  meshNodesUnavailable?: number;
  searchResults?: SearchExecutionResult["results"];
  mode?: OrchestrationMode;
  telemetry?: OrchestrationTelemetry;
  actionProposal?: ChatActionProposal;
}

interface PlannedTask {
  id: string;
  title: string;
  tool: string;
  arguments: Record<string, unknown>;
  dependsOn: string[];
}

interface ParsedPlan {
  mode: OrchestrationMode;
  groundingPolicy: "grounded" | "general" | "mixed";
  completionCriteria: string;
  checklist: PlannedTask[];
}

const plannerSchema = z.object({
  mode: z.enum(["direct_chat", "memory_action", "document_action", "rag_answer", "planned_tool_execution", "tool_plan"]).default("planned_tool_execution"),
  groundingPolicy: z.enum(["grounded", "general", "mixed"]).default("mixed"),
  completionCriteria: z.string().min(1).default("Answer every part of the user's request."),
  checklist: z.array(z.object({
    id: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    tool: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()).default({}),
    dependsOn: z.array(z.string()).default([]),
  })).default([]),
});

const SMALL_TALK = new Set([
  "hi",
  "hello",
  "hey",
  "hey there",
  "yo",
  "good morning",
  "good afternoon",
  "good evening",
  "thanks",
  "thank you",
  "ok",
  "okay",
  "cool",
  "sounds good",
  "who are you",
  "what can you do",
  "help",
]);

const LIST_MEMORY_RE = /\b(?:what|which|show|list).*(?:remember|memories)\b/i;
const DELETE_MEMORY_RE = /^(?:please\s+)?forget(?:\s+about)?\s+(.{3,200})$/i;
const UPDATE_MEMORY_RE = /^(?:please\s+)?update\s+memory\s+(.{3,120})\s+to\s+(.{3,200})$/i;
const EMBEDDED_REMEMBER_RE = /\bremember(?:\s+that)?\s+(.{3,200})/i;
const SAVE_DOCUMENT_RE = /\b(?:save|store|turn)\s+(?:this|that|the last|the previous|your last|your previous)?\s*(?:plan|answer|response|reply|message|note|entry|template|draft)?\s*(?:as|into)?\s*(?:a\s+)?(?:new\s+)?(?:document|note|file)\b/i;
const SAVE_DOCUMENT_TITLE_RE = /\b(?:called|named|titled)\s*(?:["“”']([^"“”'\n]{1,160})["“”']|(.{1,160}))$/i;
const CREATE_SOURCE_RE = /\bcreate\s+(?:a\s+)?(?:new\s+)?(?:data\s+source|source)\s+(?:called|named)?\s*(?:["“”']([^"“”'\n]{1,160})["“”']|([a-z0-9 _.-]{2,160}))\b/i;
const RENAME_SOURCE_RE = /\brename\s+(?:the\s+)?(?:data\s+source|source)\s+["“”']?([^"“”'\n]+?)["“”']?\s+to\s+["“”']?([^"“”'\n]+?)["“”']?$/i;
const DELETE_SOURCE_RE = /\bdelete\s+(?:the\s+)?(?:data\s+source|source)\s+["“”']?([^"“”'\n]+?)["“”']?$/i;
const RENAME_DOCUMENT_RE = /\brename\s+(?:the\s+)?(?:document|file|note)\s+["“”']?([^"“”'\n]+?)["“”']?\s+to\s+["“”']?([^"“”'\n]+?)["“”']?$/i;
const DELETE_DOCUMENT_RE = /\bdelete\s+(?:the\s+)?(?:document|file|note)\s+["“”']?([^"“”'\n]+?)["“”']?$/i;
const SOURCE_SCOPE_RE = /\b(?:in|from|on)\s+(?:data\s+source|source)\s+["“”']?([^"“”'\n]+?)["“”']?$/i;
const RESTRICT_SOURCE_RE = /\b(?:make|set)\s+(?:the\s+)?(?:data\s+source|source)\s+["“”']?([^"“”'\n]+?)["“”']?\s+(?:to\s+be\s+)?restricted(?:\s+to\s+(.+))?$/i;
const OPEN_SOURCE_RE = /\b(?:make|set)\s+(?:the\s+)?(?:data\s+source|source)\s+["“”']?([^"“”'\n]+?)["“”']?\s+(?:available\s+to\s+everyone|open|shared\s+with\s+(?:everyone|the whole org|the organization)|whole\s+org)$/i;
const SOURCE_VIEWING_RE = /\b(?:turn|set)\s+(on|off|enable|disable)\s+(?:raw\s+)?source\s+viewing\s+(?:for|on)\s+(?:the\s+)?(?:data\s+source|source)\s+["“”']?([^"“”'\n]+?)["“”']?$/i;
const VAULT_SYNC_RE = /\b(?:turn|set)\s+(on|off|enable|disable)\s+vault\s+sync\s+(?:for|on)\s+(?:the\s+)?(?:data\s+source|source)\s+["“”']?([^"“”'\n]+?)["“”']?$/i;
const PII_MODE_RE = /\bset\s+pii\s+mode\s+(?:for|on)\s+(?:the\s+)?(?:data\s+source|source)\s+["“”']?([^"“”'\n]+?)["“”']?\s+to\s+(off|warn|block)$/i;
const DEEP_DETAIL_RE = /\b(compare|versus|vs\.?|why|how|explain|analy[sz]e|walk me through|step[- ]by[- ]step|detailed?|in depth|all the|every|pros and cons)\b/i;
const SIMPLE_LOOKUP_RE = /^(?:what|which|when|where|who)\b/i;
const DOC_SEARCH_RE = /\b(?:search|look(?:\s+up)?|find|check)\s+(?:my\s+)?(?:docs?|documents?|knowledge|knowledge base|polic(?:y|ies)|handbook|sources?)\b/i;
const WEB_SEARCH_RE = /\b(?:search|check|look(?:\s+up)?|find)\s+(?:the\s+)?(?:web|internet|online)\b/i;
const COMPARE_RE = /\b(?:compare|versus|vs\.?|against|difference(?:s)?)\b/i;
const LIST_SOURCES_RE = /\blist sources\b/i;
const NATURAL_CHAT_RE = /\b(?:daily journal|journal|reflect|reflection|brainstorm|draft|rewrite|rephrase|format|outline|plan|organize|creative|ideas?|name ideas|caption|message|email|bio|prompt|template|recommend|suggest|how would you recommend|how should i|what's a good way|help me think|use this chat|personal|habit)\b/i;
const LOCAL_KNOWLEDGE_RE = /\b(?:our|company|organization|internal|local sources?|docs?|documents?|knowledge(?:\s+base)?|policy|policies|handbook|benefits|pto|vacation|leave|payroll|expense|expenses|reimbursement|security|compliance|procedure|process|guideline|guidelines|playbook|contract|agreement|onboarding|offboarding|data source|source)\b/i;
const GENERIC_ADVICE_RE = /\b(?:recommend|suggest|format|structure|brainstorm|draft|write|rewrite|journal|plan|organize|summarize|improve|help me)\b/i;

const FAST_SMALL_TALK_RESPONSES: Record<string, string> = {
  hi: "Hello. What do you want to work on?",
  hello: "Hello. What do you want to work on?",
  hey: "Hello. What do you want to work on?",
  "hey there": "Hello. What do you want to work on?",
  yo: "Hello. What do you want to work on?",
  "good morning": "Good morning. What do you want to work on?",
  "good afternoon": "Good afternoon. What do you want to work on?",
  "good evening": "Good evening. What do you want to work on?",
  thanks: "You're welcome.",
  "thank you": "You're welcome.",
  ok: "Understood.",
  okay: "Understood.",
  cool: "Understood.",
  "sounds good": "Understood.",
  "who are you": "I'm Edgebric's local Qwen-first assistant for search, memory, and knowledge tasks.",
  "what can you do": "I can answer questions, search internal knowledge, use web tools when needed, and manage saved memory.",
  help: "Ask a question, search your knowledge base, compare with the web, or tell me something to remember.",
};

interface ExplicitDocumentRequest {
  title: string;
}

type MutableActionRequest =
  | { kind: "save_to_vault"; title: string }
  | { kind: "create_source"; name: string; sourceType: "organization" | "personal" }
  | { kind: "update_source"; sourceName: string; updates: Record<string, unknown>; destructive?: boolean }
  | { kind: "rename_document"; documentName: string; newName: string; sourceName?: string }
  | { kind: "delete_document"; documentName: string; sourceName?: string }
  | { kind: "delete_source"; sourceName: string };

type PlannerRecord = Record<string, unknown>;

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/[.!?]+$/g, "");
}

export function isSimpleSmallTalk(query: string): boolean {
  return SMALL_TALK.has(normalizeQuery(query));
}

export function getFastSmallTalkResponse(query: string): string | undefined {
  return FAST_SMALL_TALK_RESPONSES[normalizeQuery(query)];
}

export function isDirectMemoryQuery(query: string): boolean {
  const trimmed = query.trim();
  return Boolean(
    extractExplicitMemoryRequest(query)
    || LIST_MEMORY_RE.test(query)
    || DELETE_MEMORY_RE.test(trimmed)
    || UPDATE_MEMORY_RE.test(trimmed),
  );
}

function sanitizeDocumentTitle(rawTitle: string): string {
  return rawTitle
    .replace(/[\0\r\n\t]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 120);
}

function sanitizeEntityName(rawName: string): string {
  return rawName
    .replace(/[\0\r\n\t]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 160);
}

function parseEmailList(raw: string | undefined): string[] {
  if (!raw) return [];
  return Array.from(new Set(
    raw
      .split(/[,\n]/)
      .map((part) => part.trim().toLowerCase())
      .filter((part) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)),
  ));
}

export function extractExplicitDocumentRequest(query: string): ExplicitDocumentRequest | null {
  if (!SAVE_DOCUMENT_RE.test(query)) return null;
  const match = SAVE_DOCUMENT_TITLE_RE.exec(query.trim());
  const rawTitle = match?.[1] ?? match?.[2];
  if (!rawTitle) return null;
  const title = sanitizeDocumentTitle(rawTitle.replace(/[.?!]+$/, ""));
  if (!title) return null;
  return { title };
}

function findLastAssistantMessage(session: Session): string | null {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const message = session.messages[i];
    if (message?.role === "assistant" && typeof message.content === "string" && message.content.trim().length > 0) {
      return message.content.trim();
    }
  }
  return null;
}

function boolFromToggleWord(value: string): boolean {
  return value === "on" || value === "enable";
}

function buildActionField(
  key: string,
  label: string,
  input: ChatActionField["input"],
  required = false,
  options?: ChatActionField["options"],
  description?: string,
): ChatActionField {
  return { key, label, input, required, ...(options ? { options } : {}), ...(description ? { description } : {}) };
}

function buildActionProposal(request: MutableActionRequest | null, session: Session): ChatActionProposal | null {
  if (!request) return null;
  switch (request.kind) {
    case "save_to_vault": {
      const content = findLastAssistantMessage(session);
      if (!content) return null;
      return {
        id: randomUUID(),
        tool: "save_to_vault",
        title: "Save as document",
        summary: "Save the previous assistant reply to your vault.",
        confirmLabel: "Save document",
        arguments: { title: request.title, content },
        fields: [
          buildActionField("title", "Document title", "text", true),
          buildActionField("content", "Content", "textarea", true),
        ],
      };
    }
    case "create_source":
      return {
        id: randomUUID(),
        tool: "create_source",
        title: "Create data source",
        summary: "Create a new data source you can manage from chat.",
        confirmLabel: "Create source",
        arguments: {
          name: request.name,
          type: request.sourceType,
        },
        fields: [
          buildActionField("name", "Source name", "text", true),
          buildActionField("type", "Storage", "select", true, [
            { value: "organization", label: "Network" },
            { value: "personal", label: "Vault" },
          ]),
        ],
      };
    case "update_source":
      return {
        id: randomUUID(),
        tool: "update_source",
        title: "Update data source",
        summary: `Apply changes to "${request.sourceName}".`,
        confirmLabel: request.destructive ? "Apply changes" : "Confirm changes",
        arguments: {
          sourceName: request.sourceName,
          ...request.updates,
        },
        ...(request.destructive !== undefined && { destructive: request.destructive }),
        fields: Object.entries(request.updates).map(([key, value]) => {
          if (key === "accessMode") {
            return buildActionField("accessMode", "Access", "select", true, [
              { value: "all", label: "Whole org" },
              { value: "restricted", label: "Restricted" },
            ]);
          }
          if (key === "piiMode") {
            return buildActionField("piiMode", "PII mode", "select", true, [
              { value: "off", label: "Off" },
              { value: "warn", label: "Warn" },
              { value: "block", label: "Block" },
            ]);
          }
          if (key === "accessList") return buildActionField("accessList", "Allowed emails", "string_list");
          if (typeof value === "boolean") return buildActionField(key, key === "allowSourceViewing" ? "Allow source viewing" : "Allow vault sync", "boolean");
          return buildActionField(key, key, "text");
        }),
      };
    case "rename_document":
      return {
        id: randomUUID(),
        tool: "rename_document",
        title: "Rename document",
        summary: `Rename "${request.documentName}".`,
        confirmLabel: "Rename document",
        arguments: {
          documentName: request.documentName,
          ...(request.sourceName ? { sourceName: request.sourceName } : {}),
          newName: request.newName,
        },
        fields: [
          buildActionField("documentName", "Current document", "text", true),
          buildActionField("newName", "New name", "text", true),
          buildActionField("sourceName", "Source", "text"),
        ],
      };
    case "delete_document":
      return {
        id: randomUUID(),
        tool: "delete_document",
        title: "Delete document",
        summary: `Delete "${request.documentName}".`,
        confirmLabel: "Delete document",
        destructive: true,
        arguments: {
          documentName: request.documentName,
          ...(request.sourceName ? { sourceName: request.sourceName } : {}),
        },
        fields: [
          buildActionField("documentName", "Document", "text", true),
          buildActionField("sourceName", "Source", "text"),
        ],
      };
    case "delete_source":
      return {
        id: randomUUID(),
        tool: "delete_source",
        title: "Delete data source",
        summary: `Delete "${request.sourceName}" and all of its files.`,
        confirmLabel: "Delete source",
        destructive: true,
        arguments: { sourceName: request.sourceName },
        fields: [
          buildActionField("sourceName", "Source", "text", true),
        ],
      };
  }
}

function extractMutableActionRequest(query: string): MutableActionRequest | null {
  const explicitDocument = extractExplicitDocumentRequest(query);
  if (explicitDocument) {
    return { kind: "save_to_vault", title: explicitDocument.title };
  }

  const createSource = CREATE_SOURCE_RE.exec(query.trim());
  if (createSource) {
    const name = sanitizeEntityName(createSource[1] ?? createSource[2] ?? "");
    if (name) {
      return {
        kind: "create_source",
        name,
        sourceType: /\b(vault|personal)\b/i.test(query) ? "personal" : "organization",
      };
    }
  }

  const renameSource = RENAME_SOURCE_RE.exec(query.trim());
  if (renameSource) {
    return {
      kind: "update_source",
      sourceName: sanitizeEntityName(renameSource[1]!),
      updates: { name: sanitizeEntityName(renameSource[2]!) },
    };
  }

  const restrictSource = RESTRICT_SOURCE_RE.exec(query.trim());
  if (restrictSource) {
    return {
      kind: "update_source",
      sourceName: sanitizeEntityName(restrictSource[1]!),
      updates: {
        accessMode: "restricted",
        accessList: parseEmailList(restrictSource[2]),
      },
    };
  }

  const openSource = OPEN_SOURCE_RE.exec(query.trim());
  if (openSource) {
    return {
      kind: "update_source",
      sourceName: sanitizeEntityName(openSource[1]!),
      updates: { accessMode: "all", accessList: [] },
    };
  }

  const sourceViewing = SOURCE_VIEWING_RE.exec(query.trim());
  if (sourceViewing) {
    return {
      kind: "update_source",
      sourceName: sanitizeEntityName(sourceViewing[2]!),
      updates: { allowSourceViewing: boolFromToggleWord(sourceViewing[1]!) },
    };
  }

  const vaultSync = VAULT_SYNC_RE.exec(query.trim());
  if (vaultSync) {
    return {
      kind: "update_source",
      sourceName: sanitizeEntityName(vaultSync[2]!),
      updates: { allowVaultSync: boolFromToggleWord(vaultSync[1]!) },
    };
  }

  const piiMode = PII_MODE_RE.exec(query.trim());
  if (piiMode) {
    return {
      kind: "update_source",
      sourceName: sanitizeEntityName(piiMode[1]!),
      updates: { piiMode: piiMode[2] },
    };
  }

  const renameDocument = RENAME_DOCUMENT_RE.exec(query.trim());
  if (renameDocument) {
    const sourceName = SOURCE_SCOPE_RE.exec(query.trim())?.[1];
    return {
      kind: "rename_document",
      documentName: sanitizeEntityName(renameDocument[1]!),
      newName: sanitizeEntityName(renameDocument[2]!),
      ...(sourceName ? { sourceName: sanitizeEntityName(sourceName) } : {}),
    };
  }

  const deleteDocument = DELETE_DOCUMENT_RE.exec(query.trim());
  if (deleteDocument && !/\bdata\s+source|source\b/i.test(deleteDocument[1]!)) {
    const sourceName = SOURCE_SCOPE_RE.exec(query.trim())?.[1];
    return {
      kind: "delete_document",
      documentName: sanitizeEntityName(deleteDocument[1]!),
      ...(sourceName ? { sourceName: sanitizeEntityName(sourceName) } : {}),
    };
  }

  const deleteSource = DELETE_SOURCE_RE.exec(query.trim());
  if (deleteSource) {
    return {
      kind: "delete_source",
      sourceName: sanitizeEntityName(deleteSource[1]!),
    };
  }

  return null;
}

export function isConciseLookupQuery(query: string): boolean {
  const normalized = query.trim();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return (
    normalized.length > 0
    && normalized.length <= 180
    && wordCount <= 28
    && (SIMPLE_LOOKUP_RE.test(normalized) || normalized.endsWith("?"))
    && !DEEP_DETAIL_RE.test(normalized)
    && !/\b(?:and|then|also)\b/i.test(normalized)
  );
}

export function prefersNaturalChat(query: string): boolean {
  const normalized = query.trim();
  if (!normalized) return true;
  if (isSimpleSmallTalk(normalized) || isDirectMemoryQuery(normalized)) return true;
  if (needsPlannedExecution(normalized)) return false;
  if (DOC_SEARCH_RE.test(normalized) || WEB_SEARCH_RE.test(normalized) || LIST_SOURCES_RE.test(normalized)) return false;

  const asksAboutUsingChat = /\b(?:this chat|you)\b/i.test(normalized) && GENERIC_ADVICE_RE.test(normalized);
  const firstPersonOpenEnded = /\b(?:i want|i'd like|if i wanted|can you help me|help me|what do you recommend)\b/i.test(normalized);
  return NATURAL_CHAT_RE.test(normalized) || asksAboutUsingChat || firstPersonOpenEnded;
}

export function prefersGroundedKnowledge(query: string, hasDatasets: boolean): boolean {
  if (!hasDatasets) return false;
  const normalized = query.trim();
  if (!normalized) return false;
  if (prefersNaturalChat(normalized)) return false;
  if (needsPlannedExecution(normalized)) return false;
  if (DOC_SEARCH_RE.test(normalized) || LOCAL_KNOWLEDGE_RE.test(normalized)) return true;
  return isConciseLookupQuery(normalized);
}

function needsPlannedExecution(query: string): boolean {
  return [
    /\bcompare\b/i,
    /\bversus\b/i,
    /\bvs\.?\b/i,
    /\bfact[- ]?check\b/i,
    /\bverify\b/i,
    /\bsearch (?:the )?web\b/i,
    /\bbrowse\b/i,
    /\bread (?:this|the) url\b/i,
    /\bopen (?:this|the) url\b/i,
    /\bfind related\b/i,
    /\blist sources\b/i,
    /\bcreate (?:a )?source\b/i,
    /\bupload\b/i,
    /\bdelete (?:the )?(?:document|source)\b/i,
    /\b(?:and|then|also)\b/i,
  ].some((pattern) => pattern.test(query));
}

function extractPlanningSignals(query: string, req: OrchestrationRequest): {
  hasSearch: boolean;
  wantsKnowledgeSearch: boolean;
  wantsWebSearch: boolean;
  wantsCompare: boolean;
  wantsListSources: boolean;
  explicitMemory: ReturnType<typeof extractExplicitMemoryRequest> | null;
  url: string | undefined;
} {
  const hasSearch = req.search.datasetNames.length > 0 && !req.skipSearch;
  const embeddedRemember = query.match(EMBEDDED_REMEMBER_RE)?.[1]?.trim();
  const explicitMemory = extractExplicitMemoryRequest(query) ?? (
    embeddedRemember
      ? {
          content: embeddedRemember.replace(/[.!,;:]+$/, ""),
          category: "instruction" as const,
        }
      : null
  );

  return {
    hasSearch,
    wantsKnowledgeSearch: hasSearch && (
      DOC_SEARCH_RE.test(query)
      || COMPARE_RE.test(query)
      || /\bmy docs\b/i.test(query)
      || /\bpolicy\b/i.test(query)
    ),
    wantsWebSearch: req.toolContext.allowWeb !== false && (WEB_SEARCH_RE.test(query) || /\b(latest|current|recent)\b/i.test(query)),
    wantsCompare: COMPARE_RE.test(query),
    wantsListSources: LIST_SOURCES_RE.test(query),
    explicitMemory,
    url: query.match(/https?:\/\/\S+/i)?.[0],
  };
}

function buildDeterministicPlan(query: string, req: OrchestrationRequest): ParsedPlan | null {
  const signals = extractPlanningSignals(query, req);
  const checklist: PlannedTask[] = [];

  if (signals.wantsListSources) {
    checklist.push({
      id: "list-sources",
      title: "List accessible knowledge sources",
      tool: "list_sources",
      arguments: {},
      dependsOn: [],
    });
  }

  if (signals.hasSearch && signals.wantsKnowledgeSearch) {
    checklist.push({
      id: "search-knowledge",
      title: signals.wantsCompare ? "Search internal knowledge for comparison" : "Search internal knowledge",
      tool: "search_knowledge",
      arguments: { query, topK: signals.wantsCompare ? 4 : 5 },
      dependsOn: [],
    });
  }

  if (signals.wantsWebSearch) {
    checklist.push({
      id: "search-web",
      title: signals.wantsCompare ? "Search the web for comparison" : "Search the web",
      tool: "web_search",
      arguments: { query },
      dependsOn: [],
    });
  }

  if (signals.url && req.toolContext.allowWeb !== false) {
    checklist.push({
      id: "read-url",
      title: "Read the referenced URL",
      tool: "read_url",
      arguments: { url: signals.url },
      dependsOn: [],
    });
  }

  if (signals.explicitMemory && req.toolContext.allowMutations !== false) {
    checklist.push({
      id: "save-memory",
      title: "Save the stated memory preference",
      tool: "save_memory",
      arguments: {
        content: signals.explicitMemory.content,
        category: signals.explicitMemory.category,
      },
      dependsOn: [],
    });
  }

  const deduped = checklist.filter((task, index, items) =>
    items.findIndex((candidate) => candidate.tool === task.tool && JSON.stringify(candidate.arguments) === JSON.stringify(task.arguments)) === index,
  );
  if (deduped.length === 0) return null;

  const multiCapability = new Set(deduped.map((task) => task.tool)).size > 1;
  if (!multiCapability && deduped[0]?.tool === "search_knowledge") {
    return {
      mode: "rag_answer",
      groundingPolicy: "grounded",
      completionCriteria: "Answer the request directly from internal knowledge.",
      checklist: [],
    };
  }

  return {
    mode: "planned_tool_execution",
    groundingPolicy: deduped.some((task) => task.tool === "web_search" || task.tool === "read_url") ? "mixed" : "grounded",
    completionCriteria: "Answer all parts of the user's request using every completed checklist item.",
    checklist: deduped,
  };
}

function summarizeToolResult(toolName: string, data: unknown): string {
  if (!data || typeof data !== "object") return "Done";
  const d = data as Record<string, unknown>;
  switch (toolName) {
    case "search_knowledge":
      return `${d["resultCount"] ?? 0} results found`;
    case "list_sources":
      return `${d["sourceCount"] ?? 0} sources`;
    case "list_documents":
      return `${d["documentCount"] ?? 0} documents`;
    case "get_source_summary":
      return `Summarized ${d["sourceName"] ?? "source"}`;
    case "web_search":
      return `${d["resultCount"] ?? 0} web results`;
    case "read_url":
      return `Fetched ${d["contentLength"] ?? 0} chars${d["truncated"] ? " (truncated)" : ""}`;
    case "cite_check":
      return `${d["evidenceCount"] ?? 0} evidence items`;
    case "find_related":
      return `${(d["related"] as unknown[])?.length ?? 0} related documents`;
    case "save_to_vault":
      return `Saved "${d["title"] ?? "note"}"`;
    case "create_source":
      return `Created "${d["name"] ?? "source"}"`;
    case "update_source":
      return `Updated "${d["name"] ?? "source"}"`;
    case "upload_document":
      return `Uploaded "${d["filename"] ?? "document"}"`;
    case "rename_document":
      return `Renamed to "${d["newName"] ?? "document"}"`;
    case "delete_document":
      return `Deleted "${d["deleted"] ?? "document"}"`;
    case "delete_source":
      return `Deleted "${d["deleted"] ?? "source"}"`;
    case "save_memory":
      return `Saved memory "${(d["content"] as string)?.slice(0, 40) ?? ""}"`;
    case "list_memories":
      return `${d["count"] ?? 0} memories`;
    case "delete_memory":
      return `Deleted memory`;
    case "update_memory":
      return `Updated memory`;
    default:
      return "Done";
  }
}

function summarizeForPrompt(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json.length > 4_000 ? `${json.slice(0, 4_000)}…` : json;
  } catch {
    return String(value);
  }
}

function extractSentences(text: string, maxSentences: number): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .slice(0, maxSentences);
}

function buildExtractiveGroundedAnswer(query: string, results: SearchExecutionResult["results"]): string | null {
  const top = results[0];
  if (!top || top.similarity < 0.82) return null;

  const primarySentences = extractSentences(top.chunk, 2);
  if (primarySentences.length === 0) return null;

  const keywords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !["what", "does", "about", "policy", "latest"].includes(token));
  const secondary = results.slice(1).find((result) =>
    result.similarity >= 0.65
    && keywords.some((keyword) => result.chunk.toLowerCase().includes(keyword) || result.metadata.heading.toLowerCase().includes(keyword)),
  );
  const secondarySentence = secondary ? extractSentences(secondary.chunk, 1)[0] : undefined;

  const pieces = [`According to the documents, ${primarySentences.join(" ")} [Source 1]`];
  if (secondarySentence) {
    pieces.push(`${secondarySentence} [Source 2]`);
  }

  return pieces.join(" ");
}

function coerceRecord(value: unknown): PlannerRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as PlannerRecord : null;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function normalizePlannerMode(value: unknown): OrchestrationMode {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "memory" || normalized === "memory_action") return "memory_action";
  if (normalized === "document" || normalized === "document_action") return "document_action";
  if (normalized === "rag" || normalized === "rag_answer" || normalized === "grounded") return "rag_answer";
  if (normalized === "direct" || normalized === "chat" || normalized === "direct_chat") return "direct_chat";
  return "planned_tool_execution";
}

function normalizeToolName(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    const record = coerceRecord(value);
    const nested = pickString(record?.["name"], record?.["tool"], record?.["action"]);
    if (nested) return nested;
  }
  return undefined;
}

function normalizePlannerTask(task: unknown, index: number): PlannerRecord | null {
  const record = coerceRecord(task);
  if (!record) return null;

  const tool = normalizeToolName(
    record["tool"],
    record["name"],
    record["action"],
    record["function"],
    record["capability"],
  );
  if (!tool) return null;

  const args = coerceRecord(record["arguments"])
    ?? coerceRecord(record["args"])
    ?? coerceRecord(record["params"])
    ?? coerceRecord(record["input"])
    ?? {};
  const rawDepends = record["dependsOn"] ?? record["dependencies"] ?? record["requires"];
  const dependsOn = Array.isArray(rawDepends)
    ? rawDepends.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  return {
    id: pickString(record["id"], record["stepId"], record["step"], `step-${index + 1}`),
    title: pickString(record["title"], record["goal"], record["task"], record["description"], `Run ${tool.replace(/_/g, " ")}`),
    tool,
    arguments: args,
    dependsOn,
  };
}

export function normalizePlannerPayload(payload: unknown): PlannerRecord {
  const record = coerceRecord(payload) ?? {};
  const rawChecklist = Array.isArray(record["checklist"])
    ? record["checklist"]
    : Array.isArray(record["steps"])
      ? record["steps"]
      : Array.isArray(record["tasks"])
        ? record["tasks"]
        : Array.isArray(record["plan"])
          ? record["plan"]
          : [];

  return {
    mode: normalizePlannerMode(record["mode"]),
    groundingPolicy: pickString(record["groundingPolicy"], record["answerStrategy"]) ?? "mixed",
    completionCriteria: pickString(record["completionCriteria"], record["successCriteria"], record["goal"]) ?? "Answer every part of the user's request.",
    checklist: rawChecklist.map((task, index) => normalizePlannerTask(task, index)).filter((task): task is PlannerRecord => task != null),
  };
}

function buildExecutionPlan(tasks: PlannedTask[]): ExecutionChecklistItem[] {
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: "planned",
    tool: task.tool,
    dependsOn: task.dependsOn,
  }));
}

function emitPlanEvent(sendEvent: (event: string, data: unknown) => void, executionPlan: ExecutionChecklistItem[], mode: OrchestrationMode): void {
  sendEvent("plan", { mode, executionPlan });
}

function emitPlanStep(sendEvent: (event: string, data: unknown) => void, item: ExecutionChecklistItem): void {
  sendEvent("plan_step", item);
}

async function streamDirectChat(
  query: string,
  session: Session,
  memoryContextBlock: string | undefined,
  sendEvent: (event: string, data: unknown) => void,
): Promise<Pick<OrchestrationResult, "answer" | "citations" | "hasConfidentAnswer" | "answerType">> {
  const fastResponse = getFastSmallTalkResponse(query);
  if (fastResponse) {
    sendEvent("delta", { delta: fastResponse });
    return {
      answer: fastResponse,
      citations: [],
      hasConfidentAnswer: true,
      answerType: "general",
    };
  }

  const prompt = isSimpleSmallTalk(query)
    ? "You are a natural, conversational local AI assistant. Reply in one short sentence. Do not list capabilities unless the user asks."
    : buildGeneralPrompt();
  const systemPrompt = [prompt, memoryContextBlock].filter(Boolean).join("\n\n");
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    ...session.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let answer = "";
  const maxTokens = isSimpleSmallTalk(query) ? 48 : 220;
  for await (const delta of chatClient.chatStream(messages, { maxTokens, temperature: 0.2 })) {
    answer += delta;
    sendEvent("delta", { delta });
  }

  return {
    answer,
    citations: [],
    hasConfidentAnswer: true,
    answerType: "general",
  };
}

function buildConciseGroundedCitations(results: SearchExecutionResult["results"]): Citation[] {
  return results.map((result) => ({
    documentId: result.metadata.sourceDocument,
    documentName: result.metadata.documentName ?? result.metadata.sourceDocument,
    sectionPath: result.metadata.sectionPath,
    pageNumber: result.metadata.pageNumber,
    excerpt: result.chunk.slice(0, 300),
    chunkId: result.chunkId,
  }));
}

async function streamConciseGroundedAnswer(
  query: string,
  session: Session,
  searchResults: SearchExecutionResult["results"],
  strict: boolean,
  _memoryContextBlock: string | undefined,
  sendEvent: (event: string, data: unknown) => void,
): Promise<Pick<OrchestrationResult, "answer" | "citations" | "hasConfidentAnswer" | "answerType" | "retrievalScore">> {
  const relevant = searchResults.filter((result) => result.similarity >= 0.3).slice(0, 2);
  if (relevant.length === 0) {
    return {
      answer: "I didn't find a strong answer in the local sources.",
      citations: [],
      hasConfidentAnswer: false,
      answerType: "grounded",
      retrievalScore: 0,
    };
  }

  const extractiveAnswer = buildExtractiveGroundedAnswer(query, relevant);
  if (extractiveAnswer) {
    sendEvent("delta", { delta: extractiveAnswer });
    const citations = buildConciseGroundedCitations(relevant);
    const retrievalScore = relevant.reduce((sum, result) => sum + result.similarity, 0) / relevant.length;
    return {
      answer: extractiveAnswer,
      citations,
      hasConfidentAnswer: true,
      answerType: "grounded",
      retrievalScore: Math.round(retrievalScore * 100) / 100,
    };
  }

  const sourceBlock = relevant.map((result, index) => [
    `<source index="${index + 1}" document="${result.metadata.documentName ?? result.metadata.sourceDocument}">`,
    result.chunk.slice(0, 260),
    "</source>",
  ].join("\n")).join("\n\n");

  const messages: Message[] = [
    {
      role: "system",
      content: [
        "You are a natural local AI assistant.",
        strict
          ? "Answer only from the provided sources and be direct about what they do and do not say."
          : "Use the provided sources first, but keep the tone natural and helpful. Do not invent unsupported company-specific details.",
        "Answer in a natural voice. Keep it concise unless the user asks for more detail.",
        "When a statement comes from the provided sources, cite it inline as [Source N].",
        "Do not add a separate sources section.",
        `<context>\n${sourceBlock}\n</context>`,
      ].filter(Boolean).join("\n\n"),
    },
    ...session.messages.slice(-4).map((message) => ({ role: message.role, content: message.content })),
  ];

  let answer = "";
  for await (const delta of chatClient.chatStream(messages, { maxTokens: 96, temperature: 0 })) {
    answer += delta;
    sendEvent("delta", { delta });
  }

  const citations = buildConciseGroundedCitations(relevant);
  const retrievalScore = relevant.reduce((sum, result) => sum + result.similarity, 0) / relevant.length;
  return {
    answer,
    citations,
    hasConfidentAnswer: true,
    answerType: "grounded",
    retrievalScore: Math.round(retrievalScore * 100) / 100,
  };
}

async function executeDirectMemoryAction(
  query: string,
  ctx: ToolContext,
): Promise<{ answer: string; executionPlan: ExecutionChecklistItem[] }> {
  const explicit = extractExplicitMemoryRequest(query);
  if (explicit) {
    await saveMemory({
      content: explicit.content,
      category: explicit.category,
      confidence: 1,
      source: "explicit",
      orgId: ctx.orgId,
      userId: ctx.userEmail,
    });
    return {
      answer: "I'll remember that.",
      executionPlan: [{ id: "memory-save", title: "Save memory", status: "completed", tool: "save_memory", summary: "Saved memory" }],
    };
  }

  if (LIST_MEMORY_RE.test(query)) {
    const memories = listMemories(ctx.orgId, ctx.userEmail).slice(0, 8);
    const answer = memories.length === 0
      ? "I don't have any saved memories for you yet."
      : [
        "Here's what I currently remember:",
        ...memories.map((memory, index) => `${index + 1}. [${memory.category}] ${memory.content}`),
      ].join("\n");
    return {
      answer,
      executionPlan: [{ id: "memory-list", title: "List saved memories", status: "completed", tool: "list_memories", summary: `${memories.length} memories` }],
    };
  }

  const deleteMatch = DELETE_MEMORY_RE.exec(query.trim());
  if (deleteMatch?.[1]) {
    const needle = deleteMatch[1].trim().toLowerCase();
    const matches = listMemories(ctx.orgId, ctx.userEmail).filter((memory) => memory.content.toLowerCase().includes(needle));
    if (matches.length === 0) {
      return {
        answer: "I couldn't find a saved memory matching that.",
        executionPlan: [{ id: "memory-delete", title: "Delete saved memory", status: "failed", tool: "delete_memory", summary: "No matching memory found" }],
      };
    }

    for (const match of matches) {
      deleteMemory(match.id, ctx.orgId, ctx.userEmail);
    }

    return {
      answer: matches.length === 1 ? "I've forgotten that." : `I've removed ${matches.length} matching memories.`,
      executionPlan: [{ id: "memory-delete", title: "Delete saved memory", status: "completed", tool: "delete_memory", summary: `Deleted ${matches.length} memories` }],
    };
  }

  const updateMatch = UPDATE_MEMORY_RE.exec(query.trim());
  if (updateMatch?.[1] && updateMatch[2]) {
    const target = updateMatch[1].trim().toLowerCase();
    const replacement = updateMatch[2].trim();
    const existing = listMemories(ctx.orgId, ctx.userEmail).find((memory) => memory.content.toLowerCase().includes(target));
    if (!existing) {
      return {
        answer: "I couldn't find a saved memory matching that update request.",
        executionPlan: [{ id: "memory-update", title: "Update saved memory", status: "failed", tool: "update_memory", summary: "No matching memory found" }],
      };
    }

    await updateMemory(existing.id, { content: replacement }, ctx.orgId, ctx.userEmail);
    return {
      answer: "I've updated that memory.",
      executionPlan: [{ id: "memory-update", title: "Update saved memory", status: "completed", tool: "update_memory", summary: "Updated memory" }],
    };
  }

  return {
    answer: "I couldn't understand the memory request.",
    executionPlan: [{ id: "memory-action", title: "Handle memory request", status: "failed", summary: "Unrecognized memory request" }],
  };
}

async function executeDirectDocumentAction(
  query: string,
  session: Session,
  ctx: ToolContext,
): Promise<{ answer: string; executionPlan: ExecutionChecklistItem[] }> {
  const request = extractExplicitDocumentRequest(query);
  if (!request) {
    return {
      answer: "I couldn't understand what document title to use.",
      executionPlan: [{ id: "document-save", title: "Save document", status: "failed", tool: "save_to_vault", summary: "Missing document title" }],
    };
  }

  const content = findLastAssistantMessage(session);
  if (!content) {
    return {
      answer: "I don't have a previous answer to save yet.",
      executionPlan: [{ id: "document-save", title: "Save document", status: "failed", tool: "save_to_vault", summary: "No assistant content available" }],
    };
  }

  const result = await executeTool("save_to_vault", {
    title: request.title,
    content,
  }, ctx);

  if (!result.success) {
    return {
      answer: result.error ?? "I couldn't save that document.",
      executionPlan: [{ id: "document-save", title: "Save document", status: "failed", tool: "save_to_vault", summary: result.error ?? "Save failed" }],
    };
  }

  return {
    answer: `Saved as "${request.title}".`,
    executionPlan: [{ id: "document-save", title: "Save document", status: "completed", tool: "save_to_vault", summary: `Saved "${request.title}"` }],
  };
}

async function generatePlan(query: string, req: OrchestrationRequest): Promise<ParsedPlan> {
  const deterministicPlan = buildDeterministicPlan(query, req);
  if (deterministicPlan) return deterministicPlan;

  const allowedTools = listTools().filter((tool) => {
    if (tool.execution.mutating && req.toolContext.allowMutations === false) return false;
    if (tool.execution.dependencyClass === "web" && req.toolContext.allowWeb === false) return false;
    return true;
  });

  const toolCatalog = allowedTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    execution: tool.execution,
  }));

  const plannerMessages: Message[] = [
    {
      role: "system",
      content: [
        "You are Edgebric's Qwen-first execution planner.",
        "Return only valid JSON. Do not wrap it in markdown.",
        "Use this exact shape: {\"mode\":\"planned_tool_execution\",\"groundingPolicy\":\"mixed\",\"completionCriteria\":\"...\",\"checklist\":[{\"id\":\"step-1\",\"title\":\"...\",\"tool\":\"search_knowledge\",\"arguments\":{},\"dependsOn\":[]}]}",
        "Break the user request into the minimum checklist of tool actions needed to satisfy the full request.",
        "If multiple read-only tasks are independent, keep them separate so they can run in parallel.",
        "Do not invent tool names or arguments outside the provided catalog.",
        "If the request is ordinary conversation, brainstorming, writing help, or advice, return mode 'direct_chat' with an empty checklist.",
        "If the request depends on local knowledge, return mode 'rag_answer' with an empty checklist.",
        `Available tools: ${JSON.stringify(toolCatalog)}`,
      ].join("\n\n"),
    },
    { role: "user", content: query },
  ];

  try {
    const raw = await chatClient.chatComplete(plannerMessages, { maxTokens: 320, temperature: 0 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Planner returned no JSON object");
    const parsed = plannerSchema.parse(normalizePlannerPayload(JSON.parse(jsonMatch[0])));
    const validTools = new Set(allowedTools.map((tool) => tool.name));
    const checklist = parsed.checklist
      .filter((task) => validTools.has(task.tool))
      .map((task, index) => ({
        id: task.id || `step-${index + 1}`,
        title: task.title || `Run ${task.tool.replace(/_/g, " ")}`,
        tool: task.tool,
        arguments: task.arguments,
        dependsOn: task.dependsOn,
      }));

    const normalizedMode = parsed.mode === "tool_plan" ? "planned_tool_execution" : parsed.mode;

    if (normalizedMode !== "planned_tool_execution" || checklist.length === 0) {
      return fallbackPlan(query, req);
    }

    return {
      mode: normalizedMode,
      groundingPolicy: parsed.groundingPolicy,
      completionCriteria: parsed.completionCriteria,
      checklist,
    };
  } catch (err) {
    logger.warn({ err, query: query.slice(0, 120) }, "Planner JSON generation failed, falling back to heuristic plan");
    return fallbackPlan(query, req);
  }
}

export async function generatePlanForBenchmark(
  query: string,
  req: OrchestrationRequest,
): Promise<{ plan: ParsedPlan; planningMs: number }> {
  const startedAt = Date.now();
  const plan = await generatePlan(query, req);
  return {
    plan,
    planningMs: Date.now() - startedAt,
  };
}

function fallbackPlan(query: string, req: OrchestrationRequest): ParsedPlan {
  const deterministicPlan = buildDeterministicPlan(query, req);
  if (deterministicPlan) return deterministicPlan;

  const checklist: PlannedTask[] = [];
  const hasSearch = req.search.datasetNames.length > 0 && !req.skipSearch;

  if (/\blist sources\b/i.test(query)) {
    checklist.push({ id: "list-sources", title: "List accessible knowledge sources", tool: "list_sources", arguments: {}, dependsOn: [] });
  }

  if (hasSearch) {
    checklist.push({
      id: "search-knowledge",
      title: "Search internal knowledge",
      tool: "search_knowledge",
      arguments: { query, topK: 5 },
      dependsOn: [],
    });
  }

  if (req.toolContext.allowWeb !== false && /\b(web|internet|online|browse|url|website)\b/i.test(query)) {
    checklist.push({
      id: "search-web",
      title: "Search the web",
      tool: "web_search",
      arguments: { query },
      dependsOn: [],
    });
  }

  const urlMatch = query.match(/https?:\/\/\S+/i);
  if (req.toolContext.allowWeb !== false && urlMatch?.[0]) {
    checklist.push({
      id: "read-url",
      title: "Read referenced URL",
      tool: "read_url",
      arguments: { url: urlMatch[0] },
      dependsOn: [],
    });
  }

  const embeddedRemember = query.match(EMBEDDED_REMEMBER_RE)?.[1]?.trim();
  const explicitMemory = extractExplicitMemoryRequest(query) ?? (
    embeddedRemember
      ? {
          content: embeddedRemember.replace(/[.!,;:]+$/, ""),
          category: "instruction" as const,
        }
      : null
  );
  if (req.toolContext.allowMutations !== false && explicitMemory) {
    checklist.push({
      id: "save-memory",
      title: "Save the stated memory preference",
      tool: "save_memory",
      arguments: {
        content: explicitMemory.content,
        category: explicitMemory.category,
      },
      dependsOn: [],
    });
  }

  if (checklist.length === 0) {
    return {
      mode: hasSearch ? "rag_answer" : "direct_chat",
      groundingPolicy: hasSearch ? "grounded" : "general",
      completionCriteria: "Answer the request directly.",
      checklist: [],
    };
  }

  // Remove duplicate search steps if the query is explicitly pure web.
  const deduped = checklist.filter((task, index, arr) =>
    arr.findIndex((other) => other.tool === task.tool && JSON.stringify(other.arguments) === JSON.stringify(task.arguments)) === index,
  );

  return {
    mode: "planned_tool_execution",
    groundingPolicy: deduped.some((task) => task.tool === "web_search" || task.tool === "read_url") ? "mixed" : "grounded",
    completionCriteria: "Answer all parts of the user's request using the executed checklist.",
    checklist: deduped,
  };
}

async function executePlannedTasks(
  tasks: PlannedTask[],
  req: OrchestrationRequest,
): Promise<{ toolUses: ToolUseRecord[]; executionPlan: ExecutionChecklistItem[]; taskResults: Map<string, { success: boolean; data?: unknown; error?: string }> }> {
  const executionPlan = buildExecutionPlan(tasks);
  const toolUses: ToolUseRecord[] = [];
  const taskResults = new Map<string, { success: boolean; data?: unknown; error?: string }>();

  const markStatus = (taskId: string, status: ExecutionChecklistItem["status"], summary?: string): void => {
    const item = executionPlan.find((step) => step.id === taskId);
    if (!item) return;
    item.status = status;
    if (summary) item.summary = summary;
    emitPlanStep(req.sendEvent, { ...item });
  };

  while (true) {
    const planned = executionPlan.filter((item) => item.status === "planned");
    if (planned.length === 0) break;

    for (const item of planned) {
      const dependencyStates = (item.dependsOn ?? []).map((id) => executionPlan.find((step) => step.id === id)?.status);
      if (dependencyStates.some((state) => state === "failed" || state === "skipped")) {
        markStatus(item.id, "skipped", "Skipped because a dependency failed");
      }
    }

    const ready = executionPlan.filter((item) => {
      if (item.status !== "planned") return false;
      return (item.dependsOn ?? []).every((id) => executionPlan.find((step) => step.id === id)?.status === "completed");
    });

    if (ready.length === 0) break;

    const parallel = ready.filter((item) => {
      const meta = item.tool ? getToolExecutionMetadata(item.tool) : undefined;
      return meta?.parallelSafe === true && meta.mutating === false;
    });
    const serial = ready.filter((item) => !parallel.some((candidate) => candidate.id === item.id));

    const runOne = async (item: ExecutionChecklistItem): Promise<void> => {
      const task = tasks.find((candidate) => candidate.id === item.id);
      if (!task) return;

      markStatus(item.id, "running");
      const result = await executeTool(task.tool, task.arguments, req.toolContext);
      const summary = result.success ? summarizeToolResult(task.tool, result.data) : `Error: ${result.error}`;

      toolUses.push({
        name: task.tool,
        arguments: task.arguments,
        result: { success: result.success, summary },
      });
      taskResults.set(task.id, result);

      req.sendEvent("tool_use", { tool: task.tool, success: result.success, summary, stepId: task.id });
      markStatus(task.id, result.success ? "completed" : "failed", summary);
    };

    if (parallel.length > 0) {
      await Promise.all(parallel.map((item) => runOne(item)));
    }

    for (const item of serial) {
      await runOne(item);
    }
  }

  return { toolUses, executionPlan, taskResults };
}

async function streamPlannedSynthesis(
  query: string,
  session: Session,
  plan: ParsedPlan,
  executionPlan: ExecutionChecklistItem[],
  toolUses: ToolUseRecord[],
  taskResults: Map<string, { success: boolean; data?: unknown; error?: string }>,
  memoryContextBlock: string | undefined,
  sendEvent: (event: string, data: unknown) => void,
): Promise<string> {
  const resultBlocks = plan.checklist.map((task) => {
    const result = taskResults.get(task.id);
    return [
      `<task id="${task.id}" tool="${task.tool}">`,
      `title: ${task.title}`,
      `status: ${result?.success ? "completed" : "failed"}`,
      `summary: ${toolUses.find((tool) => tool.name === task.tool && JSON.stringify(tool.arguments) === JSON.stringify(task.arguments))?.result.summary ?? "No summary"}`,
      `result: ${summarizeForPrompt(result?.success ? result.data : { error: result?.error ?? "Unknown error" })}`,
      `</task>`,
    ].join("\n");
  }).join("\n\n");

  const messages: Message[] = [
    {
      role: "system",
      content: [
        "You are Edgebric's Qwen-optimized execution synthesizer.",
        "Answer the user's full original request using the completed checklist and tool results below.",
        "Do not ignore unfinished or failed parts of the request. If something failed, say that clearly.",
        plan.groundingPolicy === "grounded"
          ? "Ground the answer in the retrieved/tool results and avoid unsupported claims."
          : "You may add light general reasoning, but prioritize the tool results.",
        "Write like a natural assistant, not a compliance bot.",
        memoryContextBlock,
        `Completion criteria: ${plan.completionCriteria}`,
        `Execution plan: ${JSON.stringify(executionPlan)}`,
        `<tool_results>\n${resultBlocks}\n</tool_results>`,
      ].filter(Boolean).join("\n\n"),
    },
    ...session.messages.map((message) => ({ role: message.role, content: message.content })),
    { role: "user", content: `Original request: ${query}` },
  ];

  let answer = "";
  for await (const delta of chatClient.chatStream(messages)) {
    answer += delta;
    sendEvent("delta", { delta });
  }
  return answer;
}

export async function runOrchestratedChat(req: OrchestrationRequest): Promise<OrchestrationResult> {
  const startedAt = Date.now();
  const telemetry = {
    classificationMs: 0,
    planningMs: 0,
    retrievalMs: 0,
    toolExecutionMs: 0,
    firstProgressMs: 0,
    firstTokenMs: 0,
    totalMs: 0,
  };

  let firstProgressAt = 0;
  let firstTokenAt = 0;
  const trackedSendEvent = (event: string, data: unknown): void => {
    if (!firstProgressAt) {
      firstProgressAt = Date.now();
      telemetry.firstProgressMs = firstProgressAt - startedAt;
    }
    if (event === "delta" && !firstTokenAt) {
      firstTokenAt = Date.now();
      telemetry.firstTokenMs = firstTokenAt - startedAt;
    }
    req.sendEvent(event, data);
  };

  const classificationStart = Date.now();
  const explicitMemory = req.allowDirectMemoryActions !== false && isMemoryEnabled() && (
    extractExplicitMemoryRequest(req.query)
    || LIST_MEMORY_RE.test(req.query)
    || DELETE_MEMORY_RE.test(req.query.trim())
    || UPDATE_MEMORY_RE.test(req.query.trim())
  );
  const explicitAction = req.toolContext.allowMutations !== false
    ? buildActionProposal(extractMutableActionRequest(req.query) ?? null, req.session)
    : null;
  const explicitDocument = req.toolContext.allowMutations !== false
    ? extractExplicitDocumentRequest(req.query)
    : null;
  const hasDatasets = !req.skipSearch && req.search.datasetNames.length > 0;
  const mode: OrchestrationMode = explicitMemory
    ? "memory_action"
    : explicitAction
      ? "document_action"
    : explicitDocument
      ? "document_action"
    : isSimpleSmallTalk(req.query)
      ? "direct_chat"
      : req.allowToolPlanning && needsPlannedExecution(req.query)
        ? "planned_tool_execution"
        : prefersNaturalChat(req.query)
          ? "direct_chat"
          : prefersGroundedKnowledge(req.query, hasDatasets)
          ? "rag_answer"
          : "direct_chat";
  telemetry.classificationMs = Date.now() - classificationStart;

  if (mode === "memory_action") {
    const direct = await executeDirectMemoryAction(req.query, req.toolContext);
    trackedSendEvent("plan", { mode, executionPlan: direct.executionPlan });
    const answer = direct.answer;
    trackedSendEvent("delta", { delta: answer });
    telemetry.totalMs = Date.now() - startedAt;
    logger.info({ label: req.label, mode, telemetry }, "Orchestrated chat completed");
    return {
      answer,
      citations: [],
      hasConfidentAnswer: true,
      answerType: "general",
      executionPlan: direct.executionPlan,
      ...(req.collectTelemetry && { mode, telemetry }),
    };
  }

  if (mode === "document_action") {
    if (explicitAction) {
      const executionPlan: ExecutionChecklistItem[] = [{
        id: "confirm-action",
        title: explicitAction.title,
        status: "planned",
        tool: explicitAction.tool,
        summary: "Waiting for confirmation",
      }];
      trackedSendEvent("plan", { mode, executionPlan });
      trackedSendEvent("delta", { delta: "I can do that. Review the details below and confirm." });
      telemetry.totalMs = Date.now() - startedAt;
      logger.info({ label: req.label, mode, telemetry }, "Orchestrated chat completed");
      return {
        answer: "I can do that. Review the details below and confirm.",
        citations: [],
        hasConfidentAnswer: true,
        answerType: "general",
        executionPlan,
        actionProposal: explicitAction,
        ...(req.collectTelemetry && { mode, telemetry }),
      };
    }
    const direct = await executeDirectDocumentAction(req.query, req.session, req.toolContext);
    trackedSendEvent("plan", { mode, executionPlan: direct.executionPlan });
    trackedSendEvent("delta", { delta: direct.answer });
    telemetry.totalMs = Date.now() - startedAt;
    logger.info({ label: req.label, mode, telemetry }, "Orchestrated chat completed");
    return {
      answer: direct.answer,
      citations: [],
      hasConfidentAnswer: true,
      answerType: "general",
      executionPlan: direct.executionPlan,
      ...(req.collectTelemetry && { mode, telemetry }),
    };
  }

  if (mode === "direct_chat") {
    trackedSendEvent("plan", {
      mode,
      executionPlan: [{ id: "respond", title: "Respond directly", status: "completed", summary: "No retrieval or tool execution needed" }],
    });
    const direct = await streamDirectChat(req.query, req.session, req.memoryContextBlock, trackedSendEvent);
    telemetry.totalMs = Date.now() - startedAt;
    logger.info({ label: req.label, mode, telemetry }, "Orchestrated chat completed");
    return {
      ...direct,
      ...(req.collectTelemetry && { mode, telemetry }),
    };
  }

  if (mode === "rag_answer") {
    trackedSendEvent("plan", {
      mode,
      executionPlan: [{ id: "retrieve", title: "Search internal knowledge", status: "planned" }],
    });
    const retrievalStart = Date.now();
    const initialSearch = await req.search.execute(req.query);
    telemetry.retrievalMs = Date.now() - retrievalStart;
    trackedSendEvent("plan_step", { id: "retrieve", title: "Search internal knowledge", status: "completed", summary: `${initialSearch.results.length} results` });

    let final: AnswerResponse | undefined;
    const ragSession: Session = req.memoryContextBlock
      ? {
          ...req.session,
          messages: [{ role: "system", content: req.memoryContextBlock }, ...req.session.messages],
        }
      : req.session;

    if (isConciseLookupQuery(req.query)) {
      const concise = await streamConciseGroundedAnswer(
        req.query,
        req.session,
        initialSearch.results,
        req.strict,
        req.memoryContextBlock,
        trackedSendEvent,
      );
      telemetry.totalMs = Date.now() - startedAt;
      logger.info({ label: req.label, mode, telemetry }, "Orchestrated chat completed");

      return {
        answer: concise.answer,
        citations: concise.citations,
        hasConfidentAnswer: concise.hasConfidentAnswer,
        answerType: concise.answerType,
        ...(concise.retrievalScore != null && { retrievalScore: concise.retrievalScore }),
        ...((initialSearch.meshNodesSearched ?? 0) > 0 && { meshNodesSearched: initialSearch.meshNodesSearched ?? 0 }),
        ...((initialSearch.meshNodesUnavailable ?? 0) > 0 && { meshNodesUnavailable: initialSearch.meshNodesUnavailable ?? 0 }),
        ...(initialSearch.results.length > 0 && { searchResults: initialSearch.results }),
        executionPlan: [{ id: "retrieve", title: "Search internal knowledge", status: "completed", summary: `${initialSearch.results.length} results` }],
        ...(req.collectTelemetry && { mode, telemetry }),
      };
    }

    const stream = answerStream(
      req.query,
      ragSession,
      {
        datasetName: req.search.datasetName ?? req.search.datasetNames[0] ?? "knowledge-base",
        datasetNames: req.search.datasetNames,
        topK: 10,
        similarityThreshold: 0.3,
        candidateCount: initialSearch.candidateCount,
        hybridBoost: initialSearch.hybridBoost,
        strict: req.strict,
        decompose: req.search.useDecompose,
        rerank: req.search.useRerank,
        iterativeRetrieval: req.search.useIterativeRetrieval,
      },
      {
        search: async (queryText) => (await req.search.execute(queryText)).results,
        generate: (messages) => chatClient.chatStream(
          messages,
          isConciseLookupQuery(req.query)
            ? { maxTokens: 220, temperature: 0.15 }
            : undefined,
        ),
      },
    );

    for await (const chunk of stream) {
      if (chunk.delta) trackedSendEvent("delta", { delta: chunk.delta });
      if (chunk.final) final = chunk.final;
    }

    telemetry.totalMs = Date.now() - startedAt;
    logger.info({ label: req.label, mode, telemetry }, "Orchestrated chat completed");

    return {
      answer: final?.answer ?? "",
      citations: final?.citations ?? [],
      hasConfidentAnswer: final?.hasConfidentAnswer ?? false,
      answerType: final?.answerType ?? "general",
      ...(final?.contextUsage && { contextUsage: final.contextUsage }),
      ...(final?.retrievalScore != null && { retrievalScore: final.retrievalScore }),
      ...((initialSearch.meshNodesSearched ?? 0) > 0 && { meshNodesSearched: initialSearch.meshNodesSearched ?? 0 }),
      ...((initialSearch.meshNodesUnavailable ?? 0) > 0 && { meshNodesUnavailable: initialSearch.meshNodesUnavailable ?? 0 }),
      ...(initialSearch.results.length > 0 && { searchResults: initialSearch.results }),
      executionPlan: [{ id: "retrieve", title: "Search internal knowledge", status: "completed", summary: `${initialSearch.results.length} results` }],
      ...(req.collectTelemetry && { mode, telemetry }),
    };
  }

  const planningStart = Date.now();
  const plan = await generatePlan(req.query, req);
  telemetry.planningMs = Date.now() - planningStart;

  const initialPlan = buildExecutionPlan(plan.checklist);
  emitPlanEvent(trackedSendEvent, initialPlan, "planned_tool_execution");

  const toolExecutionStart = Date.now();
  const { toolUses, executionPlan, taskResults } = await executePlannedTasks(plan.checklist, { ...req, sendEvent: trackedSendEvent });
  telemetry.toolExecutionMs = Date.now() - toolExecutionStart;

  const answer = await streamPlannedSynthesis(
    req.query,
    req.session,
    plan,
    executionPlan,
    toolUses,
    taskResults,
    req.memoryContextBlock,
    trackedSendEvent,
  );

  telemetry.totalMs = Date.now() - startedAt;
  logger.info({ label: req.label, mode, telemetry }, "Orchestrated chat completed");

  return {
    answer,
    citations: [],
    hasConfidentAnswer: true,
    answerType: toolUses.some((tool) => tool.name === "search_knowledge" || tool.name === "web_search" || tool.name === "read_url") ? "grounded" : "general",
    toolUses,
    executionPlan,
    ...(req.collectTelemetry && { mode, telemetry }),
  };
}
