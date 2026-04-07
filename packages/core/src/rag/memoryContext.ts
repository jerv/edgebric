/**
 * Memory Context — searches the user's Memory data source and formats
 * relevant memories as a compact context block for injection into the
 * system prompt.
 *
 * This module is pure formatting logic. The actual search is performed
 * by a search function injected by the API layer (same pattern as the
 * orchestrator).
 */

export interface MemorySearchResult {
  content: string;
  category: string;
  confidence: number;
}

export interface MemorySearchFn {
  (query: string, topK: number): Promise<MemorySearchResult[]>;
}

/**
 * Search user memories and format them as a compact context block.
 *
 * Returns an empty string if no relevant memories are found, so callers
 * can simply prepend the result without conditional checks.
 *
 * Max ~200 tokens (~800 chars) to stay small-model friendly.
 */
export async function buildMemoryContext(
  query: string,
  searchMemory: MemorySearchFn,
  maxResults = 5,
): Promise<string> {
  const results = await searchMemory(query, maxResults);

  if (results.length === 0) return "";

  // Format as a compact numbered list, truncating to stay under ~800 chars
  const entries: string[] = [];
  let totalLength = 0;
  const MAX_CHARS = 800;

  for (const r of results) {
    const entry = `[${entries.length + 1}] ${r.content}`;
    if (totalLength + entry.length > MAX_CHARS) break;
    entries.push(entry);
    totalLength += entry.length;
  }

  if (entries.length === 0) return "";

  return `<user_context>
The following are known facts and preferences about this user:
${entries.join("\n")}
</user_context>`;
}
