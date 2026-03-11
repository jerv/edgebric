/**
 * Centralized PII-related constants and utilities.
 * Used by both piiDetector (ingestion-time) and queryFilter (query-time).
 */

/** Terms that, when appearing near a person's name, indicate PII risk. */
export const SENSITIVE_TERMS = [
  "salary",
  "compensation",
  "wage",
  "pay",
  "pip",
  "performance improvement",
  "performance improvement plan",
  "termination",
  "terminated",
  "fired",
  "laid off",
  "layoff",
  "accommodation",
  "disability",
  "investigation",
  "complaint",
  "harassment",
  "discipline",
  "disciplinary",
  "warning",
  "suspension",
  "ssn",
  "social security",
  "dob",
  "date of birth",
];

/**
 * Lightweight name detection: capitalized multi-word patterns
 * that look like person names (e.g. "John Smith", "Sarah's").
 *
 * False positives are acceptable — redirecting a benign query is
 * less harmful than surfacing personal data.
 */
export function looksLikePersonName(text: string): boolean {
  return /\b[A-Z][a-z]+(?:'s)?\s+[A-Z][a-z]+\b/.test(text) ||
    /\b[A-Z][a-z]+'s\b/.test(text);
}

/** Returns the first matching sensitive term found, or null. */
export function findSensitiveTerm(text: string): string | null {
  const lower = text.toLowerCase();
  for (const term of SENSITIVE_TERMS) {
    if (lower.includes(term)) return term;
  }
  return null;
}

/** Returns true if any sensitive term appears in the text. */
export function containsSensitiveTerm(text: string): boolean {
  return findSensitiveTerm(text) !== null;
}
