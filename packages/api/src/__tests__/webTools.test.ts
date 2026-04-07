import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { htmlToText, parseDuckDuckGoResults, isInternalIp, validateUrlNotInternal } from "../services/tools/web.js";
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

  // ─── SSRF Protection ────────────────────────────────────────────────────

  describe("isInternalIp", () => {
    it("blocks 127.x.x.x (loopback)", () => {
      expect(isInternalIp("127.0.0.1")).toBe(true);
      expect(isInternalIp("127.255.255.255")).toBe(true);
    });

    it("blocks 10.x.x.x (private)", () => {
      expect(isInternalIp("10.0.0.1")).toBe(true);
      expect(isInternalIp("10.255.255.255")).toBe(true);
    });

    it("blocks 172.16-31.x.x (private)", () => {
      expect(isInternalIp("172.16.0.1")).toBe(true);
      expect(isInternalIp("172.31.255.255")).toBe(true);
      expect(isInternalIp("172.15.0.1")).toBe(false);
      expect(isInternalIp("172.32.0.1")).toBe(false);
    });

    it("blocks 192.168.x.x (private)", () => {
      expect(isInternalIp("192.168.0.1")).toBe(true);
      expect(isInternalIp("192.168.255.255")).toBe(true);
    });

    it("blocks 169.254.x.x (link-local)", () => {
      expect(isInternalIp("169.254.1.1")).toBe(true);
    });

    it("blocks 0.x.x.x", () => {
      expect(isInternalIp("0.0.0.0")).toBe(true);
    });

    it("blocks ::1 (IPv6 loopback)", () => {
      expect(isInternalIp("::1")).toBe(true);
    });

    it("blocks fd00::/8 (IPv6 ULA)", () => {
      expect(isInternalIp("fd00::1")).toBe(true);
      expect(isInternalIp("fdab:cdef::1")).toBe(true);
    });

    it("blocks fe80::/10 (IPv6 link-local)", () => {
      expect(isInternalIp("fe80::1")).toBe(true);
    });

    it("blocks ::ffff: mapped IPv4", () => {
      expect(isInternalIp("::ffff:127.0.0.1")).toBe(true);
      expect(isInternalIp("::ffff:10.0.0.1")).toBe(true);
    });

    it("allows public IPs", () => {
      expect(isInternalIp("8.8.8.8")).toBe(false);
      expect(isInternalIp("1.1.1.1")).toBe(false);
      expect(isInternalIp("93.184.216.34")).toBe(false);
    });
  });

  describe("validateUrlNotInternal", () => {
    it("blocks localhost hostname", async () => {
      const result = await validateUrlNotInternal("http://localhost:3000/api");
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/localhost/);
    });

    it("blocks direct internal IP URLs", async () => {
      const result = await validateUrlNotInternal("http://127.0.0.1/secret");
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/internal/i);
    });

    it("blocks 10.x private IPs", async () => {
      const result = await validateUrlNotInternal("http://10.0.0.1/admin");
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/internal/i);
    });

    it("blocks 192.168.x private IPs", async () => {
      const result = await validateUrlNotInternal("http://192.168.1.1/router");
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/internal/i);
    });

    it("blocks 169.254.x link-local IPs", async () => {
      const result = await validateUrlNotInternal("http://169.254.169.254/latest/meta-data/");
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/internal/i);
    });

    it("blocks IPv6 loopback", async () => {
      const result = await validateUrlNotInternal("http://[::1]/secret");
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/internal/i);
    });

    it("blocks non-HTTP schemes", async () => {
      const result = await validateUrlNotInternal("file:///etc/passwd");
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/http/i);
    });

    it("blocks FTP scheme", async () => {
      const result = await validateUrlNotInternal("ftp://internal.corp/data");
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/http/i);
    });

    it("catches DNS rebinding (hostname resolving to internal IP)", async () => {
      // localhost resolves to 127.0.0.1 — this tests the DNS resolution path
      const result = await validateUrlNotInternal("http://localhost/secret");
      expect(result.ok).toBe(false);
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

    it("blocks SSRF to localhost", async () => {
      const result = await executeTool("read_url", { url: "http://localhost:8080/admin" }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/localhost/i);
    });

    it("blocks SSRF to internal IP", async () => {
      const result = await executeTool("read_url", { url: "http://10.0.0.1/internal" }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/internal/i);
    });

    it("blocks SSRF to cloud metadata endpoint", async () => {
      const result = await executeTool("read_url", { url: "http://169.254.169.254/latest/meta-data/" }, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/internal/i);
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
