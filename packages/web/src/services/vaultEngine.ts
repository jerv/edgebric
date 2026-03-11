/**
 * Vault Mode engine — local Ollama + IndexedDB RAG.
 *
 * All inference and search runs on the user's device via Ollama.
 * Chunks are synced from the server and embedded locally.
 * Nothing leaves the device during queries.
 */

import { openDB, type IDBPDatabase } from "idb";
import type { ChunkMetadata, Citation } from "@edgebric/types";

// ─── Types ───────────────────────────────────────────────────────────────────

interface StoredChunk {
  chunkId: string;
  content: string;
  metadata: ChunkMetadata;
  embedding?: number[];
}

interface SyncMeta {
  id: "main";
  version: string;
  lastSync: string;
  embeddingsComplete: boolean;
  chunkCount: number;
}

interface ScoredChunk {
  chunk: StoredChunk;
  score: number;
}

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

interface OllamaEmbedResponse {
  embedding: number[];
}

interface OllamaChatChunk {
  message?: { content: string };
  done?: boolean;
}

// ─── Query safety filter ─────────────────────────────────────────────────────
// Mirrors packages/core/src/rag/queryFilter.ts + packages/core/src/shared/piiTerms.ts
// Inlined here to avoid adding @edgebric/core as a web dependency.

const SENSITIVE_TERMS = [
  "salary", "compensation", "wage", "pay", "pip", "performance improvement",
  "performance improvement plan", "termination", "terminated", "fired",
  "laid off", "layoff", "accommodation", "disability", "investigation",
  "complaint", "harassment", "discipline", "disciplinary", "warning",
  "suspension", "ssn", "social security", "dob", "date of birth",
];

function looksLikePersonName(text: string): boolean {
  return /\b[A-Z][a-z]+(?:'s)?\s+[A-Z][a-z]+\b/.test(text) ||
    /\b[A-Z][a-z]+'s\b/.test(text);
}

function containsSensitiveTerm(text: string): boolean {
  const lower = text.toLowerCase();
  return SENSITIVE_TERMS.some((t) => lower.includes(t));
}

const QUERY_FILTER_REDIRECT =
  "Edgebric provides company-wide policy information and cannot access records about specific individuals. For questions about your personal situation, please contact your administrator or the relevant team directly.";

// ─── Constants ───────────────────────────────────────────────────────────────

const DB_NAME = "edgebric-vault";
const DB_VERSION = 1;
const OLLAMA_URL = "http://localhost:11434";
const EMBEDDING_MODEL = "nomic-embed-text";
const VAULT_CHAT_MODEL_KEY = "edgebric-vault-chat-model";

export function getVaultChatModel(): string {
  return localStorage.getItem(VAULT_CHAT_MODEL_KEY) ?? "llama3.2:3b";
}

export function setVaultChatModel(model: string): void {
  localStorage.setItem(VAULT_CHAT_MODEL_KEY, model);
}

// Mirrors packages/core/src/rag/systemPrompt.ts — buildSystemPrompt()
const SYSTEM_PROMPT_HEADER = `You are a company knowledge assistant. Your job is to answer questions accurately using only the documents provided below. Identify the organization and context from the documents themselves.

Rules you must follow without exception:
1. Answer ONLY using information from the provided context. Do not use outside knowledge.
2. If the answer is not in the context, say clearly: "I couldn't find a clear answer in the current documentation. Please contact your administrator or the relevant team directly." Do not guess or infer.
3. Never reveal information about named individuals — not salaries, performance history, disciplinary records, or any other personal information.
4. Do NOT include source citations, references, or a "Sources" section in your answer. The system displays sources separately.
5. Your answers are informational only. You are not a lawyer. Do not provide legal advice.

Context from company policy documents:`;

const NO_ANSWER_RESPONSE =
  "I couldn't find a clear answer in the current documentation. Please contact your administrator or the relevant team directly.";

// ─── IndexedDB ───────────────────────────────────────────────────────────────

type VaultDB = IDBPDatabase<{
  chunks: { key: string; value: StoredChunk };
  syncMeta: { key: string; value: SyncMeta };
}>;

export async function openVaultDB(): Promise<VaultDB> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("chunks")) {
        db.createObjectStore("chunks", { keyPath: "chunkId" });
      }
      if (!db.objectStoreNames.contains("syncMeta")) {
        db.createObjectStore("syncMeta", { keyPath: "id" });
      }
    },
  }) as Promise<VaultDB>;
}

