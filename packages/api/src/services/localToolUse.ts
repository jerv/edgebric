/**
 * Local Tool Use — lets capable models call tools during chat.
 *
 * Available tools:
 * - search_knowledge(query, sourceIds?) — search Edgebric sources
 * - list_sources() — list available data sources
 *
 * Only enabled when model capability toolUse: true (stub returns false for now).
 */
import { routedSearch } from "./queryRouter.js";
import { listDataSources } from "./dataSourceStore.js";
import { logger } from "../lib/logger.js";

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export const AVAILABLE_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_knowledge",
      description: "Search Edgebric knowledge sources for relevant information. Returns matching document chunks with citations.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          sourceIds: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of source IDs to search. Omit to search all accessible sources.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_sources",
      description: "List all available Edgebric data sources with their names and document counts.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

/**
 * Execute a tool call and return the result as a string.
 */
export async function executeToolCall(
  toolCall: ToolCall,
  opts: { datasetNames: string[]; orgId?: string },
): Promise<string> {
  const { name, arguments: argsStr } = toolCall.function;

  try {
    switch (name) {
      case "search_knowledge": {
        const args = JSON.parse(argsStr) as { query: string; sourceIds?: string[] };
        const targetDatasets = args.sourceIds
          ? opts.datasetNames.filter((_, _i) => {
              // Filter by source IDs if provided (simplified — in practice would map IDs to datasets)
              return true;
            })
          : opts.datasetNames;

        const { results } = await routedSearch(targetDatasets, args.query, 10);
        if (results.length === 0) {
          return "No relevant results found.";
        }

        return results.slice(0, 5).map((r, i) => {
          const docName = r.metadata.documentName ?? r.metadata.sourceDocument;
          const section = r.metadata.sectionPath?.join(" > ") ?? r.metadata.heading ?? "";
          return `[${i + 1}] ${docName}${section ? ` — ${section}` : ""}\n${r.chunk}`;
        }).join("\n\n---\n\n");
      }

      case "list_sources": {
        const sources = opts.orgId ? listDataSources({ type: "organization", orgId: opts.orgId }) : listDataSources({ type: "organization" });
        if (sources.length === 0) return "No data sources available.";
        return sources.map((s) => `- ${s.name} (${s.documentCount} documents)`).join("\n");
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    logger.error({ err, toolName: name }, "Tool execution failed");
    return `Tool execution failed: ${err instanceof Error ? err.message : "unknown error"}`;
  }
}

/**
 * Build tool-use system prompt addition.
 * Only called when toolUse capability is true.
 */
export function getToolUseSystemPrompt(): string {
  return `You have access to the following tools to help answer questions:

1. search_knowledge(query, sourceIds?) — Search the knowledge base for relevant information.
2. list_sources() — List all available data sources.

When you need to look up information, use these tools by outputting a JSON tool call in this format:
{"tool_call": {"name": "tool_name", "arguments": {...}}}

After receiving tool results, synthesize the information into a helpful answer with citations.`;
}
