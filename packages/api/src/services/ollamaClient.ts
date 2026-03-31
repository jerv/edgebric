/**
 * Ollama HTTP client — wraps the Ollama REST API for model management.
 *
 * Ollama API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import type { InstalledModel, PullProgressEvent, SystemResources, StorageBreakdown } from "@edgebric/types";
import { MODEL_CATALOG_MAP } from "@edgebric/types";

function baseUrl(): string {
  return config.ollama.baseUrl;
}

// ─── Health ──────────────────────────────────────────────────────────────────

/** Check if Ollama is running and reachable. */
export async function isRunning(): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl()}/api/version`, {
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── Model Listing ───────────────────────────────────────────────────────────

interface OllamaTagModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
}

interface OllamaRunningModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  size_vram: number;
  expires_at: string;
}

/** List all locally installed models. */
export async function listInstalled(): Promise<InstalledModel[]> {
  const resp = await fetch(`${baseUrl()}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) throw new OllamaError("Failed to list models", resp.status);
  const data = (await resp.json()) as { models: OllamaTagModel[] };

  return data.models.map((m) => {
    const tag = normalizeTag(m.name);
    const catalog = MODEL_CATALOG_MAP.get(tag);
    return {
      tag,
      name: catalog?.name ?? m.details.family ?? tag,
      sizeBytes: m.size,
      digest: m.digest,
      modifiedAt: m.modified_at,
      status: "installed" as const,
      catalogEntry: catalog ?? undefined,
    };
  });
}

/** List models currently loaded in RAM with their memory usage. */
export async function listRunning(): Promise<Map<string, { ramUsageBytes: number }>> {
  const resp = await fetch(`${baseUrl()}/api/ps`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) throw new OllamaError("Failed to list running models", resp.status);
  const data = (await resp.json()) as { models: OllamaRunningModel[] };

  const map = new Map<string, { ramUsageBytes: number }>();
  for (const m of data.models) {
    map.set(normalizeTag(m.name), { ramUsageBytes: m.size_vram });
  }
  return map;
}

// ─── Model Operations ────────────────────────────────────────────────────────

/** Pull (download) a model from Ollama registry. Streams progress via callback. */
export async function pullModel(
  tag: string,
  onProgress: (event: PullProgressEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(`${baseUrl()}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: tag, stream: true }),
    signal: signal ?? null,
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new OllamaError(`Failed to pull model ${tag}: ${body}`, resp.status);
  }

  if (!resp.body) throw new OllamaError("No response body from pull", 500);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // Keep the last partial line in the buffer
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as { status: string; completed?: number; total?: number };
        const percent = event.total && event.total > 0
          ? Math.round((event.completed ?? 0) / event.total * 100)
          : undefined;
        onProgress({ status: event.status, completed: event.completed, total: event.total, percent });
      } catch {
        // Malformed JSON line, skip
      }
    }
  }

  // Process any remaining buffer
  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer) as { status: string };
      onProgress({ status: event.status });
    } catch {
      // ignore
    }
  }

  logger.info({ tag }, "Model pull complete");
}

/** Delete a model from disk. */
export async function deleteModel(tag: string): Promise<void> {
  const resp = await fetch(`${baseUrl()}/api/delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: tag }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new OllamaError(`Failed to delete model ${tag}: ${body}`, resp.status);
  }
  logger.info({ tag }, "Model deleted");
}

/**
 * Load a model into RAM (preload). Uses Ollama's generate endpoint with
 * an empty prompt and extended keep_alive to warm the model.
 */
export async function loadModel(tag: string): Promise<void> {
  const resp = await fetch(`${baseUrl()}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: tag, keep_alive: "30m" }),
    signal: AbortSignal.timeout(120_000), // 2 min timeout for cold loads
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new OllamaError(`Failed to load model ${tag}: ${body}`, resp.status);
  }
  // Consume the response body (Ollama returns a streaming response even for empty prompt)
  await resp.text();
  logger.info({ tag }, "Model loaded into RAM");
}

/**
 * Unload a model from RAM. Sets keep_alive to 0 which causes Ollama
 * to immediately evict the model.
 */
export async function unloadModel(tag: string): Promise<void> {
  const resp = await fetch(`${baseUrl()}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: tag, keep_alive: "0" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new OllamaError(`Failed to unload model ${tag}: ${body}`, resp.status);
  }
  await resp.text();
  logger.info({ tag }, "Model unloaded from RAM");
}

