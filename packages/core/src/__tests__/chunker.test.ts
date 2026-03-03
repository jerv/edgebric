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
});
