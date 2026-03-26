import { describe, it, expect } from "vitest";
import {
  detectAnswerType,
  extractCitationMarkers,
  validateMarkers,
} from "../rag/answerAnalysis.js";

// ─── detectAnswerType ─────────────────────────────────────────────────────────

describe("detectAnswerType", () => {
  it("returns 'general' when no context was provided", () => {
    expect(detectAnswerType("Any answer text here.", false)).toBe("general");
  });

  it("returns 'general' even if answer contains markers but had no context", () => {
    expect(
      detectAnswerType("According to [Source 1], the policy is clear.", false),
    ).toBe("general");
  });

  it("returns 'grounded' when all paragraphs have citation markers", () => {
    const answer = [
      "Employees receive 15 days of PTO per year [Source 1]. This includes both vacation and personal days.",
      "",
      "Health insurance coverage begins on the first day of employment [Source 2]. The company covers 80% of premiums.",
    ].join("\n\n");
    expect(detectAnswerType(answer, true)).toBe("grounded");
  });

  it("returns 'blended' when some paragraphs have markers and some don't", () => {
    const answer = [
      "The company offers a generous benefits package [Source 1]. This includes health, dental, and vision coverage.",
      "",
      "Generally speaking, most companies in the tech industry offer similar benefits to attract top talent. This is a common practice across the sector.",
    ].join("\n\n");
    expect(detectAnswerType(answer, true)).toBe("blended");
  });

  it("returns 'grounded' (conservative) when model uses no markers at all", () => {
    const answer =
      "The policy states that employees are entitled to 15 days of paid time off per year. This accrues at a rate of 1.25 days per month.";
    expect(detectAnswerType(answer, true)).toBe("grounded");
  });

  it("returns 'grounded' when answer is too short (no qualifying paragraphs)", () => {
    expect(detectAnswerType("Yes.", true)).toBe("grounded");
  });

  it("returns 'grounded' for empty answer with context", () => {
    expect(detectAnswerType("", true)).toBe("grounded");
  });

  it("skips short fragments (< 40 chars) when evaluating paragraphs", () => {
    const answer = [
      "# Benefits Overview", // short, skipped
      "",
      "The company provides comprehensive health insurance [Source 1]. Coverage includes dental and vision as well.",
      "",
      "## Additional Info", // short, skipped
      "",
      "This is general knowledge about workplace benefits that most employers provide as standard practice in modern companies.",
    ].join("\n\n");
    // Two qualifying paragraphs: one cited, one not → blended
    expect(detectAnswerType(answer, true)).toBe("blended");
  });

  it("handles [Source N] with varying whitespace", () => {
    const answer =
      "The policy covers this scenario [Source  1]. Employees should contact HR for specific questions about their individual coverage.";
    expect(detectAnswerType(answer, true)).toBe("grounded");
  });

  it("is case-insensitive for markers", () => {
    const answer =
      "According to the handbook [source 1], employees can work remotely up to three days per week with manager approval.";
    expect(detectAnswerType(answer, true)).toBe("grounded");
  });

  it("correctly counts multiple markers in one paragraph as one cited paragraph", () => {
    const answer = [
      "PTO accrues at 1.25 days per month [Source 1] and unused days roll over to the next year [Source 2]. This is a standard practice.",
      "",
      "The sick leave policy is entirely separate from PTO [Source 3]. Employees receive 5 sick days annually regardless of tenure.",
    ].join("\n\n");
    // Both paragraphs have markers → grounded
    expect(detectAnswerType(answer, true)).toBe("grounded");
  });
});

// ─── extractCitationMarkers ──────────────────────────────────────────────────

describe("extractCitationMarkers", () => {
  it("returns empty array for text with no markers", () => {
    expect(extractCitationMarkers("No citations here.")).toEqual([]);
  });

  it("extracts a single marker", () => {
    expect(
      extractCitationMarkers("The policy states [Source 1] that..."),
    ).toEqual([1]);
  });

  it("extracts multiple markers in order", () => {
    expect(
      extractCitationMarkers(
        "See [Source 3] and also [Source 1] for details.",
      ),
    ).toEqual([1, 3]);
  });

  it("deduplicates repeated markers", () => {
    expect(
      extractCitationMarkers(
        "[Source 2] says X. As mentioned in [Source 2], Y is also true.",
      ),
    ).toEqual([2]);
  });

  it("handles markers with varying whitespace", () => {
    expect(
      extractCitationMarkers("Check [Source  5] and [Source5] for info."),
    ).toEqual([5]);
  });

  it("is case-insensitive", () => {
    expect(
      extractCitationMarkers("[SOURCE 1] and [source 2] are both valid."),
    ).toEqual([1, 2]);
  });

  it("handles large source numbers", () => {
    expect(
      extractCitationMarkers("Ref [Source 42] in the appendix."),
    ).toEqual([42]);
  });

  it("returns sorted results regardless of input order", () => {
    expect(
      extractCitationMarkers(
        "[Source 10] then [Source 2] then [Source 7].",
      ),
    ).toEqual([2, 7, 10]);
  });

  it("ignores malformed markers", () => {
    expect(
      extractCitationMarkers("[Source] and [Source abc] are invalid."),
    ).toEqual([]);
  });
});

// ─── validateMarkers ─────────────────────────────────────────────────────────

describe("validateMarkers", () => {
  it("returns answer unchanged when all markers are valid", () => {
    const answer = "Policy says [Source 1] and [Source 2] confirm this.";
    expect(validateMarkers(answer, 3)).toBe(answer);
  });

  it("strips markers that exceed citation count", () => {
    const answer = "Info from [Source 1] and hallucinated [Source 5].";
    expect(validateMarkers(answer, 2)).toBe(
      "Info from [Source 1] and hallucinated .",
    );
  });

  it("strips all markers when citationCount is 0", () => {
    const answer = "Model hallucinated [Source 1] and [Source 2].";
    // Note: citationCount=0 path uses \s* prefix, so preceding space is also stripped
    expect(validateMarkers(answer, 0)).toBe(
      "Model hallucinated and.",
    );
  });

  it("strips leading whitespace before invalid markers", () => {
    // When citationCount is 0, the regex also strips preceding whitespace
    const answer = "Some text [Source 1] more text.";
    expect(validateMarkers(answer, 0)).toBe("Some text more text.");
  });

  it("keeps [Source 1] but strips [Source 0]", () => {
    const answer = "[Source 0] is invalid but [Source 1] is valid.";
    expect(validateMarkers(answer, 1)).toBe(
      " is invalid but [Source 1] is valid.",
    );
  });

  it("handles markers at the boundary (N = citationCount)", () => {
    const answer = "See [Source 3] for details.";
    expect(validateMarkers(answer, 3)).toBe(answer);
  });

  it("strips markers just above the boundary (N = citationCount + 1)", () => {
    const answer = "See [Source 4] for details.";
    expect(validateMarkers(answer, 3)).toBe("See  for details.");
  });

  it("is case-insensitive when stripping", () => {
    const answer = "Check [SOURCE 5] for info.";
    expect(validateMarkers(answer, 2)).toBe("Check  for info.");
  });

  it("handles answer with no markers at all", () => {
    const answer = "Just a plain answer with no citations.";
    expect(validateMarkers(answer, 3)).toBe(answer);
  });

  it("handles empty answer", () => {
    expect(validateMarkers("", 0)).toBe("");
    expect(validateMarkers("", 5)).toBe("");
  });
});
