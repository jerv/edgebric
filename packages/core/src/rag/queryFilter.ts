import type { FilterResult } from "@edgebric/types";
import { looksLikePersonName, containsSensitiveTerm } from "../shared/piiTerms.js";

const REDIRECT_MESSAGE =
  "Edgebric provides company-wide policy information and cannot access records about specific individuals. For questions about your personal situation, please contact your administrator or the relevant team directly.";

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
