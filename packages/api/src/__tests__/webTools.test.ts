import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { htmlToText, parseDuckDuckGoResults } from "../services/tools/web.js";
import { registerWebTools } from "../services/tools/web.js";
import { clearTools, executeTool, getTool } from "../services/toolRunner.js";
import type { ToolContext } from "../services/toolRunner.js";
import { setupTestApp, teardownTestApp } from "./helpers.js";

const ctx: ToolContext = { userEmail: "user@test.com", isAdmin: false, orgId: "org-1" };

describe("Web Tools", () => {
  beforeAll(() => { setupTestApp(); });
  afterAll(() => { teardownTestApp(); });

  // ─── htmlToText ─────────────────────────────────────────────────────────

  describe("htmlToText", () => {
    it("strips HTML tags", () => {
      expect(htmlToText("<p>Hello <b>world</b></p>")).toBe("Hello world");
    });

    it("removes script and style blocks", () => {
      const html = '<p>text</p><script>alert("x")</script><style>.x{}</style><p>more</p>';
      const result = htmlToText(html);
      expect(result).not.toContain("alert");
      expect(result).not.toContain(".x{}");
      expect(result).toContain("text");
      expect(result).toContain("more");
    });

    it("decodes HTML entities", () => {
      expect(htmlToText("&amp; &lt; &gt; &quot; &#39;")).toBe('& < > " \'');
    });

    it("converts block elements to newlines", () => {
      const html = "<p>Para 1</p><p>Para 2</p>";
      const result = htmlToText(html);
      expect(result).toContain("Para 1");
      expect(result).toContain("Para 2");
    });

    it("handles br tags", () => {
      const result = htmlToText("line1<br>line2<br/>line3");
      expect(result).toContain("line1");
      expect(result).toContain("line2");
      expect(result).toContain("line3");
    });

    it("collapses excessive whitespace", () => {
      const result = htmlToText("hello     world   test");
      expect(result).toBe("hello world test");
    });

    it("handles empty input", () => {
      expect(htmlToText("")).toBe("");
    });

    it("removes noscript blocks", () => {
      const html = "<p>visible</p><noscript>hidden</noscript>";
      const result = htmlToText(html);
      expect(result).toContain("visible");
      expect(result).not.toContain("hidden");
    });
  });

  // ─── parseDuckDuckGoResults ─────────────────────────────────────────────

  describe("parseDuckDuckGoResults", () => {
    it("parses DuckDuckGo result blocks with uddg redirect", () => {
      const html = `
        <div class="result__body">
          <a class="result__a" href="https://duckduckgo.com/?uddg=https%3A%2F%2Fexample.com%2Fpage">
            Example Page
          </a>
          <a class="result__snippet">This is the snippet text.</a>
        </div>
      `;
      const results = parseDuckDuckGoResults(html);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.title).toBe("Example Page");
      expect(results[0]!.url).toBe("https://example.com/page");
      expect(results[0]!.snippet).toBe("This is the snippet text.");
    });

    it("parses direct URL results", () => {
      const html = `
        <div class="result__body">
          <a class="result__a" href="https://direct.example.com/">
            Direct Link
          </a>
          <a class="result__snippet">Direct snippet.</a>
        </div>
      `;
      const results = parseDuckDuckGoResults(html);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.title).toBe("Direct Link");
    });

    it("returns empty array for no results", () => {
      expect(parseDuckDuckGoResults("<html><body>No results</body></html>")).toEqual([]);
    });

    it("limits to 8 results", () => {
      let html = "";
      for (let i = 0; i < 15; i++) {
        html += `
          <div class="result__body">
            <a class="result__a" href="https://duckduckgo.com/?uddg=https%3A%2F%2Fexample.com%2F${i}">
              Result ${i}
            </a>
            <a class="result__snippet">Snippet ${i}</a>
          </div>
        `;
      }
      const results = parseDuckDuckGoResults(html);
      expect(results.length).toBeLessThanOrEqual(8);
    });
  });

  // ─── Tool registration ──────────────────────────────────────────────────

  describe("registration", () => {
    beforeEach(() => { clearTools(); });

    it("registers web_search and read_url tools", () => {
      registerWebTools();
      expect(getTool("web_search")).toBeDefined();
      expect(getTool("read_url")).toBeDefined();
    });
  });

  // ─── read_url validation ────────────────────────────────────────────────

  describe("read_url", () => {
    beforeEach(() => { clearTools(); registerWebTools(); });

    it("rejects invalid URLs", async () => {
      const result = await executeTool("read_url", { url: "not a url" }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid URL/);
    });

    it("requires url parameter", async () => {
      const result = await executeTool("read_url", {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Missing required/);
    });
  });

  // ─── web_search validation ──────────────────────────────────────────────

  describe("web_search", () => {
    beforeEach(() => { clearTools(); registerWebTools(); });

    it("requires query parameter", async () => {
      const result = await executeTool("web_search", {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Missing required/);
    });
  });
});
