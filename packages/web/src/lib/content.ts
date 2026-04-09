import type { ReactNode } from "react";
import { createElement } from "react";
import type { Citation } from "@edgebric/types";

/**
 * Clean model output — strip junk but PRESERVE [Source N] inline markers.
 * The inline markers are rendered as interactive superscripts by the UI.
 */
export function cleanContent(text: string): string {
  let cleaned = text;
  // Keep [Source N] markers — these are now rendered as inline citation superscripts.
  // Only strip the junk patterns the model sometimes generates:

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

// ─── Inline Citation Processor ──────────────────────────────────────────────

const SOURCE_MARKER_REGEX = /\[Source\s*(\d+)\]/gi;

/**
 * Process React children from markdown, replacing [Source N] text with
 * interactive superscript citation buttons.
 *
 * Walks React children (strings and elements), splits strings on
 * [Source N] patterns, and returns mixed text + superscript elements.
 */
export function processInlineCitations(
  children: ReactNode,
  onCitationClick?: (sourceIndex: number) => void,
): ReactNode {
  if (!children) return children;

  if (typeof children === "string") {
    return splitTextByCitations(children, onCitationClick);
  }

  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string") {
        return splitTextByCitations(child, onCitationClick, i);
      }
      return child;
    });
  }

  return children;
}

function splitTextByCitations(
  text: string,
  onCitationClick?: (sourceIndex: number) => void,
  keyPrefix: number = 0,
): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state
  const regex = new RegExp(SOURCE_MARKER_REGEX.source, SOURCE_MARKER_REGEX.flags);

  while ((match = regex.exec(text)) !== null) {
    // Text before the marker
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const sourceNum = Number(match[1]);
    parts.push(
      createElement(
        "button",
        {
          key: `cite-${keyPrefix}-${match.index}`,
          className:
            "inline text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 align-super ml-0.5 cursor-pointer",
          onClick: onCitationClick
            ? (e: { stopPropagation: () => void }) => {
                e.stopPropagation();
                onCitationClick(sourceNum);
              }
            : undefined,
          title: `Source ${sourceNum}`,
        },
        `[${sourceNum}]`,
      ),
    );

    lastIndex = regex.lastIndex;
  }

  // Remaining text after last marker
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  // If no markers found, return original string
  if (parts.length === 0) return text;
  if (parts.length === 1 && typeof parts[0] === "string") return parts[0];

  return parts;
}

/** Tailwind classes for rendering markdown prose content. */
export const PROSE_CLASSES = [
  "prose prose-sm prose-slate dark:prose-invert max-w-none",
  "prose-p:my-2 prose-p:leading-relaxed prose-p:first:mt-0 prose-p:last:mb-0",
  "prose-headings:text-sm prose-headings:font-semibold prose-headings:mt-5 prose-headings:mb-2 prose-headings:first:mt-0",
  "prose-ul:my-3 prose-ol:my-3 prose-li:my-1 prose-li:leading-relaxed prose-ul:first:mt-0 prose-ol:first:mt-0 prose-ul:last:mb-0 prose-ol:last:mb-0",
  "prose-strong:text-slate-900 dark:prose-strong:text-gray-100",
] as const;
