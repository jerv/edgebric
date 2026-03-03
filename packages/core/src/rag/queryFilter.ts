import type { FilterResult } from "@edgebric/types";

const SENSITIVE_TERMS = [
  "salary",
  "compensation",
  "pay",
  "wage",
  "pip",
  "performance improvement plan",
  "fired",
  "termination",
  "terminated",
  "laid off",
  "complaint",
  "harassment",
  "investigation",
  "accommodation",
  "disability",
  "discipline",
  "warning",
  "suspension",
];

const REDIRECT_MESSAGE =
  "Edgebric provides company-wide policy information and cannot access records about specific individuals. For questions about your personal situation, please contact HR directly.";

/**
 * Detect queries that contain a person's name combined with a sensitive term.
 *
 * Uses the same lightweight heuristic as PII detection.
 * False positives are acceptable here — redirecting a benign query is much
 * less harmful than surfacing personal data.
 */
function looksLikePersonName(query: string): boolean {
  // Match patterns like "John Smith", "Sarah's", "John's"
  return /\b[A-Z][a-z]+(?:'s)?\s+[A-Z][a-z]+\b/.test(query) ||
    /\b[A-Z][a-z]+'s\b/.test(query);
}

function containsSensitiveTerm(query: string): boolean {
  const lower = query.toLowerCase();
  return SENSITIVE_TERMS.some((term) => lower.includes(term));
}

/**
 * Filter queries before retrieval.
 *
 * Returns { allowed: false } with a redirect message if the query appears
 * to be asking about a specific individual's personal information.
 *
 * This is Layer 4 of the data leakage prevention strategy.
 * Layers 1–3 (no personal records in shared index, PII detection at ingestion,
 * system prompt guardrail) are the primary protection.
 */
export function filterQuery(query: string): FilterResult {
  if (looksLikePersonName(query) && containsSensitiveTerm(query)) {
    return {
      allowed: false,
      reason: "person_name_sensitive_term",
      redirectMessage: REDIRECT_MESSAGE,
    };
  }

  return { allowed: true };
}
