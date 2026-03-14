import type { Chunk, PIIWarning } from "@edgebric/types";
import { looksLikePersonName, findSensitiveTerm } from "../shared/piiTerms.js";

/**
 * Regex patterns for high-confidence PII (regardless of name proximity).
 * These are flagged unconditionally.
 */
const PII_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/, label: "Contains what looks like a Social Security Number" },
  { regex: /\$\s?\d{1,3}(,\d{3})*(\.\d{2})?\s*(\/\s*(hr|hour|yr|year|month|week))?/i, label: "Contains dollar amounts (may include salary or compensation data)" },
];

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
    if (looksLikePersonName(text)) {
      const sensitiveTerm = findSensitiveTerm(text);
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
