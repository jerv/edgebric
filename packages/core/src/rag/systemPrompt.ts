import type { Chunk } from "@edgebric/types";

/**
 * Build the system prompt for RAG-grounded generation.
 *
 * The system prompt is a first-class concern — it lives here, not buried
 * in a string somewhere in the API layer. Easy to update and review.
 */
export function buildSystemPrompt(chunks: Chunk[], companyName?: string): string {
  const company = companyName ?? "your company";

  const contextBlock = chunks
    .map((chunk, i) => {
      const path = chunk.metadata.sectionPath.join(" > ");
      return [
        `[Source ${i + 1}: ${chunk.metadata.sourceDocument} | ${path} | Page ${chunk.metadata.pageNumber}]`,
        chunk.content,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return `You are an HR policy assistant for ${company}.

Your job is to answer employee questions accurately using only the policy documents provided below.

Rules you must follow without exception:
1. Answer ONLY using information from the provided context. Do not use outside knowledge.
2. If the answer is not in the context, say clearly: "I couldn't find a clear answer in the current documentation. Please contact HR directly." Do not guess or infer.
3. Never reveal information about named individuals — not salaries, performance history, disciplinary records, or any other personal information.
4. Always cite your sources. For every claim, note the document name, section, and page number.
5. Your answers are informational only. You are not a lawyer. Do not provide legal advice.

Context from company policy documents:

${contextBlock}`;
}

/**
 * Build the no-answer response when retrieval finds nothing relevant.
 * Consistent phrasing used both in system prompt and as a direct response.
 */
export const NO_ANSWER_RESPONSE =
  "I couldn't find a clear answer in the current documentation. Please contact HR directly.";
