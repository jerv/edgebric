/**
 * Memory Tools — tools for the LLM to save, list, and delete user memories.
 */
import type { Tool, ToolResult } from "../toolRunner.js";
import { registerTool } from "../toolRunner.js";
import {
  saveMemory,
  listMemories,
  deleteMemory,
  isMemoryEnabled,
} from "../memoryStore.js";
import type { MemoryCategory } from "../memoryStore.js";

// ─── save_memory ──────────────────────────────────────────────────────────────

const saveMemoryTool: Tool = {
  name: "save_memory",
  description:
    "Save a fact, preference, or instruction about the user for future conversations. Use when the user asks you to remember something.",
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The memory text to save (e.g. 'User prefers PDF format for exports')",
      },
      category: {
        type: "string",
        description: "Category: 'preference' (likes/dislikes), 'fact' (about the user), or 'instruction' (how to behave)",
        enum: ["preference", "fact", "instruction"],
      },
    },
    required: ["content", "category"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!isMemoryEnabled()) {
      return { success: false, error: "Memory is disabled" };
    }

    const content = args["content"] as string;
    const category = args["category"] as MemoryCategory;

    if (content.length > 500) {
      return { success: false, error: "Memory content too long (max 500 characters)" };
    }

    const entry = await saveMemory({
      content,
      category,
      confidence: 1.0,
      source: "explicit",
      orgId: ctx.orgId,
      userId: ctx.userEmail,
    });

    return {
      success: true,
      data: { id: entry.id, content: entry.content, category: entry.category },
    };
  },
};

// ─── list_memories ────────────────────────────────────────────────────────────

const listMemoriesTool: Tool = {
  name: "list_memories",
  description: "List saved memories about the current user. Returns recent preferences, facts, and instructions.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "Optional: filter by category",
        enum: ["preference", "fact", "instruction"],
      },
    },
    required: [],
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!isMemoryEnabled()) {
      return { success: false, error: "Memory is disabled" };
    }

    const category = args["category"] as MemoryCategory | undefined;
    let memories = listMemories(ctx.orgId, ctx.userEmail);

    if (category) {
      memories = memories.filter((m) => m.category === category);
    }

    // Limit to 20 most recent
    const recent = memories.slice(0, 20).map((m) => ({
      id: m.id,
      content: m.content,
      category: m.category,
      confidence: m.confidence,
      source: m.source,
      createdAt: m.createdAt.toISOString(),
    }));

    return {
      success: true,
      data: { count: recent.length, memories: recent },
    };
  },
};

// ─── delete_memory ────────────────────────────────────────────────────────────

const deleteMemoryTool: Tool = {
  name: "delete_memory",
  description: "Delete a saved memory by ID.",
  parameters: {
    type: "object",
    properties: {
      memoryId: {
        type: "string",
        description: "The ID of the memory to delete",
      },
    },
    required: ["memoryId"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!isMemoryEnabled()) {
      return { success: false, error: "Memory is disabled" };
    }

    const memoryId = args["memoryId"] as string;
    const deleted = deleteMemory(memoryId, ctx.orgId, ctx.userEmail);

    if (!deleted) {
      return { success: false, error: "Memory not found" };
    }

    return { success: true, data: { deleted: memoryId } };
  },
};

// ─── Register All Memory Tools ────────────────────────────────────────────────

export function registerMemoryTools(): void {
  registerTool(saveMemoryTool);
  registerTool(listMemoriesTool);
  registerTool(deleteMemoryTool);
}
