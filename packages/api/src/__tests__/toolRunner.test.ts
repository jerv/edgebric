import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import {
  registerTool,
  getTool,
  listTools,
  clearTools,
  executeTool,
  buildToolDefinitions,
  parseToolCalls,
} from "../services/toolRunner.js";
import type { Tool, ToolContext } from "../services/toolRunner.js";
import { setupTestApp, teardownTestApp } from "./helpers.js";

const defaultExecution: Tool["execution"] = {
  mutating: false,
  parallelSafe: true,
  dependencyClass: "knowledge",
  resultShape: "generic",
};

const testCtx: ToolContext = {
  userEmail: "user@test.com",
  isAdmin: false,
  orgId: "org-1",
};

const echoTool: Tool = {
  name: "echo",
  description: "Returns the input message",
  execution: defaultExecution,
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "Message to echo" },
    },
    required: ["message"],
  },
  execute: async (args) => ({ success: true, data: { echoed: args["message"] } }),
};

const mathTool: Tool = {
  name: "add",
  description: "Adds two numbers",
  execution: defaultExecution,
  parameters: {
    type: "object",
    properties: {
      a: { type: "number", description: "First number" },
      b: { type: "number", description: "Second number" },
    },
    required: ["a", "b"],
  },
  execute: async (args) => ({
    success: true,
    data: { result: (args["a"] as number) + (args["b"] as number) },
  }),
};

