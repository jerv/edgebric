import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildGeneralPrompt, NO_ANSWER_RESPONSE } from "../rag/systemPrompt.js";
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

describe("buildSystemPrompt (permissive — default)", () => {
  it("includes context from chunks with source labels", () => {
    const chunks = [makeChunk("Gold plan has a $500 deductible.")];
    const prompt = buildSystemPrompt(chunks);
    expect(prompt).toContain('<source index="1" document="Employee Handbook" section="Benefits > Health Insurance" page="5">');
    expect(prompt).toContain("Gold plan has a $500 deductible.");
    expect(prompt).toContain("</source>");
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
    expect(prompt).toContain('index="1"');
    expect(prompt).toContain('index="2"');
  });

  it("falls back to 'Policy Document' when documentName is missing", () => {
    const chunk = makeChunk("Some content");
    delete chunk.metadata.documentName;
    const prompt = buildSystemPrompt([chunk]);
    expect(prompt).toContain("Policy Document");
  });

  it("allows general knowledge supplementation", () => {
    const prompt = buildSystemPrompt([makeChunk("test")]);
    expect(prompt).toContain("general knowledge");
  });

  it("instructs inline [Source N] citation markers", () => {
    const prompt = buildSystemPrompt([makeChunk("test")]);
    expect(prompt).toContain("[Source N]");
  });

  it("includes rule about not revealing personal information", () => {
    const prompt = buildSystemPrompt([makeChunk("test")]);
    expect(prompt).toContain("Never reveal information about named individuals");
  });

  it("includes disclaimer about not being a professional advisor", () => {
    const prompt = buildSystemPrompt([makeChunk("test")]);
    expect(prompt).toContain("not a lawyer");
  });

  it("forbids a separate Sources section at the end", () => {
    const prompt = buildSystemPrompt([makeChunk("test")]);
    expect(prompt).toContain('Do NOT include a separate "Sources"');
  });
});

describe("buildSystemPrompt (strict)", () => {
  it("restricts to context-only answers", () => {
    const prompt = buildSystemPrompt([makeChunk("test")], { strict: true });
    expect(prompt).toContain("Answer ONLY using information from the provided context");
    expect(prompt).toContain("Do not use outside knowledge");
  });

  it("includes rule about not including source citations", () => {
    const prompt = buildSystemPrompt([makeChunk("test")], { strict: true });
    expect(prompt).toContain("Do NOT include source citations");
  });

  it("includes personal information protection rule", () => {
    const prompt = buildSystemPrompt([makeChunk("test")], { strict: true });
    expect(prompt).toContain("Never reveal information about named individuals");
  });
});

describe("buildGeneralPrompt", () => {
  it("instructs the model to use general knowledge", () => {
    const prompt = buildGeneralPrompt();
    expect(prompt).toContain("general knowledge");
  });

  it("forbids fabricating company-specific data", () => {
    const prompt = buildGeneralPrompt();
    expect(prompt).toContain("Never fabricate company-specific");
  });

  it("includes disclaimer", () => {
    const prompt = buildGeneralPrompt();
    expect(prompt).toContain("not a lawyer");
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
