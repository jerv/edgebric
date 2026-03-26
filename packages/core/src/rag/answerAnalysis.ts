import type { AnswerType } from "@edgebric/types";

/**
 * Determine answer type based on inline citation marker presence.
 *
 * When the system prompt instructs the model to use [Source N] markers:
 * - All paragraphs cited → grounded
 * - Mix of cited and uncited → blended
 * - No markers at all (small model ignored instruction) → grounded (conservative)
 * - No context was provided → general
 *
 * Graceful degradation: small models that don't cite inline are classified
 * as "grounded" — identical to pre-existing behavior. Better models that
 * follow the citation instruction unlock blended detection automatically.
 */
export function detectAnswerType(
  answer: string,
  hadContext: boolean,
): Exclude<AnswerType, "blocked"> {
  if (!hadContext) return "general";

  // Split into meaningful paragraphs (skip very short fragments like headers)
  const paragraphs = answer
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40);

  if (paragraphs.length === 0) return "grounded";

  const citedCount = paragraphs.filter((p) =>
    /\[Source\s*\d+\]/i.test(p),
  ).length;

  // Model didn't use markers at all — conservative fallback to grounded
  if (citedCount === 0) return "grounded";

  // All paragraphs have citations → fully grounded
  if (citedCount === paragraphs.length) return "grounded";

  // Mix of cited and uncited paragraphs → blended
  return "blended";
}

/**
 * Extract [Source N] marker numbers from answer text.
 * Returns sorted unique array of 1-based source indices.
 */
export function extractCitationMarkers(answer: string): number[] {
  const markers = new Set<number>();
  const regex = /\[Source\s*(\d+)\]/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(answer)) !== null) {
    markers.add(Number(match[1]));
  }
  return [...markers].sort((a, b) => a - b);
}

/**
 * Strip invalid [Source N] markers where N exceeds the actual citation count.
 * Prevents the model from hallucinating source references.
 */
export function validateMarkers(
  answer: string,
  citationCount: number,
): string {
  if (citationCount === 0) {
    // No citations at all — strip all markers
    return answer.replace(/\s*\[Source\s*\d+\]/gi, "");
  }

  return answer.replace(/\[Source\s*(\d+)\]/gi, (match, numStr: string) => {
    const n = Number(numStr);
    return n >= 1 && n <= citationCount ? match : "";
  });
}
