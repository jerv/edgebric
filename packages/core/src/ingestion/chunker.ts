import type { Chunk } from "@edgebric/types";
import { randomUUID } from "crypto";

interface ChunkOptions {
  maxTokens?: number;
  overlapTokens?: number;
}

// ─── Child chunks are small (for embedding precision) ────────────────────────
// Parent chunks are larger (for LLM context richness)
const DEFAULT_CHILD_TOKENS = 256;
const DEFAULT_PARENT_TOKENS = 1024;
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

interface Section {
  heading: string;
  sectionPath: string[];
  content: string;
}

/** Extract sections from markdown by splitting at H1/H2/H3 heading boundaries. */
function extractSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];

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
  return sections;
}

/** Split text into sub-chunks by word count with overlap. */
function splitByWords(
  text: string,
  maxTokens: number,
  overlapTokens: number,
): string[] {
  const words = text.split(/\s+/);
  const wordsPerChunk = Math.ceil((maxTokens * 4) / 5);
  const overlapWords = Math.ceil((overlapTokens * 4) / 5);
  const parts: string[] = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + wordsPerChunk, words.length);
    parts.push(words.slice(start, end).join(" "));
    if (end === words.length) break;
    start = end - overlapWords;
  }

  return parts;
}

/**
 * Split markdown into parent-child chunks for retrieval.
 *
 * Strategy:
 * - "Parent" chunks are section-level (up to PARENT_TOKENS). These provide
 *   rich context to the LLM during generation.
 * - "Child" chunks are smaller (CHILD_TOKENS). These are what gets embedded
 *   in the vector store for precise retrieval.
 * - Each child carries its parent's full text as `parentContent` metadata.
 * - When search returns a child, the orchestrator uses parentContent for the
 *   LLM prompt and the child excerpt for citations.
 *
 * This gives the best of both worlds: precise retrieval (small chunks match
 * tightly) with rich generation context (LLM sees the full section).
 */
export function chunkMarkdown(
  markdown: string,
  documentId: string,
  options: ChunkOptions = {},
): Chunk[] {
  const childTokens = options.maxTokens ?? DEFAULT_CHILD_TOKENS;
  const overlapTokens = options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;

  const sections = extractSections(markdown);

  // Phase 1: Build parent chunks (section-level, up to PARENT_TOKENS)
  const parentChunks: Array<{
    heading: string;
    sectionPath: string[];
    content: string;
  }> = [];

  for (const section of sections) {
    const tokens = estimateTokens(section.content);

    if (tokens <= DEFAULT_PARENT_TOKENS) {
      parentChunks.push(section);
    } else {
      // Section is too large even for a parent — split into parent-sized pieces
      const parts = splitByWords(section.content, DEFAULT_PARENT_TOKENS, overlapTokens);
      for (const part of parts) {
        parentChunks.push({
          heading: section.heading,
          sectionPath: section.sectionPath,
          content: part,
        });
      }
    }
  }

  // Phase 2: Split each parent into child chunks
  const raw: Omit<Chunk, "id">[] = [];

  for (const parent of parentChunks) {
    const parentTokens = estimateTokens(parent.content);

    if (parentTokens <= childTokens) {
      // Parent is small enough to be its own child — no split needed.
      // parentContent is still set (same as content) for consistency.
      raw.push({
        documentId,
        content: parent.content,
        metadata: {
          sourceDocument: documentId,
          sectionPath: parent.sectionPath,
          pageNumber: 0,
          heading: parent.heading,
          chunkIndex: raw.length,
          parentContent: parent.content,
        },
      });
    } else {
      // Split into child chunks, each carrying the parent's full text
      const childParts = splitByWords(parent.content, childTokens, overlapTokens);
      for (const childContent of childParts) {
        raw.push({
          documentId,
          content: childContent,
          metadata: {
            sourceDocument: documentId,
            sectionPath: parent.sectionPath,
            pageNumber: 0,
            heading: parent.heading,
            chunkIndex: raw.length,
            parentContent: parent.content,
          },
        });
      }
    }
  }

  // Phase 3: Merge adjacent tiny chunks (preserving parent content)
  const merged: Omit<Chunk, "id">[] = [];
  let pending: Omit<Chunk, "id"> | null = null;

  for (const chunk of raw) {
    if (!pending) {
      pending = chunk;
      continue;
    }

    const pendingTokens = estimateTokens(pending.content);
    const chunkTokens = estimateTokens(chunk.content);

    if (
      pendingTokens < MIN_MERGE_TOKENS &&
      chunkTokens < MIN_MERGE_TOKENS &&
      JSON.stringify(pending.metadata.sectionPath) === JSON.stringify(chunk.metadata.sectionPath)
    ) {
      const mergedContent: string = `${pending.content}\n\n${chunk.content}`;
      // Merge parent content too if both are from the same parent
      const mergedParent: string = pending.metadata.parentContent === chunk.metadata.parentContent
        ? (pending.metadata.parentContent ?? mergedContent)
        : `${pending.metadata.parentContent ?? pending.content}\n\n${chunk.metadata.parentContent ?? chunk.content}`;
      pending = {
        ...pending,
        content: mergedContent,
        metadata: { ...pending.metadata, parentContent: mergedParent },
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
