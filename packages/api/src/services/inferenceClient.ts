/**
 * Inference client — wraps llama-server's OpenAI-compatible REST API.
 *
 * llama-server runs two instances:
 *   - Chat (port 8080): /v1/chat/completions
 *   - Embedding (port 8081): /v1/embeddings
 *
 * Model management is filesystem-based (GGUF files in the models directory).
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import type { InstalledModel, PullProgressEvent, SystemResources, StorageBreakdown } from "@edgebric/types";
import { MODEL_FILENAME_MAP, MODEL_CATALOG_MAP } from "@edgebric/types";

function chatBaseUrl(): string {
  return config.inference.chatBaseUrl;
}

function embeddingBaseUrl(): string {
  return config.inference.embeddingBaseUrl;
}

function modelsDir(): string {
  // Use explicit MODELS_DIR if set, otherwise derive from DATA_DIR
  if (config.inference.modelsDir) return config.inference.modelsDir;
  return path.join(config.dataDir, ".llama", "models");
}

// ─── Health ──────────────────────────────────────────────────────────────────

/** Check if the chat llama-server is running and reachable. */
export async function isRunning(): Promise<boolean> {
  try {
    const resp = await fetch(`${chatBaseUrl()}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Check if the embedding llama-server is running and reachable. */
export async function isEmbeddingRunning(): Promise<boolean> {
  try {
    const resp = await fetch(`${embeddingBaseUrl()}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── Model Listing ───────────────────────────────────────────────────────────

/** List all locally installed GGUF model files. */
export async function listInstalled(): Promise<InstalledModel[]> {
  const dir = modelsDir();
  if (!fs.existsSync(dir)) return [];

  const models: InstalledModel[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".gguf")) continue;

    const fullPath = path.join(dir, entry.name);
    const stat = fs.statSync(fullPath);
    const catalog = MODEL_FILENAME_MAP.get(entry.name);

    models.push({
      tag: catalog?.tag ?? entry.name.replace(/\.gguf$/, ""),
      filename: entry.name,
      name: catalog?.name ?? entry.name.replace(/\.gguf$/, ""),
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      status: "installed",
      catalogEntry: catalog ?? undefined,
    });
  }

  return models;
}

/**
 * List models currently loaded in llama-server.
 * llama-server loads one model per instance, so we check health + slots.
 */
export async function listRunning(): Promise<Map<string, { ramUsageBytes: number }>> {
  const map = new Map<string, { ramUsageBytes: number }>();

  // Check chat server
  try {
    const resp = await fetch(`${chatBaseUrl()}/slots`, {
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) {
      // llama-server is running with a model loaded
      // Estimate RAM from model size (VRAM usage ≈ model file size * 1.2 for KV cache)
      const chatModel = config.chat.model;
      if (chatModel) {
        // Try to find the model file to estimate RAM usage
        const dir = modelsDir();
        const catalog = [...MODEL_FILENAME_MAP.values()].find(c => c.tag === chatModel);
        const filename = catalog?.ggufFilename ?? `${chatModel}.gguf`;
        const modelPath = path.join(dir, filename);
        let ramEstimate = 0;
        try {
          if (fs.existsSync(modelPath)) {
            ramEstimate = Math.round(fs.statSync(modelPath).size * 1.3); // rough estimate
          }
        } catch { /* ignore */ }
        map.set(chatModel, { ramUsageBytes: ramEstimate });
      }
    }
  } catch { /* chat server not running */ }

  return map;
}

// ─── Model Operations ────────────────────────────────────────────────────────

/**
 * "Load" a model — in llama-server this is a no-op from the API side.
 * Model loading is done by restarting the server with a different --model flag.
 * The desktop app handles this via IPC. The API server just tracks the active model.
 */
export async function loadModel(tag: string): Promise<void> {
  // Verify the chat server is running and healthy
  const running = await isRunning();
  if (!running) {
    throw new InferenceError(`Cannot load model: chat server is not running`, 503);
  }
  logger.info({ tag }, "Model set as active (llama-server manages loading)");
}

/**
 * "Unload" a model — no-op for API server. Desktop app handles server stop.
 */
export async function unloadModel(_tag: string): Promise<void> {
  logger.info({ tag: _tag }, "Model unload requested (desktop app manages server lifecycle)");
}

/**
 * Download a GGUF model from its catalog URL with progress reporting.
 */
export async function pullModel(
  tag: string,
  onProgress: (event: PullProgressEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const catalog = MODEL_CATALOG_MAP.get(tag);
  if (!catalog) {
    throw new InferenceError(`Unknown model tag: ${tag}`, 404);
  }

  const dir = modelsDir();
  fs.mkdirSync(dir, { recursive: true });

  const finalPath = path.join(dir, catalog.ggufFilename);
  const tmpPath = finalPath + ".tmp";

  const { default: https } = await import("https");
  const { default: http } = await import("http");

  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Download cancelled")); return; }
    const onAbort = () => { reject(new Error("Download cancelled")); };
    signal?.addEventListener("abort", onAbort, { once: true });

    const download = (url: string, redirectCount = 0) => {
      if (redirectCount > 10) { reject(new Error("Too many redirects")); return; }

      const proto = url.startsWith("https") ? https : http;
      const req = proto.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          download(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }

        const totalBytes = parseInt(res.headers["content-length"] ?? "0", 10);
        let downloadedBytes = 0;
        const file = fs.createWriteStream(tmpPath);

        res.on("data", (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const percent = Math.round((downloadedBytes / totalBytes) * 100);
            onProgress({ status: "downloading", completed: downloadedBytes, total: totalBytes, percent });
          }
        });

        res.pipe(file);
        file.on("finish", () => {
          file.close(() => {
            signal?.removeEventListener("abort", onAbort);
            fs.renameSync(tmpPath, finalPath);
            onProgress({ status: "success" });
            resolve();
          });
        });
        file.on("error", (err) => {
          signal?.removeEventListener("abort", onAbort);
          reject(err);
        });
      });

      req.on("error", (err) => {
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      });

      signal?.addEventListener("abort", () => {
        req.destroy();
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      }, { once: true });
    };

    download(catalog.downloadUrl);
  });

  logger.info({ tag, filename: catalog.ggufFilename }, "Model download complete");
}

