/**
 * Web Tools — web_search (DuckDuckGo) and read_url (fetch + HTML-to-text).
 *
 * No API keys needed. DuckDuckGo HTML search is parsed for results.
 * read_url strips HTML tags and returns clean text, limited to ~10KB.
 */
import type { Tool, ToolResult } from "../toolRunner.js";
import { registerTool } from "../toolRunner.js";
import { logger } from "../../lib/logger.js";

const MAX_TEXT_LENGTH = 10_000; // 10KB text limit

// ─── HTML-to-text extraction ────────────────────────────────────────────────

/**
 * Strip HTML tags and decode entities. Returns clean text.
 */
function htmlToText(html: string): string {
  return html
    // Remove script/style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    // Replace block elements with newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Strip all remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    // Collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}

// ─── DuckDuckGo HTML Search Parser ──────────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo HTML results are in <div class="result"> blocks
  // Each has an <a class="result__a"> for the link and <a class="result__snippet"> for snippet
  const resultBlocks = html.split(/class="result(?:__body|s_links_deep)"/).slice(1);

  for (const block of resultBlocks) {
    // Extract URL from result__a href
    const urlMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/);
    // Also try the uddg redirect pattern
    const uddgMatch = block.match(/href="[^"]*uddg=([^&"]+)/);
    const rawUrl = uddgMatch ? decodeURIComponent(uddgMatch[1]!) : urlMatch?.[1];
    if (!rawUrl) continue;

    // Extract title text
    const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const title = titleMatch ? htmlToText(titleMatch[1]!) : "";

    // Extract snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = snippetMatch ? htmlToText(snippetMatch[1]!) : "";

    if (title && rawUrl) {
      results.push({ title: title.trim(), url: rawUrl, snippet: snippet.trim() });
    }
  }

  return results.slice(0, 8); // Limit to 8 results
}

// ─── web_search ─────────────────────────────────────────────────────────────

const webSearch: Tool = {
  name: "web_search",
  description: "Search the internet using DuckDuckGo. Returns titles, URLs, and snippets of top results.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
    },
    required: ["query"],
  },
  async execute(args): Promise<ToolResult> {
    const query = args["query"] as string;

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Edgebric/1.0 (local AI knowledge platform)",
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        return { success: false, error: `Search failed: HTTP ${response.status}` };
      }

      const html = await response.text();
      const results = parseDuckDuckGoResults(html);

      if (results.length === 0) {
        return { success: true, data: { resultCount: 0, results: [], note: "No results found" } };
      }

      return { success: true, data: { resultCount: results.length, results } };
    } catch (err) {
      logger.error({ err }, "Web search failed");
      return { success: false, error: err instanceof Error ? err.message : "Web search failed" };
    }
  },
};

// ─── read_url ───────────────────────────────────────────────────────────────

const readUrl: Tool = {
  name: "read_url",
  description: "Fetch a URL and extract its text content. HTML is converted to clean text. Limited to ~10KB of text.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch" },
    },
    required: ["url"],
  },
  async execute(args): Promise<ToolResult> {
    const url = args["url"] as string;

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      return { success: false, error: "Invalid URL" };
    }

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Edgebric/1.0 (local AI knowledge platform)",
          Accept: "text/html,application/xhtml+xml,text/plain,*/*",
        },
        signal: AbortSignal.timeout(15_000),
        redirect: "follow",
      });

      if (!response.ok) {
        return { success: false, error: `Failed to fetch: HTTP ${response.status}` };
      }

      const contentType = response.headers.get("content-type") ?? "";
      const rawBody = await response.text();

      let text: string;
      if (contentType.includes("text/html") || contentType.includes("xhtml")) {
        text = htmlToText(rawBody);
      } else {
        // Plain text, JSON, etc. — return as-is
        text = rawBody;
      }

      // Truncate to limit
      const truncated = text.length > MAX_TEXT_LENGTH;
      if (truncated) {
        text = text.slice(0, MAX_TEXT_LENGTH);
      }

      return {
        success: true,
        data: {
          url,
          contentLength: text.length,
          truncated,
          content: text,
        },
      };
    } catch (err) {
      logger.error({ err, url }, "URL fetch failed");
      return { success: false, error: err instanceof Error ? err.message : "Failed to fetch URL" };
    }
  },
};

// ─── Register All Web Tools ─────────────────────────────────────────────────

export function registerWebTools(): void {
  registerTool(webSearch);
  registerTool(readUrl);
}

// Export for testing
export { htmlToText, parseDuckDuckGoResults };