export async function storeChunks(
  db: VaultDB,
  chunks: Array<{
    chunkId: string;
    content: string;
    metadata: Record<string, unknown>;
    embedding: number[];
  }>,
): Promise<void> {
  const tx = db.transaction("chunks", "readwrite");
  for (const chunk of chunks) {
    await tx.store.put({
      chunkId: chunk.chunkId,
      content: chunk.content,
      metadata: chunk.metadata as unknown as ChunkMetadata,
      embedding: chunk.embedding,
    });
  }
  await tx.done;
}

export async function storeSyncMeta(
  db: VaultDB,
  meta: Omit<SyncMeta, "id">,
): Promise<void> {
  await db.put("syncMeta", { id: "main", ...meta });
}

export async function clearAllData(db: VaultDB): Promise<void> {
  const tx1 = db.transaction("chunks", "readwrite");
  await tx1.store.clear();
  await tx1.done;
  const tx2 = db.transaction("syncMeta", "readwrite");
  await tx2.store.clear();
  await tx2.done;
}

/** Get all local chunks for a document, ordered by chunkIndex. Used by source viewer in vault mode. */
export async function getLocalChunksForDocument(documentId: string): Promise<Array<{
  chunkIndex: number;
  heading: string;
  sectionPath: string[];
  pageNumber: number;
  content: string;
}>> {
  const db = await openVaultDB();
  const allChunks = await db.getAll("chunks");
  db.close();

  return allChunks
    .filter((c) => c.metadata.sourceDocument === documentId)
    .map((c) => ({
      chunkIndex: c.metadata.chunkIndex,
      heading: c.metadata.heading,
      sectionPath: c.metadata.sectionPath,
      pageNumber: c.metadata.pageNumber,
      content: c.content,
    }))
    .sort((a, b) => a.chunkIndex - b.chunkIndex);
}

// ─── Ollama connectivity ─────────────────────────────────────────────────────

export async function checkOllama(): Promise<{
  running: boolean;
  models: string[];
}> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!r.ok) return { running: false, models: [] };
    const data = (await r.json()) as OllamaTagsResponse;
    const models = (data.models ?? []).map((m) => m.name);
    return { running: true, models };
  } catch {
    return { running: false, models: [] };
  }
}

// ─── Vector math ─────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Embed ───────────────────────────────────────────────────────────────────

async function embed(text: string): Promise<number[]> {
  const r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
  });
  if (!r.ok) throw new Error(`Ollama embed failed: ${r.status}`);
  const data = (await r.json()) as OllamaEmbedResponse;
  return data.embedding;
}

// ─── Search ──────────────────────────────────────────────────────────────────

async function searchChunks(
  db: VaultDB,
  queryText: string,
  topK = 5,
): Promise<ScoredChunk[]> {
  const queryEmbedding = await embed(queryText);
  const allChunks = await db.getAll("chunks");

  const scored: ScoredChunk[] = allChunks
    .filter((c) => c.embedding != null)
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding!),
    }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ─── Query (full RAG pipeline) ───────────────────────────────────────────────

export async function* vaultQuery(
  query: string,
  conversationMessages: Array<{ role: string; content: string }>,
): AsyncGenerator<
  | { type: "delta"; delta: string }
  | { type: "done"; answer: string; citations: Citation[]; hasConfidentAnswer: boolean }
