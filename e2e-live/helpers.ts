/**
 * Shared helpers for live E2E tests.
 *
 * Provides: test data setup/teardown, SSE stream parsing,
 * document upload with ingestion wait, query with answer extraction.
 */

import type { APIRequestContext } from "@playwright/test";
import fs from "fs";
import path from "path";

const FIXTURES_DIR = path.join(__dirname, "fixtures");

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

export interface QueryResult {
  answer: string;
  citations: Array<{
    documentName?: string;
    dataSourceName?: string;
    sectionPath?: string[];
    excerpt?: string;
  }>;
  hasConfidentAnswer: boolean;
  conversationId?: string;
  messageId?: string;
  contextUsage?: {
    usedTokens: number;
    maxTokens: number;
    truncated: boolean;
  };
  answerType?: string;
  events: SSEEvent[]; // all raw events for inspection
}

// ─── SSE Parsing ────────────────────────────────────────────────────────────

/** Parse a raw SSE response body into structured events. */
export function parseSSE(body: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  let currentType = "";

  for (const line of body.split("\n")) {
    if (line.startsWith("event: ")) {
      currentType = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      try {
        events.push({ type: currentType, data: JSON.parse(line.slice(6)) });
      } catch { /* skip malformed */ }
    }
  }
  return events;
}

/** Extract the final answer from SSE events. */
export function extractAnswer(events: SSEEvent[]): QueryResult {
  const deltas = events.filter((e) => e.type === "delta" || ("delta" in e.data));
  const doneEvent = events.find((e) => e.type === "done");

  const streamedAnswer = deltas.map((e) => e.data.delta as string).join("");
  const finalData = doneEvent?.data ?? {};

  return {
    answer: (finalData.answer as string) ?? (finalData.content as string) ?? streamedAnswer,
    citations: (finalData.citations as QueryResult["citations"]) ?? [],
    hasConfidentAnswer: (finalData.hasConfidentAnswer as boolean) ?? false,
    conversationId: finalData.conversationId as string | undefined,
    messageId: finalData.messageId as string | undefined,
    contextUsage: finalData.contextUsage as QueryResult["contextUsage"],
    answerType: finalData.answerType as string | undefined,
    events,
  };
}

// ─── Data Source Management ─────────────────────────────────────────────────

export async function createDataSource(
  request: APIRequestContext,
  name: string,
): Promise<{ id: string; datasetName: string }> {
  const res = await request.post("/api/data-sources", { data: { name } });
  if (!res.ok()) throw new Error(`Failed to create data source: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function deleteDataSource(
  request: APIRequestContext,
  id: string,
): Promise<void> {
  await request.delete(`/api/data-sources/${id}`);
}

// ─── Document Upload + Ingestion Wait ───────────────────────────────────────

/** Upload a fixture file and wait for ingestion to complete. */
export async function uploadAndIngest(
  request: APIRequestContext,
  dataSourceId: string,
  fixtureName: string,
  opts?: { timeoutMs?: number },
): Promise<{ documentId: string; status: string }> {
  const filePath = path.join(FIXTURES_DIR, fixtureName);
  const buffer = fs.readFileSync(filePath);
  const mimeType = fixtureName.endsWith(".pdf") ? "application/pdf"
    : fixtureName.endsWith(".md") ? "text/markdown"
    : "text/plain";

  const uploadRes = await request.post(`/api/data-sources/${dataSourceId}/documents/upload`, {
    multipart: {
      file: { name: fixtureName, mimeType, buffer },
    },
  });
  if (!uploadRes.ok()) throw new Error(`Upload failed: ${uploadRes.status()} ${await uploadRes.text()}`);
  const { documentId } = await uploadRes.json();

  // Poll for ingestion completion
  const timeout = opts?.timeoutMs ?? 120_000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const docRes = await request.get(`/api/documents/${documentId}`);
    if (!docRes.ok()) throw new Error(`Doc check failed: ${docRes.status()}`);
    const doc = await docRes.json();

    if (doc.status === "ready") return { documentId, status: "ready" };
    if (doc.status === "failed") return { documentId, status: "failed" };
    if (doc.status === "pii_review") {
      // Auto-approve PII for test documents
      await request.post(`/api/documents/${documentId}/approve-pii`);
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error(`Ingestion timed out after ${timeout}ms for ${fixtureName}`);
}

// ─── Query Helpers ──────────────────────────────────────────────────────────

/** Send a query and parse the full SSE response. */
export async function query(
  request: APIRequestContext,
  text: string,
  opts?: {
    conversationId?: string;
    dataSourceIds?: string[];
    isPrivate?: boolean;
  },
): Promise<QueryResult> {
  const res = await request.fetch("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({
      query: text,
      conversationId: opts?.conversationId,
      dataSourceIds: opts?.dataSourceIds,
      private: opts?.isPrivate ?? false,
    }),
    timeout: 120_000,
  });

  if (res.status() !== 200) {
    throw new Error(`Query failed: ${res.status()} ${await res.text()}`);
  }

  const body = await res.text();
  const events = parseSSE(body);
  return extractAnswer(events);
}

/** Send a query in a group chat via @bot. */
export async function groupChatQuery(
  request: APIRequestContext,
  chatId: string,
  text: string,
): Promise<QueryResult> {
  const res = await request.fetch(`/api/group-chats/${chatId}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({ content: `@bot ${text}` }),
    timeout: 120_000,
  });

  if (res.status() !== 200) {
    throw new Error(`Group chat query failed: ${res.status()} ${await res.text()}`);
  }

  const body = await res.text();
  const events = parseSSE(body);
  return extractAnswer(events);
}

// ─── Assertions ─────────────────────────────────────────────────────────────

/** Check that an answer mentions specific keywords (case-insensitive). */
export function answerContains(result: QueryResult, ...keywords: string[]): boolean {
  const lower = result.answer.toLowerCase();
  return keywords.every((k) => lower.includes(k.toLowerCase()));
}

/** Check that an answer does NOT mention specific keywords. */
export function answerExcludes(result: QueryResult, ...keywords: string[]): boolean {
  const lower = result.answer.toLowerCase();
  return keywords.every((k) => !lower.includes(k.toLowerCase()));
}

/** Check that citations reference a specific document. */
export function hasCitationFrom(result: QueryResult, docNameFragment: string): boolean {
  return result.citations.some(
    (c) => c.documentName?.toLowerCase().includes(docNameFragment.toLowerCase()),
  );
}
