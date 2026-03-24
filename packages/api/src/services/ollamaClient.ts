/**
 * Ollama HTTP client — wraps the Ollama REST API for model management.
 *
 * Ollama API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
 */
import { execSync } from "child_process";
import os from "os";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import type { InstalledModel, PullProgressEvent, SystemResources } from "@edgebric/types";
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
  const ramAvailableBytes = os.freemem();

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

  return { ramTotalBytes, ramAvailableBytes, diskFreeBytes, diskTotalBytes };
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