> {
  // 0. Query safety filter (mirrors server-side filterQuery)
  if (looksLikePersonName(query) && containsSensitiveTerm(query)) {
    yield { type: "delta", delta: QUERY_FILTER_REDIRECT };
    yield { type: "done", answer: QUERY_FILTER_REDIRECT, citations: [], hasConfidentAnswer: false };
    return;
  }

  const db = await openVaultDB();

  // 1. Search local chunks
  const results = await searchChunks(db, query, 5);
  db.close();

  const relevantResults = results.filter((r) => r.score > 0.3);

  // If no relevant chunks, return consistent no-answer (matches server orchestrator)
  if (relevantResults.length === 0) {
    yield { type: "delta", delta: NO_ANSWER_RESPONSE };
    yield { type: "done", answer: NO_ANSWER_RESPONSE, citations: [], hasConfidentAnswer: false };
    return;
  }

  // 2. Build context block (mirrors core/rag/systemPrompt.ts — buildSystemPrompt)
  const contextBlock = relevantResults
    .map((r, i) => {
      const path = r.chunk.metadata.sectionPath.join(" > ");
      const docLabel = r.chunk.metadata.documentName ?? "Policy Document";
      return `[Source ${i + 1}: ${docLabel} | ${path} | Page ${r.chunk.metadata.pageNumber}]\n${r.chunk.content}`;
    })
    .join("\n\n---\n\n");

  // 3. Build messages for Ollama
  const ollamaMessages: Array<{ role: string; content: string }> = [
    { role: "system", content: `${SYSTEM_PROMPT_HEADER}\n\n${contextBlock}` },
  ];

  // Add conversation history (last 4 messages for multi-turn)
  for (const msg of conversationMessages.slice(-4)) {
    ollamaMessages.push({ role: msg.role, content: msg.content });
  }

  // Add current query with /nothink to suppress thinking mode (matches milm.ts)
  ollamaMessages.push({ role: "user", content: query + " /nothink" });

  // 4. Stream response from Ollama
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: getVaultChatModel(),
      messages: ollamaMessages,
      stream: true,
    }),
  });

  if (!r.ok) throw new Error(`Ollama chat failed: ${r.status}`);

  const reader = r.body?.getReader();
  if (!reader) throw new Error("No response body from Ollama");

  const decoder = new TextDecoder();
  let fullAnswer = "";
  let buffer = "";
  let insideThink = false; // Track <think>...</think> blocks from reasoning models

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as OllamaChatChunk;
        if (parsed.message?.content) {
          let content = parsed.message.content;

          // Filter out <think>...</think> blocks (Qwen3, DeepSeek, etc.)
          if (insideThink) {
            const closeIdx = content.indexOf("</think>");
            if (closeIdx !== -1) {
              insideThink = false;
              content = content.slice(closeIdx + "</think>".length);
            } else {
              continue; // Still inside think block, skip entirely
            }
          }

          // Check for opening <think> tag in remaining content
          const openIdx = content.indexOf("<think>");
          if (openIdx !== -1) {
            const before = content.slice(0, openIdx);
            const afterOpen = content.slice(openIdx + "<think>".length);
            const closeIdx = afterOpen.indexOf("</think>");
            if (closeIdx !== -1) {
              // Complete think block in one chunk — strip it
              content = before + afterOpen.slice(closeIdx + "</think>".length);
            } else {
              // Think block started but not closed — emit what came before, enter think mode
              content = before;
              insideThink = true;
            }
          }

          // Strip leading whitespace from the very first visible content
          if (fullAnswer === "" && content.length > 0) {
            content = content.trimStart();
          }

          if (content) {
            fullAnswer += content;
            yield { type: "delta", delta: content };
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  // 5. Build citations from search results (mirrors server orchestrator format)
  const citations: Citation[] = relevantResults.map((r) => ({
    documentId: r.chunk.metadata.sourceDocument,
    documentName: r.chunk.metadata.documentName ?? r.chunk.metadata.sourceDocument,
    sectionPath: r.chunk.metadata.sectionPath,
    pageNumber: r.chunk.metadata.pageNumber,
    excerpt: r.chunk.content.slice(0, 300),
  }));

  yield {
    type: "done",
    answer: fullAnswer,
    citations,
    hasConfidentAnswer: true,
  };
}
