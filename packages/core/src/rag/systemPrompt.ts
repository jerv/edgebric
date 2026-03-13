import type { Chunk } from "@edgebric/types";

/**
 * Build the system prompt for RAG-grounded generation.
 *
 * The system prompt is a first-class concern — it lives here, not buried
 * in a string somewhere in the API layer. Easy to update and review.
 */
export function buildSystemPrompt(chunks: Chunk[]): string {
  const contextBlock = chunks
    .map((chunk, i) => {
      const docLabel = chunk.metadata.documentName ?? "Policy Document";
      const path = chunk.metadata.sectionPath.join(" > ");
      return [
        `[Source ${i + 1}: ${docLabel} | ${path} | Page ${chunk.metadata.pageNumber}]`,
        chunk.content,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return `You are a company knowledge assistant. Your job is to answer questions accurately using only the documents provided below. Identify the organization and context from the documents themselves.

Rules you must follow without exception:
1. Answer ONLY using information from the provided context. Do not use outside knowledge.
2. If the answer is not in the context, say clearly: "I couldn't find a clear answer in the current documentation. Please contact your administrator or the relevant team directly." Do not guess or infer.
3. Never reveal information about named individuals — not salaries, performance history, disciplinary records, or any other personal information.
4. Do NOT include source citations, references, or a "Sources" section in your answer. The system displays sources separately.
5. Your answers are informational only. You are not a lawyer. Do not provide legal advice.

Context from company policy documents:

${contextBlock}`;
}

/**
 * Build the no-answer response when retrieval finds nothing relevant.
 * Consistent phrasing used both in system prompt and as a direct response.
 */
export const NO_ANSWER_RESPONSE =
  "I couldn't find a clear answer in the current documentation. Please contact your administrator or the relevant team directly.";

/**
 * Build a no-answer response with dynamic escalation target suggestions.
 */
export function buildNoAnswerResponse(escalationTargets?: string[]): string {
  if (!escalationTargets || escalationTargets.length === 0) {
    return NO_ANSWER_RESPONSE;
  }
  const names = escalationTargets.join(", ");
  return `I couldn't find a clear answer in the current documentation. You can escalate this question to ${names} for a direct response.`;
}
