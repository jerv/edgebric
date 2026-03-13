import { describe, it, expect } from "vitest";
import { buildSystemPrompt, NO_ANSWER_RESPONSE, buildNoAnswerResponse } from "../rag/systemPrompt.js";
import type { Chunk } from "@edgebric/types";

function makeChunk(content: string, opts?: Partial<Chunk["metadata"]>): Chunk {
  return {
    id: "chunk-1",
    documentId: "doc-1",
    content,
    metadata: {
      sourceDocument: "doc-1",
      documentName: "Employee Handbook",
      sectionPath: ["Benefits", "Health Insurance"],
      pageNumber: 5,
      heading: "Health Insurance",
      chunkIndex: 0,
      ...opts,
    },
  };
}

describe("buildSystemPrompt", () => {
  it("includes context from chunks with source labels", () => {
    const chunks = [makeChunk("Gold plan has a $500 deductible.")];
    const prompt = buildSystemPrompt(chunks);
    expect(prompt).toContain("[Source 1: Employee Handbook | Benefits > Health Insurance | Page 5]");
    expect(prompt).toContain("Gold plan has a $500 deductible.");
  });

  it("numbers multiple sources sequentially", () => {
    const chunks = [
      makeChunk("PTO accrual rate is 1.5 days/month.", {
        sectionPath: ["Time Off", "PTO"],
        pageNumber: 2,
      }),
      makeChunk("Sick leave is 5 days per year.", {
        sectionPath: ["Time Off", "Sick Leave"],
        pageNumber: 3,
      }),
    ];
    const prompt = buildSystemPrompt(chunks);
    expect(prompt).toContain("[Source 1:");
    expect(prompt).toContain("[Source 2:");
  });

  it("falls back to 'Policy Document' when documentName is missing", () => {
    const chunk = makeChunk("Some content");
    delete chunk.metadata.documentName;
    const prompt = buildSystemPrompt([chunk]);
    expect(prompt).toContain("Policy Document");
  });

  it("includes core rules about not using outside knowledge", () => {
    const prompt = buildSystemPrompt([makeChunk("test")]);
    expect(prompt).toContain("Answer ONLY using information from the provided context");
    expect(prompt).toContain("Do not use outside knowledge");
  });

  it("includes rule about not revealing personal information", () => {
    const prompt = buildSystemPrompt([makeChunk("test")]);
    expect(prompt).toContain("Never reveal information about named individuals");
  });

  it("includes rule about not including source citations in answer", () => {
    const prompt = buildSystemPrompt([makeChunk("test")]);
    expect(prompt).toContain("Do NOT include source citations");
  });
});

describe("NO_ANSWER_RESPONSE", () => {
  it("is a non-empty string", () => {
    expect(NO_ANSWER_RESPONSE.length).toBeGreaterThan(0);
  });

  it("mentions contacting administrator", () => {
    expect(NO_ANSWER_RESPONSE).toContain("contact");
  });
});

describe("buildNoAnswerResponse", () => {
  it("returns default response when no targets provided", () => {
    expect(buildNoAnswerResponse()).toBe(NO_ANSWER_RESPONSE);
    expect(buildNoAnswerResponse([])).toBe(NO_ANSWER_RESPONSE);
  });

  it("includes escalation target names when provided", () => {
    const response = buildNoAnswerResponse(["HR Manager", "IT Support"]);
    expect(response).toContain("HR Manager");
    expect(response).toContain("IT Support");
    expect(response).toContain("escalate");
  });

  it("handles single target", () => {
    const response = buildNoAnswerResponse(["Jane Doe"]);
    expect(response).toContain("Jane Doe");
  });
});