// ─── System Resources ────────────────────────────────────────────────────────

/** Get system RAM and disk usage. */
export function getSystemResources(): SystemResources {
  const ramTotalBytes = os.totalmem();
  let ramAvailableBytes = os.freemem();

  // macOS: os.freemem() only reports "free" pages, not "free + inactive + purgeable"
  // which is what's actually available. Use vm_stat for realistic numbers.
  if (process.platform === "darwin") {
    try {
      const vmstat = execSync("vm_stat 2>/dev/null", { encoding: "utf8" });
      const pageSize = parseInt(vmstat.match(/page size of (\d+)/)?.[1] ?? "16384", 10);
      const free = parseInt(vmstat.match(/Pages free:\s+(\d+)/)?.[1] ?? "0", 10);
      const inactive = parseInt(vmstat.match(/Pages inactive:\s+(\d+)/)?.[1] ?? "0", 10);
      const purgeable = parseInt(vmstat.match(/Pages purgeable:\s+(\d+)/)?.[1] ?? "0", 10);
      ramAvailableBytes = (free + inactive + purgeable) * pageSize;
    } catch { /* fall back to os.freemem() */ }
  }

  // API server process memory
  const serverRamBytes = process.memoryUsage().rss;

  let diskFreeBytes = 0;
  let diskTotalBytes = 0;
  try {
    const output = execSync(`df -k "${config.dataDir}" 2>/dev/null`, { encoding: "utf8" });
    const lines = output.trim().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1]!.split(/\s+/);
      const totalBlocks = parseInt(parts[1]!, 10);
      const availableBlocks = parseInt(parts[3]!, 10);
      diskTotalBytes = totalBlocks * 1024;
      diskFreeBytes = availableBlocks * 1024;
    }
  } catch {
    // Can't read disk info — leave as 0
  }

  return { ramTotalBytes, ramAvailableBytes, diskFreeBytes, diskTotalBytes, serverRamBytes };
}

// ─── Storage Breakdown ───────────────────────────────────────────────────────

/** Recursively compute directory size in bytes. */
function dirSize(dirPath: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += dirSize(full);
      } else if (entry.isFile()) {
        total += fs.statSync(full).size;
      }
    }
  } catch { /* permission errors, etc. */ }
  return total;
}

/** Get disk usage breakdown for Edgebric data. */
export function getStorageBreakdown(): StorageBreakdown {
  const dir = config.dataDir;
  let dbBytes = 0;
  let uploadsBytes = 0;
  let ollamaModelsBytes = 0;
  const vaultBytes = 0;

  try {
    for (const f of ["edgebric.db", "edgebric.db-wal", "edgebric.db-shm"]) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) dbBytes += fs.statSync(p).size;
    }
  } catch { /* ignore */ }

  try {
    const uploadsDir = path.join(dir, "uploads");
    if (fs.existsSync(uploadsDir)) uploadsBytes = dirSize(uploadsDir);
  } catch { /* ignore */ }

  try {
    const modelsDir = path.join(dir, ".ollama", "models");
    if (fs.existsSync(modelsDir)) ollamaModelsBytes = dirSize(modelsDir);
  } catch { /* ignore */ }

  return { dbBytes, uploadsBytes, ollamaModelsBytes, vaultBytes };
}

// ─── Embeddings ──────────────────────────────────────────────────────────────

/** Generate an embedding vector for the given text using Ollama. */
export async function embed(text: string, model?: string): Promise<number[]> {
  const resp = await fetch(`${baseUrl()}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model ?? config.ollama.embeddingModel,
      prompt: text,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new OllamaError(`Failed to generate embedding: ${body}`, resp.status);
  }

  const data = (await resp.json()) as { embedding: number[] };
  if (!data.embedding || data.embedding.length === 0) {
    throw new OllamaError("Empty embedding response from Ollama", 500);
  }

  return data.embedding;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize an Ollama model name to its canonical tag form.
 * Ollama sometimes returns "qwen3:4b" and sometimes "qwen3:4b-q4_0" —
 * we strip the quantization suffix for matching against our catalog.
 * Also strips ":latest" suffix since it's the default.
 */
function normalizeTag(name: string): string {
  return name.replace(/:latest$/, "");
}

export class OllamaError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = "OllamaError";
  }
}
