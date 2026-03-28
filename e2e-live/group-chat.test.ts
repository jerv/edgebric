import { test, expect } from "@playwright/test";
import {
  createDataSource,
  deleteDataSource,
  uploadAndIngest,
  groupChatQuery,
  answerContains,
} from "./helpers";

/**
 * Group Chat Tests — Real inference via @bot in group chats.
 *
 * Verifies:
 * - Creating a group chat and querying the bot
 * - Bot answers from shared data sources
 * - Multiple questions in the same group chat with context
 * - SSE events stream correctly for group chat queries
 * - Group chat messages are persisted and retrievable
 */

let sourceId: string;
let docId: string;
let groupChatId: string;

test.describe.serial("Group Chat @bot", () => {
  test.beforeAll(async ({ request }) => {
    // Create data source and ingest document
    const ds = await createDataSource(request, "Group Chat Test Source");
    sourceId = ds.id;
    const result = await uploadAndIngest(request, sourceId, "company-handbook.md");
    docId = result.documentId;
    expect(result.status).toBe("ready");
  });

  test.afterAll(async ({ request }) => {
    if (groupChatId) await request.delete(`/api/group-chats/${groupChatId}`);
    if (docId) await request.delete(`/api/documents/${docId}`);
    if (sourceId) await deleteDataSource(request, sourceId);
  });

  // ─── Setup ────────────────────────────────────────────────────────────────

  test("creates a group chat", async ({ request }) => {
    const res = await request.post("/api/group-chats", {
      data: {
        name: "E2E Test Group",
        expiration: "never",
      },
    });
    expect(res.ok()).toBe(true);
    const chat = await res.json();
    groupChatId = chat.id;
    expect(chat.name).toBe("E2E Test Group");
  });

  test("shares a data source with the group chat", async ({ request }) => {
    const res = await request.post(`/api/group-chats/${groupChatId}/shared-data-sources`, {
      data: {
        dataSourceId: sourceId,
        allowSourceViewing: true,
      },
    });
    expect(res.ok()).toBe(true);
  });

  // ─── Bot Queries ──────────────────────────────────────────────────────────

  test("bot answers a factual question in group chat", async ({ request }) => {
    const result = await groupChatQuery(
      request,
      groupChatId,
      "How many PTO days does a new employee get?",
    );

    expect(result.answer.length).toBeGreaterThan(10);
    expect(answerContains(result, "15")).toBe(true);
  });

  test("bot answers from shared data source content", async ({ request }) => {
    const result = await groupChatQuery(
      request,
      groupChatId,
      "What is the Gold Plan health insurance deductible?",
    );

    expect(answerContains(result, "500")).toBe(true);
  });

  test("bot handles follow-up question in group chat context", async ({ request }) => {
    // Ask about remote work policy
    const first = await groupChatQuery(
      request,
      groupChatId,
      "What days are employees expected in the office?",
    );
    expect(answerContains(first, "tuesday") || answerContains(first, "thursday")).toBe(true);

    // Follow up — the bot should have context from the group chat history
    const followUp = await groupChatQuery(
      request,
      groupChatId,
      "What about Monday and Friday?",
    );

    const lower = followUp.answer.toLowerCase();
    expect(
      lower.includes("remote") || lower.includes("flexible") || lower.includes("monday"),
    ).toBe(true);
  });

  // ─── Message Persistence ──────────────────────────────────────────────────

  test("group chat messages are persisted and retrievable", async ({ request }) => {
    const res = await request.get(`/api/group-chats/${groupChatId}/messages`);
    expect(res.ok()).toBe(true);
    const messages = await res.json();

    // Should have messages from our queries (user messages + bot responses)
    expect(messages.length).toBeGreaterThanOrEqual(2);

    // Verify we can find at least one bot response
    const botMessages = messages.filter(
      (m: { senderType?: string; role?: string }) =>
        m.senderType === "bot" || m.role === "assistant",
    );
    expect(botMessages.length).toBeGreaterThan(0);
  });

  // ─── Group Chat Metadata ──────────────────────────────────────────────────

  test("group chat detail includes shared data sources", async ({ request }) => {
    const res = await request.get(`/api/group-chats/${groupChatId}`);
    expect(res.ok()).toBe(true);
    const chat = await res.json();

    expect(chat.sharedDataSources).toBeDefined();
    expect(chat.sharedDataSources.length).toBeGreaterThan(0);
    expect(chat.sharedDataSources[0].dataSourceId).toBe(sourceId);
  });

  test("group chat can be listed in user's chats", async ({ request }) => {
    const res = await request.get("/api/group-chats");
    expect(res.ok()).toBe(true);
    const chats = await res.json();

    const found = chats.some((c: { id: string }) => c.id === groupChatId);
    expect(found).toBe(true);
  });
});
