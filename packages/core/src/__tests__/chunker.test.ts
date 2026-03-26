import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "../ingestion/chunker.js";

const SAMPLE_POLICY = `# Employee Handbook

## Time Off

### PTO Policy

Employees accrue PTO at a rate of 1.5 days per month. After 12 months of employment, the accrual rate increases to 2 days per month.

Unused PTO may be carried over to the following calendar year up to a maximum of 10 days. Any balance above 10 days is forfeited at year end.

### Sick Leave

Employees receive 5 days of sick leave per calendar year. Sick leave does not roll over.

## Benefits

### Health Insurance

| Plan | Deductible (In-Network) | Deductible (Out-of-Network) | Monthly Premium |
|------|------------------------|----------------------------|-----------------|
| Gold | $500 | $1,500 | $150 |
| Silver | $1,000 | $3,000 | $100 |
| Bronze | $2,500 | $6,000 | $60 |

### Dental

The company covers 80% of preventive dental care.
`;

describe("chunkMarkdown", () => {
  it("produces chunks with valid UUIDs and metadata", () => {
    const chunks = chunkMarkdown(SAMPLE_POLICY, "doc-123");
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(chunk.documentId).toBe("doc-123");
      expect(chunk.content.length).toBeGreaterThan(0);
      expect(chunk.metadata.sectionPath.length).toBeGreaterThan(0);
    }
  });

  it("keeps tables as atomic chunks", () => {
    const chunks = chunkMarkdown(SAMPLE_POLICY, "doc-123");
    const tableChunk = chunks.find((c) => c.content.includes("|") && c.content.includes("Gold"));
    expect(tableChunk).toBeDefined();
    // Table chunk should contain all rows
    expect(tableChunk?.content).toContain("Silver");
    expect(tableChunk?.content).toContain("Bronze");
  });

  it("assigns sequential chunkIndex values", () => {
    const chunks = chunkMarkdown(SAMPLE_POLICY, "doc-123");
    chunks.forEach((chunk, i) => {
      expect(chunk.metadata.chunkIndex).toBe(i);
    });
  });

  it("does not produce empty chunks", () => {
    const chunks = chunkMarkdown(SAMPLE_POLICY, "doc-123");
    for (const chunk of chunks) {
      expect(chunk.content.trim().length).toBeGreaterThan(0);
    }
  });

  it("handles empty input gracefully", () => {
    const chunks = chunkMarkdown("", "doc-123");
    expect(chunks).toHaveLength(0);
  });

  it("builds correct sectionPath for nested headings", () => {
    const md = `# Company
## HR
### PTO
Employees get 15 days PTO per year. This accrues monthly at a standard rate across all departments and locations.
### Sick Leave
Employees receive 5 sick days per year. Unused sick days do not carry over to the following calendar year.
## Engineering
### Code Review
All code must be reviewed by at least one peer before merging to main branches. Reviews should happen within 24 hours.
`;
    const chunks = chunkMarkdown(md, "doc-1");
    const ptoChunk = chunks.find((c) => c.content.includes("15 days PTO"));
    const sickChunk = chunks.find((c) => c.content.includes("5 sick days"));
    const codeChunk = chunks.find((c) => c.content.includes("code must be reviewed"));

    expect(ptoChunk).toBeDefined();
    expect(ptoChunk!.metadata.sectionPath).toEqual(["Company", "HR", "PTO"]);
    expect(ptoChunk!.metadata.heading).toBe("PTO");

    expect(sickChunk).toBeDefined();
    expect(sickChunk!.metadata.sectionPath).toEqual(["Company", "HR", "Sick Leave"]);

    expect(codeChunk).toBeDefined();
    expect(codeChunk!.metadata.sectionPath).toEqual(["Company", "Engineering", "Code Review"]);
  });

  it("merges adjacent tiny chunks from the same section", () => {
    // Two short lines under the same heading — should merge
    const md = `## Policy
Short line one.
Short line two.
`;
    const chunks = chunkMarkdown(md, "doc-1");
    // Both tiny chunks from same section should be merged into one
    const policyChunks = chunks.filter((c) =>
      c.content.includes("Short line"),
    );
    expect(policyChunks).toHaveLength(1);
    expect(policyChunks[0]!.content).toContain("Short line one");
    expect(policyChunks[0]!.content).toContain("Short line two");
  });

  it("does not merge tiny chunks from different sections", () => {
    const md = `## Section A
Tiny A.
## Section B
Tiny B.
`;
    const chunks = chunkMarkdown(md, "doc-1");
    const aChunk = chunks.find((c) => c.content.includes("Tiny A"));
    const bChunk = chunks.find((c) => c.content.includes("Tiny B"));
    // Should remain separate despite both being tiny
    expect(aChunk).toBeDefined();
    expect(bChunk).toBeDefined();
    expect(aChunk!.id).not.toBe(bChunk!.id);
    expect(aChunk!.metadata.heading).toBe("Section A");
    expect(bChunk!.metadata.heading).toBe("Section B");
  });

  it("sets parentContent on child chunks", () => {
    const chunks = chunkMarkdown(SAMPLE_POLICY, "doc-123");
    for (const chunk of chunks) {
      // Every chunk should have parentContent set
      expect(chunk.metadata.parentContent).toBeDefined();
      expect(typeof chunk.metadata.parentContent).toBe("string");
      expect(chunk.metadata.parentContent!.length).toBeGreaterThan(0);
    }
  });

  it("handles content before any heading", () => {
    const md = `This is content before any heading.

It should still be chunked properly even without a header above it in the document.

## Section One
Content under section one that should be its own chunk with proper heading metadata set.
`;
    const chunks = chunkMarkdown(md, "doc-1");
    expect(chunks.length).toBeGreaterThan(0);
    // First chunk should have empty heading since it's before any heading
    const preHeadingChunk = chunks.find((c) =>
      c.content.includes("before any heading"),
    );
    expect(preHeadingChunk).toBeDefined();
    expect(preHeadingChunk!.metadata.heading).toBe("");
  });

  it("splits large sections into multiple parent chunks", () => {
    // Generate a section larger than DEFAULT_PARENT_TOKENS (1024)
    // At ~4 chars per token, we need > 4096 chars
    const longContent = "This is a sentence with enough words to contribute to the total. ".repeat(100);
    const md = `## Large Section\n${longContent}`;
    const chunks = chunkMarkdown(md, "doc-1");
    // Should produce multiple chunks from one section
    expect(chunks.length).toBeGreaterThan(1);
    // All chunks should share the same heading
    for (const chunk of chunks) {
      expect(chunk.metadata.heading).toBe("Large Section");
    }
  });
});
