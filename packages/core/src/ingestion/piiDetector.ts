import type { Chunk, PIIWarning } from "@edgebric/types";

/**
 * Sensitive terms that, when appearing near a person's name, flag the chunk.
 */
const SENSITIVE_TERMS = [
  "salary",
  "compensation",
  "wage",
  "pay",
  "pip",
  "performance improvement",
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
 * Regex patterns for high-confidence PII (regardless of name proximity).
 * These are flagged unconditionally.
 */
const PII_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/, label: "SSN pattern" },
  { regex: /\$\s?\d{1,3}(,\d{3})*(\.\d{2})?\s*(\/\s*(hr|hour|yr|year|month|week))?/i, label: "salary figure" },
];

/**
 * Very lightweight name detection: two or more capitalized words in sequence
 * that are not at the start of a sentence.
 *
 * This is intentionally simple — it will have false positives (e.g. "Health Insurance").
 * The goal is to surface potential PII for admin review, not make a final determination.
 * A full spaCy NER run can be added later via Python subprocess.
 */
function likelyContainsName(text: string): boolean {
  // Look for patterns like "John Smith" or "Sarah Lee" not at sentence start
  return /(?<![.!?\n])\s+[A-Z][a-z]+\s+[A-Z][a-z]+/.test(text);
}

function containsSensitiveTerm(text: string): string | null {
  const lower = text.toLowerCase();
  for (const term of SENSITIVE_TERMS) {
    if (lower.includes(term)) return term;
  }
  return null;
}

/**
 * Scan chunks for PII patterns before embedding.
 *
 * Returns warnings for admin review. Empty array = safe to proceed.
 * Admin must explicitly confirm to proceed when warnings exist.
 */
export function detectPII(chunks: Chunk[]): PIIWarning[] {
  const warnings: PIIWarning[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;
    const text = chunk.content;

    // Check unconditional PII patterns first
    for (const { regex, label } of PII_PATTERNS) {
      if (regex.test(text)) {
        warnings.push({
          chunkIndex: i,
          excerpt: text.slice(0, 200),
          pattern: label,
        });
        break; // One warning per chunk is enough
      }
    }

    // Check name + sensitive term co-occurrence
    if (likelyContainsName(text)) {
      const sensitiveTerm = containsSensitiveTerm(text);
      if (sensitiveTerm) {
        warnings.push({
          chunkIndex: i,
          excerpt: text.slice(0, 200),
          pattern: `Possible person name + "${sensitiveTerm}"`,
        });
      }
    }
  }

  return warnings;
}
