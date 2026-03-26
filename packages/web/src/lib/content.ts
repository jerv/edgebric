import type { Citation } from "@edgebric/types";

/** Strip all source/citation references from model output and ensure paragraph spacing. */
export function cleanContent(text: string): string {
  let cleaned = text;
  // Remove inline [Source N] or [Source N: anything] references
  cleaned = cleaned.replace(/\s*\[Source\s*\d+[^\]]*\]/gi, "");
  // Remove parenthesized sources: (Source: ...) or (Sources: ...)
  cleaned = cleaned.replace(/\s*\(Sources?:?[^)]*\)/gi, "");
  // Remove trailing Sources/References section (with or without bold/header markers)
  cleaned = cleaned.replace(/\n+(?:#{1,3}\s*)?(?:\*{0,2})(?:Sources?|References|Citations):?(?:\*{0,2})\s*[\s\S]*$/i, "");
  // Remove standalone lines that are just source references like "- Source 1: ..."
  cleaned = cleaned.replace(/\n[-*]\s*Source\s*\d+:?[^\n]*/gi, "");
  // Remove "According to Source N: <uuid> | ..." phrasing the model sometimes echoes
  cleaned = cleaned.replace(/(?:According to|Based on|From)\s+Source\s*\d+:\s*[0-9a-f-]{36}\s*\|[^,.]*[,.]?\s*/gi, "");
  // Strip any remaining bare UUIDs (8-4-4-4-12 hex) that leak from source markers
  cleaned = cleaned.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "");
  // Ensure blank line before lines starting with **BoldLabel:** (paragraph separation)
  cleaned = cleaned.replace(/([^\n])\n(\*\*[^*]+:\*\*)/g, "$1\n\n$2");
  // Ensure blank line before numbered list items that follow text (e.g. "text\n1. item")
  cleaned = cleaned.replace(/([^\n])\n(\d+\.\s)/g, "$1\n\n$2");
  return cleaned.trim();
}

/** Deduplicate citations by documentName + sectionPath. */
export function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter((c) => {
    const key = `${c.dataSourceName ?? ""}|${c.documentName}|${c.sectionPath.join("/")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Tailwind classes for rendering markdown prose content. */
export const PROSE_CLASSES = [
  "prose prose-sm prose-slate dark:prose-invert max-w-none",
  "prose-p:my-3 prose-p:leading-relaxed",
  "prose-headings:text-sm prose-headings:font-semibold prose-headings:mt-5 prose-headings:mb-2",
  "prose-ul:my-3 prose-ol:my-3 prose-li:my-1 prose-li:leading-relaxed",
  "prose-strong:text-slate-900 dark:prose-strong:text-gray-100",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
] as const;
