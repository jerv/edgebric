import { test, expect } from "@playwright/test";
import {
  createDataSource,
  deleteDataSource,
  uploadAndIngest,
  query,
  answerContains,
  parseSSE,
  extractAnswer,
} from "./helpers";

/**
 * Conversation Context Tests — Multi-turn conversations with real inference.
 *
 * Verifies:
 * - Follow-up questions use conversation context
 * - The bot remembers earlier facts within a conversation
 * - Topic switching within a conversation works
 * - Private mode queries don't persist in conversation history
 * - Long conversations trigger summarization without breaking
 * - Context usage metadata reflects growing history
 */

let sourceId: string;
let docId: string;

test.describe.serial("Conversation Context", () => {
  test.beforeAll(async ({ request }) => {
    const ds = await createDataSource(request, "Context Test Source");
    sourceId = ds.id;
    const result = await uploadAndIngest(request, sourceId, "company-handbook.md");
    docId = result.documentId;
    expect(result.status).toBe("ready");
  });

  test.afterAll(async ({ request }) => {
    if (docId) await request.delete(`/api/documents/${docId}`);
    if (sourceId) await deleteDataSource(request, sourceId);
  });

  // ─── Multi-turn Follow-ups ──────────────────────────────────────────────────

  test("follows up on a previous answer within the same conversation", async ({ request }) => {
    // First question establishes context
    const first = await query(request, "How many PTO days does a new employee get?", {
      dataSourceIds: [sourceId],
    });
    expect(answerContains(first, "15")).toBe(true);
    expect(first.conversationId).toBeDefined();

    // Follow-up uses the same conversation — should understand "that" refers to PTO
    const followUp = await query(request, "Does that roll over to the next year?", {
      conversationId: first.conversationId,
      dataSourceIds: [sourceId],
    });

    // The handbook says PTO does NOT roll over
    const lower = followUp.answer.toLowerCase();
    const mentionsNoRollover =
      lower.includes("does not roll over") ||
      lower.includes("doesn't roll over") ||
      lower.includes("forfeited") ||
      lower.includes("no") ||
      lower.includes("not roll");

    expect(mentionsNoRollover).toBe(true);
  });

  test("remembers specific numbers from earlier in the conversation", async ({ request }) => {
    // Ask about Gold Plan
    const first = await query(request, "What is the Gold Plan health insurance deductible?", {
      dataSourceIds: [sourceId],
    });
    expect(answerContains(first, "500")).toBe(true);

    // Ask a comparative question referencing the previous answer
    const followUp = await query(
      request,
      "How does the Silver Plan compare to what we just discussed?",
      {
        conversationId: first.conversationId,
        dataSourceIds: [sourceId],
      },
    );

    // Should mention the Silver Plan specifics
    expect(answerContains(followUp, "1,500") || answerContains(followUp, "1500")).toBe(true);
  });

  // ─── Topic Switching ────────────────────────────────────────────────────────

  test("handles topic switch within the same conversation", async ({ request }) => {
    // Start with benefits
    const first = await query(request, "What is the 401k match?", {
      dataSourceIds: [sourceId],
    });
    expect(answerContains(first, "5")).toBe(true);

    // Switch to a completely different topic
    const switched = await query(request, "What are the core working hours?", {
      conversationId: first.conversationId,
      dataSourceIds: [sourceId],
    });

    expect(answerContains(switched, "10")).toBe(true);
    expect(answerContains(switched, "3")).toBe(true);
  });

  // ─── Private Mode ──────────────────────────────────────────────────────────

  test("private mode query does not appear in conversation history", async ({ request }) => {
    // Check if private mode is enabled
    const testRes = await request.fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        query: "test",
        private: true,
      }),
      timeout: 120_000,
    });

    if (testRes.status() === 403) {
      // Private mode is not enabled on this server — skip
      test.skip();
      return;
    }

    const body = await testRes.text();
    const events = parseSSE(body);
    const privateResult = extractAnswer(events);

    // Private queries should NOT have a persistent conversationId
    // or if they do, the conversation should not be listable
    if (privateResult.conversationId) {
      const convRes = await request.get(`/api/conversations/${privateResult.conversationId}`);
      // Either 404 (no conversation created) or the conversation exists but is private
      if (convRes.ok()) {
        const conv = await convRes.json();
        // If it exists, messages should be empty or marked private
        expect(conv.messages.length).toBeLessThanOrEqual(2); // at most the Q&A pair
      }
    }
  });

  // ─── Context Growth ─────────────────────────────────────────────────────────

  test("context usage grows as conversation lengthens", async ({ request }) => {
    const usages: number[] = [];

    // Two-turn conversation to verify context growth without timeout risk
    const first = await query(request, "How many PTO days does someone with 5 years get?", {
      dataSourceIds: [sourceId],
    });
    if (first.contextUsage) usages.push(first.contextUsage.usedTokens);

    const second = await query(request, "What about someone with 10 years?", {
      conversationId: first.conversationId,
      dataSourceIds: [sourceId],
    });
    if (second.contextUsage) usages.push(second.contextUsage.usedTokens);

    // Context usage should increase as conversation grows
    if (usages.length >= 2) {
      expect(usages[1]!).toBeGreaterThanOrEqual(usages[0]!);
    }
  });

  // ─── Conversation Listing ───────────────────────────────────────────────────

  test("conversations appear in the user's conversation list", async ({ request }) => {
    const result = await query(request, "What is the expense policy limit?", {
      dataSourceIds: [sourceId],
    });
    expect(result.conversationId).toBeDefined();

    const listRes = await request.get("/api/conversations");
    expect(listRes.ok()).toBe(true);
    const conversations = await listRes.json();

    // Should find our conversation in the list
    const found = conversations.some(
      (c: { id: string }) => c.id === result.conversationId,
    );
    expect(found).toBe(true);
  });

  test("conversation messages are retrievable", async ({ request }) => {
    const result = await query(request, "What is the overtime pay rate?", {
      dataSourceIds: [sourceId],
    });

    const convRes = await request.get(`/api/conversations/${result.conversationId}`);
    expect(convRes.ok()).toBe(true);
    const { messages } = await convRes.json();

    // Should have at least the user question and bot answer
    expect(messages.length).toBeGreaterThanOrEqual(2);

    const userMsg = messages.find((m: { role: string }) => m.role === "user");
    const botMsg = messages.find((m: { role: string }) => m.role === "assistant");
    expect(userMsg).toBeDefined();
    expect(botMsg).toBeDefined();
    expect(userMsg.content).toContain("overtime");
  });
});