/** Delete a GGUF model file from disk. */
export async function deleteModel(tag: string): Promise<void> {
  const dir = modelsDir();
  // Find file by catalog tag or direct filename match
  const catalog = [...MODEL_FILENAME_MAP.values()].find(c => c.tag === tag);
  const filename = catalog?.ggufFilename ?? `${tag}.gguf`;
  const filePath = path.join(dir, filename);

  if (!fs.existsSync(filePath)) {
    // Try to find by partial match
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const match = files.find(f => f.toLowerCase().includes(tag.toLowerCase()) && f.endsWith(".gguf"));
    if (match) {
      fs.unlinkSync(path.join(dir, match));
      logger.info({ tag, file: match }, "Model deleted");
      return;
    }
    throw new InferenceError(`Model file not found: ${filename}`, 404);
  }

  fs.unlinkSync(filePath);
  logger.info({ tag, file: filename }, "Model deleted");
}

// ─── System Resources ────────────────────────────────────────────────────────

/** Get system RAM and disk usage. */
export function getSystemResources(): SystemResources {
  const ramTotalBytes = os.totalmem();
  let ramAvailableBytes = os.freemem();

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

  const serverRamBytes = process.memoryUsage().rss;

  let diskFreeBytes = 0;
  let diskTotalBytes = 0;
  try {
    const output = execSync(`df -k "${config.dataDir}" 2>/dev/null`, { encoding: "utf8" });
    const lines = output.trim().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1]!.split(/\s+/);
      diskTotalBytes = parseInt(parts[1]!, 10) * 1024;
      diskFreeBytes = parseInt(parts[3]!, 10) * 1024;
    }
  } catch { /* ignore */ }

  return { ramTotalBytes, ramAvailableBytes, diskFreeBytes, diskTotalBytes, serverRamBytes };
}

// ─── Storage Breakdown ───────────────────────────────────────────────────────

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
  } catch { /* permission errors */ }
  return total;
}

/** Get disk usage breakdown for Edgebric data. */
export function getStorageBreakdown(): StorageBreakdown {
  const dir = config.dataDir;
  let dbBytes = 0;
  let uploadsBytes = 0;
  let modelsBytes = 0;
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
    const mDir = modelsDir();
    if (fs.existsSync(mDir)) modelsBytes = dirSize(mDir);
  } catch { /* ignore */ }

  return { dbBytes, uploadsBytes, modelsBytes, vaultBytes };
}

// ─── Embeddings ──────────────────────────────────────────────────────────────

/** Generate an embedding vector using the embedding llama-server instance. */
export async function embed(text: string, _model?: string): Promise<number[]> {
  const resp = await fetch(`${embeddingBaseUrl()}/v1/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: text,
      model: "embedding", // llama-server ignores model name, uses loaded model
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new InferenceError(`Failed to generate embedding: ${body}`, resp.status);
  }

  const data = (await resp.json()) as { data: Array<{ embedding: number[] }> };
  const embedding = data.data?.[0]?.embedding;
  if (!embedding || embedding.length === 0) {
    throw new InferenceError("Empty embedding response from llama-server", 500);
  }

  return embedding;
}

// ─── Error Class ─────────────────────────────────────────────────────────────

export class InferenceError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = "InferenceError";
  }
}
