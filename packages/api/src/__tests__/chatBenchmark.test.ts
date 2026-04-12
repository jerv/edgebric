import { describe, it, expect } from "vitest";
import { runChatBenchmarks } from "../benchmarks/runChatBenchmark.js";

describe("chat benchmark harness", () => {
  it("exports a callable benchmark runner", () => {
    expect(typeof runChatBenchmarks).toBe("function");
  });
});
