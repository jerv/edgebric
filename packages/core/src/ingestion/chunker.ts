import type { Chunk } from "@edgebric/types";
import { randomUUID } from "crypto";

interface ChunkOptions {
  maxTokens?: number;
  overlapTokens?: number;
}

const DEFAULT_MAX_TOKENS = 800;
const DEFAULT_OVERLAP_TOKENS = 50;
const MIN_MERGE_TOKENS = 100;

/**
 * Rough token estimate: 1 token ≈ 4 chars for English text.
 * Good enough for chunking decisions; not used for billing.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Parse heading level from a Markdown heading line.
 * Returns 0 if not a heading.
 */
function headingLevel(line: string): number {
  const match = line.match(/^(#{1,6})\s/);
  return match ? match[1]!.length : 0;
}

/**
 * Split markdown content into semantic chunks at heading boundaries.
 *
 * Rules:
 * - Split at H1/H2/H3 boundaries
 * - Tables are kept as a single atomic chunk (column headers embedded in text)
 * - Sections longer than maxTokens are split with overlapTokens overlap
 * - Adjacent short sections (< MIN_MERGE_TOKENS each) are merged
 */
export function chunkMarkdown(
  markdown: string,
  documentId: string,
  options: ChunkOptions = {},
): Chunk[] {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const overlapTokens = options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;

  const lines = markdown.split("\n");
  const sections: Array<{ heading: string; sectionPath: string[]; content: string }> = [];

  let currentHeading = "";
  let currentPath: string[] = [];
  let currentLines: string[] = [];
  let inTable = false;
  let tableLines: string[] = [];

  function flushSection() {
    if (currentLines.length === 0 && tableLines.length === 0) return;
    const content = [...currentLines, ...tableLines].join("\n").trim();
    if (content) {
      sections.push({
        heading: currentHeading,
        sectionPath: [...currentPath],
        content,
      });
    }
    currentLines = [];
    tableLines = [];
    inTable = false;
  }

  for (const line of lines) {
    const level = headingLevel(line);

    if (level > 0 && level <= 3) {
      flushSection();
      currentHeading = line.replace(/^#{1,6}\s+/, "").trim();
      currentPath = currentPath.slice(0, level - 1).concat(currentHeading);
      continue;
    }

    // Detect table start/end
    if (line.trim().startsWith("|")) {
      inTable = true;
      tableLines.push(line);
      continue;
    } else if (inTable) {
      // Table ended — flush it as its own section
      const tableContent = tableLines.join("\n").trim();
      if (tableContent) {
        sections.push({
          heading: currentHeading,
          sectionPath: [...currentPath],
          content: tableContent,
        });
      }
      tableLines = [];
      inTable = false;
    }

    currentLines.push(line);
  }

  flushSection();

  // Convert sections to chunks, splitting long ones and merging short ones
  const raw: Omit<Chunk, "id">[] = [];

  for (const section of sections) {
    const tokens = estimateTokens(section.content);

    if (tokens <= maxTokens) {
      raw.push({
        documentId,
        content: section.content,
        metadata: {
          sourceDocument: documentId,
          sectionPath: section.sectionPath,
          pageNumber: 0, // Assigned by caller after processing
          heading: section.heading,
          chunkIndex: raw.length,
        },
      });
    } else {
      // Split long section with overlap
      const words = section.content.split(/\s+/);
      // 1 token ≈ 4 chars, 1 word ≈ 5 chars → wordsPerChunk ≈ maxTokens * 4 / 5
      const wordsPerChunk = Math.ceil((maxTokens * 4) / 5);
      const overlapWords = Math.ceil((overlapTokens * 4) / 5);
      let start = 0;

      while (start < words.length) {
        const end = Math.min(start + wordsPerChunk, words.length);
        const chunkContent = words.slice(start, end).join(" ");
        raw.push({
          documentId,
          content: chunkContent,
          metadata: {
            sourceDocument: documentId,
            sectionPath: section.sectionPath,
            pageNumber: 0,
            heading: section.heading,
            chunkIndex: raw.length,
          },
        });
        if (end === words.length) break;
        start = end - overlapWords;
      }
    }
  }

  // Merge adjacent tiny chunks
  const merged: Omit<Chunk, "id">[] = [];
  let pending: Omit<Chunk, "id"> | null = null;

  for (const chunk of raw) {
    if (!pending) {
      pending = chunk;
      continue;
    }

    const pendingTokens = estimateTokens(pending.content);
    const chunkTokens = estimateTokens(chunk.content);

    // Merge if both are small and share the same heading path
    if (
      pendingTokens < MIN_MERGE_TOKENS &&
      chunkTokens < MIN_MERGE_TOKENS &&
      JSON.stringify(pending.metadata.sectionPath) === JSON.stringify(chunk.metadata.sectionPath)
    ) {
      pending = {
        ...pending,
        content: `${pending.content}\n\n${chunk.content}`,
      };
    } else {
      merged.push(pending);
      pending = chunk;
    }
  }

  if (pending) merged.push(pending);

  // Assign final IDs and correct chunkIndex
  return merged.map((chunk, i) => ({
    ...chunk,
    id: randomUUID(),
    metadata: { ...chunk.metadata, chunkIndex: i },
  }));
}
