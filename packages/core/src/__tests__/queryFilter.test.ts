import { describe, it, expect } from "vitest";
import { filterQuery } from "../rag/queryFilter.js";

describe("filterQuery", () => {
  it("allows normal policy questions", () => {
    const cases = [
      "How much PTO do I get?",
      "What is the remote work policy?",
      "When does health insurance kick in for new employees?",
      "What's the process for requesting parental leave?",
    ];
    for (const query of cases) {
      const result = filterQuery(query);
      expect(result.allowed).toBe(true);
      expect(result).not.toHaveProperty("reason");
      expect(result).not.toHaveProperty("redirectMessage");
    }
  });

  it("blocks queries with person name + sensitive term", () => {
    const cases = [
      "What is John Smith's salary?",
      "Is Sarah Lee on a PIP?",
      "Was Michael Johnson terminated?",
      "What is David's compensation?",
    ];
    for (const query of cases) {
      const result = filterQuery(query);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("person_name_sensitive_term");
      expect(typeof result.redirectMessage).toBe("string");
      expect(result.redirectMessage!.length).toBeGreaterThan(20);
    }
  });

  it("allows sensitive terms without a person name", () => {
    const cases = [
      "What is the company salary band policy?",
      "How does a PIP work?",
      "What are the termination procedures?",
      "What is the disability accommodation process?",
      "How are harassment complaints handled?",
    ];
    for (const query of cases) {
      expect(filterQuery(query).allowed).toBe(true);
    }
  });

  it("allows person names without sensitive terms", () => {
    const result = filterQuery("Can I contact John Smith in HR about my benefits?");
    expect(result.allowed).toBe(true);
  });

  it("blocks possessive name forms with sensitive terms", () => {
    // "David's" triggers looksLikePersonName via the 's pattern
    const result = filterQuery("What is David's compensation?");
    expect(result.allowed).toBe(false);
  });

  it("handles empty and whitespace-only queries", () => {
    expect(filterQuery("").allowed).toBe(true);
    expect(filterQuery("   ").allowed).toBe(true);
  });

  it("blocks various sensitive term categories", () => {
    // Each SENSITIVE_TERMS category with a name
    const blocked = [
      "Tell me about John Smith's disciplinary record",
      "Was Sarah Lee laid off?",
      "Is Michael Johnson under investigation?",
      "What is Jane Doe's social security number?",
      "When was Tom Brown's suspension?",
    ];
    for (const query of blocked) {
      expect(filterQuery(query).allowed).toBe(false);
    }
  });
});
