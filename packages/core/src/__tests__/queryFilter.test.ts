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
      expect(filterQuery(query).allowed).toBe(true);
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
      expect(result.redirectMessage).toBeTruthy();
    }
  });

  it("allows sensitive terms without a person name", () => {
    const cases = [
      "What is the company salary band policy?",
      "How does a PIP work?",
      "What are the termination procedures?",
    ];
    for (const query of cases) {
      expect(filterQuery(query).allowed).toBe(true);
    }
  });

  it("allows person names without sensitive terms", () => {
    const result = filterQuery("Can I contact John Smith in HR about my benefits?");
    // This is a borderline case — asking to contact someone is fine
    // Our filter only blocks name + sensitive term combos
    // "benefits" is not in the sensitive terms list
    expect(result.allowed).toBe(true);
  });
});
