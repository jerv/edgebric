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
import { MODEL_FILENAME_MAP, MODEL_CATALOG_MAP, getAllShardFilenames, getAllShardUrls, allShardsPresent, findCatalogForShard } from "@edgebric/types";

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

/** Build auth headers for a llama-server role. */
function inferenceHeaders(role: "chat" | "embedding"): Record<string, string> {
  const key = role === "chat"
    ? (config.chat.apiKey !== "no-key" ? config.chat.apiKey : "")
    : config.inference.embeddingApiKey;
  if (key) return { Authorization: `Bearer ${key}` };
  return {};
}

/** Check if the chat llama-server is running and reachable. */
export async function isRunning(): Promise<boolean> {
  try {
    const resp = await fetch(`${chatBaseUrl()}/health`, {
      headers: inferenceHeaders("chat"),
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
      headers: inferenceHeaders("embedding"),
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

  // Collect all .gguf files on disk
  const diskFiles = new Set<string>();
  const fileSizes = new Map<string, { size: number; mtime: string }>();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".gguf")) continue;
    diskFiles.add(entry.name);
    const stat = fs.statSync(path.join(dir, entry.name));
    fileSizes.set(entry.name, { size: stat.size, mtime: stat.mtime.toISOString() });
  }

  const models: InstalledModel[] = [];
  const seen = new Set<string>(); // track filenames already accounted for

  for (const filename of diskFiles) {
    if (seen.has(filename)) continue;

    // Check if this file belongs to a catalog entry (direct or as a shard)
    const catalog = MODEL_FILENAME_MAP.get(filename) ?? findCatalogForShard(filename);

    if (catalog) {
      // For split models, check if ALL shards are present
      const shards = getAllShardFilenames(catalog.ggufFilename);
      const allPresent = allShardsPresent(catalog.ggufFilename, diskFiles);

      if (shards.length > 1) {
        // Mark all shards as seen regardless of completeness
        for (const s of shards) seen.add(s);

        if (!allPresent) {
          // Partial download — don't list as installed
          continue;
        }

        // Sum sizes across all shards, use latest mtime
        let totalSize = 0;
        let latestMtime = "";
        for (const s of shards) {
          const info = fileSizes.get(s);
          if (info) {
            totalSize += info.size;
            if (info.mtime > latestMtime) latestMtime = info.mtime;
          }
        }

        models.push({
          tag: catalog.tag,
          filename: catalog.ggufFilename, // first shard filename (llama.cpp loads from this)
          name: catalog.name,
          sizeBytes: totalSize,
          modifiedAt: latestMtime,
          status: "installed",
          catalogEntry: catalog,
        });
      } else {
        // Single file catalog model
        seen.add(filename);
        const info = fileSizes.get(filename)!;
        models.push({
          tag: catalog.tag,
          filename,
          name: catalog.name,
          sizeBytes: info.size,
          modifiedAt: info.mtime,
          status: "installed",
          catalogEntry: catalog,
        });
      }
    } else {
      // Community / unknown model — single file
      seen.add(filename);
      const info = fileSizes.get(filename)!;
      models.push({
        tag: filename.replace(/\.gguf$/, ""),
        filename,
        name: filename.replace(/\.gguf$/, ""),
        sizeBytes: info.size,
        modifiedAt: info.mtime,
        status: "installed",
      });
    }
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
      headers: inferenceHeaders("chat"),
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) {
      const slots = await resp.json().catch(() => null);
      if (!Array.isArray(slots) || slots.length === 0) {
        return map;
      }
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
 * Download a single file from a URL to disk, reporting progress as bytes.
 * Used internally by pullModel for each shard.
 */
async function downloadSingleFile(
  url: string,
  finalPath: string,
  onData: (chunkBytes: number) => void,
  signal?: AbortSignal,
): Promise<number> {
  const tmpPath = finalPath + ".tmp";
  const { default: https } = await import("https");
  const { default: http } = await import("http");

  return new Promise<number>((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Download cancelled")); return; }
    const onAbort = () => { reject(new Error("Download cancelled")); };
    signal?.addEventListener("abort", onAbort, { once: true });

    const download = (downloadUrl: string, redirectCount = 0) => {
      if (redirectCount > 10) { reject(new Error("Too many redirects")); return; }

      const proto = downloadUrl.startsWith("https") ? https : http;
      const req = proto.get(downloadUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          download(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }

        const shardSize = parseInt(res.headers["content-length"] ?? "0", 10);
        const file = fs.createWriteStream(tmpPath);

        res.on("data", (chunk: Buffer) => {
          onData(chunk.length);
        });

        res.pipe(file);
        file.on("finish", () => {
          file.close(() => {
            signal?.removeEventListener("abort", onAbort);
            fs.renameSync(tmpPath, finalPath);
            resolve(shardSize);
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

    download(url);
  });
}

/**
 * Download a GGUF model from its catalog URL with progress reporting.
 * Handles both single-file and split GGUF models.
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

  const shardFilenames = getAllShardFilenames(catalog.ggufFilename);
  const shardUrls = getAllShardUrls(catalog.downloadUrl, catalog.ggufFilename);
  const isSplit = shardFilenames.length > 1;

  // Approximate total bytes from catalog downloadSizeGB
  const estimatedTotalBytes = Math.round(catalog.downloadSizeGB * 1024 * 1024 * 1024);
  let totalDownloaded = 0;

  for (let i = 0; i < shardFilenames.length; i++) {
    if (signal?.aborted) throw new Error("Download cancelled");

    const shardPath = path.join(dir, shardFilenames[i]!);
    const shardUrl = shardUrls[i]!;

    if (isSplit) {
      logger.info({ tag, shard: i + 1, total: shardFilenames.length, filename: shardFilenames[i] }, "Downloading shard");
    }

    await downloadSingleFile(
      shardUrl,
      shardPath,
      (chunkBytes) => {
        totalDownloaded += chunkBytes;
        const percent = estimatedTotalBytes > 0
          ? Math.min(99, Math.round((totalDownloaded / estimatedTotalBytes) * 100))
          : 0;
        onProgress({
          status: isSplit ? `downloading shard ${i + 1}/${shardFilenames.length}` : "downloading",
          completed: totalDownloaded,
          total: estimatedTotalBytes,
          percent,
        });
      },
      signal,
    );
  }

  onProgress({ status: "success" });
  logger.info({ tag, filename: catalog.ggufFilename, shards: shardFilenames.length }, "Model download complete");
}

/** Delete a GGUF model file (and all shards for split models) from disk. */
export async function deleteModel(tag: string): Promise<void> {
  const dir = modelsDir();
  // Find file by catalog tag or direct filename match
  const catalog = [...MODEL_FILENAME_MAP.values()].find(c => c.tag === tag);
  const filename = catalog?.ggufFilename ?? `${tag}.gguf`;

  // Get all shard filenames (single-file models return array of 1)
  const shards = getAllShardFilenames(filename);
  let deletedAny = false;

  for (const shard of shards) {
    const shardPath = path.join(dir, shard);
    if (fs.existsSync(shardPath)) {
      fs.unlinkSync(shardPath);
      deletedAny = true;
    }
  }

  // Also clean up any .tmp files from partial downloads
  for (const shard of shards) {
    const tmpPath = path.join(dir, shard + ".tmp");
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  if (deletedAny) {
    logger.info({ tag, files: shards, count: shards.length }, "Model deleted");
    return;
  }

  // Fallback: try to find by partial match (community models)
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const match = files.find(f => f.toLowerCase().includes(tag.toLowerCase()) && f.endsWith(".gguf"));
  if (match) {
    fs.unlinkSync(path.join(dir, match));
    logger.info({ tag, file: match }, "Model deleted");
    return;
  }

  throw new InferenceError(`Model file not found: ${filename}`, 404);
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
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.inference.embeddingApiKey) {
    headers["Authorization"] = `Bearer ${config.inference.embeddingApiKey}`;
  }
  const resp = await fetch(`${embeddingBaseUrl()}/v1/embeddings`, {
    method: "POST",
    headers,
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
