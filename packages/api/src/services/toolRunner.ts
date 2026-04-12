/**
 * Tool Runner — Framework for local model tool use.
 *
 * Defines a Tool interface, maintains a tool registry, validates arguments,
 * executes tools, and builds OpenAI-compatible tool definitions for llama-server.
 */
import { logger } from "../lib/logger.js";
import { recordAuditEvent } from "./auditLog.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
  default?: unknown;
}

export interface ToolParameters {
  type: "object";
  properties: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolContext {
  userEmail: string;
  isAdmin: boolean;
  orgId?: string | undefined;
  allowedSourceIds?: string[] | undefined;
  allowWeb?: boolean | undefined;
  allowMutations?: boolean | undefined;
}

export interface ToolExecutionMetadata {
  mutating: boolean;
  parallelSafe: boolean;
  dependencyClass: "knowledge" | "web" | "memory" | "management";
  resultShape: "search_results" | "document_list" | "source_list" | "memory_list" | "mutation_result" | "web_page" | "generic";
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  execution: ToolExecutionMetadata;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

// ─── Registry ───────────────────────────────────────────────────────────────

const registry = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  if (registry.has(tool.name)) {
    logger.warn({ tool: tool.name }, "Tool already registered, overwriting");
  }
  registry.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return registry.get(name);
}

export function listTools(): Tool[] {
  return [...registry.values()];
}

export function getToolExecutionMetadata(name: string): ToolExecutionMetadata | undefined {
  return registry.get(name)?.execution;
}

/** Clear all registered tools. For testing only. */
export function clearTools(): void {
  registry.clear();
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate tool arguments against the tool's parameter schema.
 * Lightweight check: verifies required fields exist and types match.
 */
function validateArgs(args: Record<string, unknown>, params: ToolParameters): string | null {
  // Check required fields
  for (const req of params.required ?? []) {
    if (args[req] === undefined || args[req] === null) {
      return `Missing required parameter: ${req}`;
    }
  }

  // Check types for provided fields
  for (const [key, value] of Object.entries(args)) {
    const schema = params.properties[key];
    if (!schema) continue; // Extra fields are ignored

    if (value === undefined || value === null) continue;

    const expectedType = schema.type;
    if (expectedType === "string" && typeof value !== "string") {
      return `Parameter '${key}' must be a string`;
    }
    if (expectedType === "number" && typeof value !== "number") {
      return `Parameter '${key}' must be a number`;
    }
    if (expectedType === "integer" && (typeof value !== "number" || !Number.isInteger(value))) {
      return `Parameter '${key}' must be an integer`;
    }
    if (expectedType === "boolean" && typeof value !== "boolean") {
      return `Parameter '${key}' must be a boolean`;
    }
    if (expectedType === "array" && !Array.isArray(value)) {
      return `Parameter '${key}' must be an array`;
    }
  }

  return null;
}

// ─── Execution ──────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = registry.get(name);
  if (!tool) {
    return { success: false, error: `Unknown tool: ${name}` };
  }

  if (tool.execution.mutating && ctx.allowMutations === false) {
    return { success: false, error: "This action is not allowed in the current chat context" };
  }

  if (tool.execution.dependencyClass === "web" && ctx.allowWeb === false) {
    return { success: false, error: "Web access is disabled in the current chat context" };
  }

  const validationError = validateArgs(args, tool.parameters);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const start = Date.now();
    const result = await tool.execute(args, ctx);
    const elapsed = Date.now() - start;

    logger.info({ tool: name, elapsed, success: result.success }, "Tool executed");

    recordAuditEvent({
      eventType: "tool.execute",
      actorEmail: ctx.userEmail,
      details: { tool: name, elapsed, success: result.success },
    });

    return result;
  } catch (err) {
    logger.error({ err, tool: name }, "Tool execution failed");
    return {
      success: false,
      error: err instanceof Error ? err.message : "Tool execution failed",
    };
  }
}

// ─── OpenAI-Compatible Tool Definitions ─────────────────────────────────────

/**
 * Build an OpenAI-compatible tools array for llama-server's /v1/chat/completions.
 */
export function buildToolDefinitions(): Array<{
  type: "function";
  function: { name: string; description: string; parameters: ToolParameters };
}> {
  return listTools().map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Parse tool calls from an OpenAI-compatible chat completion response message.
 */
export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export function parseToolCalls(
  message: { tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> | undefined },
): ParsedToolCall[] {
  if (!message.tool_calls || message.tool_calls.length === 0) return [];

  return message.tool_calls.map((tc) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments);
    } catch {
      logger.warn({ toolCallId: tc.id }, "Failed to parse tool call arguments");
    }
    return {
      id: tc.id,
      name: tc.function.name,
      arguments: args,
    };
  });
}