describe("Tool Runner", () => {
  beforeAll(() => { setupTestApp(); });
  afterAll(() => { teardownTestApp(); });
  beforeEach(() => { clearTools(); });

  // ─── Registration ───────────────────────────────────────────────────────

  describe("registration", () => {
    it("registers and retrieves a tool", () => {
      registerTool(echoTool);
      const tool = getTool("echo");
      expect(tool).toBeDefined();
      expect(tool!.name).toBe("echo");
      expect(tool!.description).toBe("Returns the input message");
    });

    it("lists all registered tools", () => {
      registerTool(echoTool);
      registerTool(mathTool);
      const tools = listTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name).sort()).toEqual(["add", "echo"]);
    });

    it("returns undefined for unknown tools", () => {
      expect(getTool("nonexistent")).toBeUndefined();
    });

    it("overwrites tool with same name", () => {
      registerTool(echoTool);
      const modified: Tool = { ...echoTool, description: "Modified echo" };
      registerTool(modified);
      expect(listTools()).toHaveLength(1);
      expect(getTool("echo")!.description).toBe("Modified echo");
    });

    it("clears all tools", () => {
      registerTool(echoTool);
      registerTool(mathTool);
      clearTools();
      expect(listTools()).toHaveLength(0);
    });
  });

  // ─── Execution ──────────────────────────────────────────────────────────

  describe("execution", () => {
    it("executes a tool successfully", async () => {
      registerTool(echoTool);
      const result = await executeTool("echo", { message: "hello" }, testCtx);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ echoed: "hello" });
    });

    it("returns error for unknown tool", async () => {
      const result = await executeTool("nonexistent", {}, testCtx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Unknown tool/);
    });

    it("validates required parameters", async () => {
      registerTool(echoTool);
      const result = await executeTool("echo", {}, testCtx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Missing required parameter: message/);
    });

    it("validates parameter types", async () => {
      registerTool(mathTool);
      const result = await executeTool("add", { a: "not a number", b: 2 }, testCtx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/must be a number/);
    });

    it("catches tool execution errors", async () => {
      const errorTool: Tool = {
        name: "error_tool",
        description: "Always throws",
        execution: defaultExecution,
        parameters: { type: "object", properties: {}, required: [] },
        execute: async () => { throw new Error("Intentional error"); },
      };
      registerTool(errorTool);
      const result = await executeTool("error_tool", {}, testCtx);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Intentional error");
    });

    it("passes context to tool", async () => {
      const ctxTool: Tool = {
        name: "ctx_tool",
        description: "Returns context",
        execution: defaultExecution,
        parameters: { type: "object", properties: {}, required: [] },
        execute: async (_args, ctx) => ({
          success: true,
          data: { email: ctx.userEmail, isAdmin: ctx.isAdmin },
        }),
      };
      registerTool(ctxTool);
      const result = await executeTool("ctx_tool", {}, testCtx);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ email: "user@test.com", isAdmin: false });
    });

    it("allows extra parameters (ignored)", async () => {
      registerTool(echoTool);
      const result = await executeTool("echo", { message: "hi", extra: "ignored" }, testCtx);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ echoed: "hi" });
    });

    it("validates array type", async () => {
      const arrayTool: Tool = {
        name: "array_tool",
        description: "Takes an array",
        execution: defaultExecution,
        parameters: {
          type: "object",
          properties: { items: { type: "array", items: { type: "string" } } },
          required: ["items"],
        },
        execute: async (args) => ({ success: true, data: args }),
      };
      registerTool(arrayTool);

      const good = await executeTool("array_tool", { items: ["a", "b"] }, testCtx);
      expect(good.success).toBe(true);

      const bad = await executeTool("array_tool", { items: "not-array" }, testCtx);
      expect(bad.success).toBe(false);
      expect(bad.error).toMatch(/must be an array/);
    });

    it("validates boolean type", async () => {
      const boolTool: Tool = {
        name: "bool_tool",
        description: "Takes a boolean",
        execution: defaultExecution,
        parameters: {
          type: "object",
          properties: { flag: { type: "boolean" } },
          required: ["flag"],
        },
        execute: async (args) => ({ success: true, data: args }),
      };
      registerTool(boolTool);

      const good = await executeTool("bool_tool", { flag: true }, testCtx);
      expect(good.success).toBe(true);

      const bad = await executeTool("bool_tool", { flag: "yes" }, testCtx);
      expect(bad.success).toBe(false);
      expect(bad.error).toMatch(/must be a boolean/);
    });
  });

  // ─── Tool Definitions ───────────────────────────────────────────────────

  describe("buildToolDefinitions", () => {
    it("returns OpenAI-compatible tool definitions", () => {
      registerTool(echoTool);
      registerTool(mathTool);
      const defs = buildToolDefinitions();
      expect(defs).toHaveLength(2);
      expect(defs[0]!.type).toBe("function");
      expect(defs[0]!.function.name).toBe("echo");
      expect(defs[0]!.function.parameters.type).toBe("object");
      expect(defs[0]!.function.parameters.properties["message"]).toBeDefined();
    });

    it("returns empty array when no tools registered", () => {
      expect(buildToolDefinitions()).toEqual([]);
    });
  });

  // ─── parseToolCalls ─────────────────────────────────────────────────────

  describe("parseToolCalls", () => {
    it("parses valid tool calls", () => {
      const calls = parseToolCalls({
        tool_calls: [
          {
            id: "call_1",
            function: { name: "echo", arguments: '{"message":"hello"}' },
          },
        ],
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.id).toBe("call_1");
      expect(calls[0]!.name).toBe("echo");
      expect(calls[0]!.arguments).toEqual({ message: "hello" });
    });

    it("returns empty array for no tool calls", () => {
      expect(parseToolCalls({})).toEqual([]);
      expect(parseToolCalls({ tool_calls: [] })).toEqual([]);
    });

    it("handles malformed JSON arguments gracefully", () => {
      const calls = parseToolCalls({
        tool_calls: [
          { id: "call_1", function: { name: "echo", arguments: "invalid json" } },
        ],
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.arguments).toEqual({});
    });

    it("parses multiple tool calls", () => {
      const calls = parseToolCalls({
        tool_calls: [
          { id: "call_1", function: { name: "echo", arguments: '{"message":"a"}' } },
          { id: "call_2", function: { name: "add", arguments: '{"a":1,"b":2}' } },
        ],
      });
      expect(calls).toHaveLength(2);
      expect(calls[0]!.name).toBe("echo");
      expect(calls[1]!.name).toBe("add");
    });
  });
});
