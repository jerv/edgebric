import { describe, it, expect } from "vitest";
import { detectPII } from "../ingestion/piiDetector.js";
import type { Chunk } from "@edgebric/types";

function makeChunk(content: string, index = 0): Chunk {
  return {
    id: `chunk-${index}`,
    documentId: "doc-1",
    content,
    metadata: {
      sourceDocument: "doc-1",
      sectionPath: ["Test"],
      pageNumber: 1,
      heading: "Test",
      chunkIndex: index,
    },
  };
}

describe("detectPII", () => {
  it("returns no warnings for clean policy text", () => {
    const chunks = [
      makeChunk("Employees accrue PTO at a rate of 1.5 days per month."),
      makeChunk("The company provides health insurance to all full-time employees."),
    ];
    expect(detectPII(chunks)).toHaveLength(0);
  });

  it("detects SSN patterns", () => {
    const chunks = [makeChunk("Employee SSN is 123-45-6789 on file.")];
    const warnings = detectPII(chunks);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.pattern).toContain("Social Security Number");
    expect(warnings[0]!.chunkIndex).toBe(0);
  });

  it("detects SSN without dashes", () => {
    const chunks = [makeChunk("SSN: 123 45 6789")];
    expect(detectPII(chunks)).toHaveLength(1);
  });

  it("detects salary figures", () => {
    const chunks = [makeChunk("John earns $85,000 per year.")];
    const warnings = detectPII(chunks);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => w.pattern.includes("dollar amounts"))).toBe(true);
  });

  it("detects hourly rate format", () => {
    const chunks = [makeChunk("The rate is $25.50/hr for contractors.")];
    const warnings = detectPII(chunks);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.pattern).toContain("dollar amounts");
  });

  it("detects person name + sensitive term co-occurrence", () => {
    const chunks = [makeChunk("Sarah Johnson was placed on a performance improvement plan.")];
    const warnings = detectPII(chunks);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.pattern).toContain("performance improvement");
  });

  it("does not flag person name without sensitive term", () => {
    const chunks = [makeChunk("Sarah Johnson will be attending the conference next week.")];
    expect(detectPII(chunks)).toHaveLength(0);
  });

  it("does not flag sensitive term without person name", () => {
    const chunks = [makeChunk("The company's termination policy requires two weeks notice.")];
    expect(detectPII(chunks)).toHaveLength(0);
  });

  it("produces at most one warning per chunk for regex patterns", () => {
    // Chunk has both SSN and salary — should produce one regex warning + possibly one name warning
    const chunks = [makeChunk("SSN 123-45-6789, salary $100,000/year")];
    const warnings = detectPII(chunks);
    // Only one regex pattern match per chunk (breaks after first)
    const regexWarnings = warnings.filter(
      (w) => w.pattern.includes("Social Security") || w.pattern.includes("dollar amounts"),
    );
    expect(regexWarnings).toHaveLength(1);
  });

  it("handles empty chunk array", () => {
    expect(detectPII([])).toHaveLength(0);
  });

  it("includes excerpt in warning", () => {
    const chunks = [makeChunk("Employee SSN is 123-45-6789 on file.")];
    const warnings = detectPII(chunks);
    expect(warnings[0]!.excerpt).toContain("123-45-6789");
  });

  it("truncates excerpt to 200 chars", () => {
    const longText = "SSN 123-45-6789 " + "x".repeat(300);
    const chunks = [makeChunk(longText)];
    const warnings = detectPII(chunks);
    expect(warnings[0]!.excerpt.length).toBeLessThanOrEqual(200);
  });
});
