// ─── AI Model Management ─────────────────────────────────────────────────────

export type ModelStatus = "not_installed" | "installed" | "loaded" | "downloading";
export type ModelTier = "recommended" | "supported" | "community";

export interface ModelCapabilities {
  /** Can analyze images and screenshots */
  vision: boolean;
  /** Can use tools like search and file management */
  toolUse: boolean;
  /** Enhanced step-by-step reasoning */
  reasoning: boolean;
}

export interface ModelCatalogEntry {
  /** Unique model tag (e.g., "qwen3.5-4b") — used as identifier */
  tag: string;
  /** GGUF filename on disk (e.g., "Qwen3.5-4B-Q4_K_M.gguf") */
  ggufFilename: string;
  /** HuggingFace download URL for the GGUF file */
  downloadUrl: string;
  /** Display name (e.g., "Qwen 3.5 4B") */
  name: string;
  /** Model family / vendor (e.g., "Qwen", "Meta", "Microsoft", "Google") */
  family: string;
  /** One-line description */
  description: string;
  /** Human-readable param count (e.g., "4B", "8B") */
  paramCount: string;
  /** Approximate download size in GB */
  downloadSizeGB: number;
  /** Approximate RAM usage when loaded, in GB */
  ramUsageGB: number;
  /** Company or origin (e.g., "Alibaba", "Meta") */
  origin: string;
  /** Tier determines how this model is surfaced in the UI */
  tier: ModelTier;
  /** Minimum recommended RAM in GB to run this model */
  minRAMGB: number;
  /** If true, model is auto-installed and hidden from user (e.g., embedding models) */
  hidden?: boolean;
  /** Model capabilities (vision, tool use, reasoning) */
  capabilities: ModelCapabilities;
  /** Link to the model's HuggingFace page */
  huggingFaceUrl: string;
}

export interface InstalledModel {
  /** Model tag (matches catalog tag for known models, or GGUF filename for community) */
  tag: string;
  /** GGUF filename on disk */
  filename: string;
  /** Display name (from catalog or filename) */
  name: string;
  /** Size on disk in bytes */
  sizeBytes: number;
  /** Last modified timestamp */
  modifiedAt: string;
  /** Current status */
  status: ModelStatus;
  /** RAM usage in bytes (only set when model is loaded) */
  ramUsageBytes?: number | undefined;
  /** Matched catalog entry, if any (undefined for community models) */
  catalogEntry?: ModelCatalogEntry | undefined;
  /** Model capabilities (from catalog match or inferred from HuggingFace tags) */
  capabilities?: ModelCapabilities | undefined;
}

export interface SystemResources {
  ramTotalBytes: number;
  ramAvailableBytes: number;
  diskFreeBytes: number;
  diskTotalBytes: number;
  /** API server process RSS in bytes (Electron adds its own overhead on top). */
  serverRamBytes?: number;
}

export interface StorageBreakdown {
  /** GGUF model files on disk (bytes). */
  modelsBytes: number;
  /** Uploaded documents (bytes). */
  uploadsBytes: number;
  /** SQLite database files (bytes). */
  dbBytes: number;
  /** Vault-specific data (bytes). */
  vaultBytes: number;
}

export interface ModelsResponse {
  models: InstalledModel[];
  catalog: ModelCatalogEntry[];
  activeModel: string;
  system: SystemResources;
  storage?: StorageBreakdown;
}

export interface PullProgressEvent {
  status: string;
  completed?: number | undefined;
  total?: number | undefined;
  percent?: number | undefined;
}

// ─── Official Model Catalog ──────────────────────────────────────────────────

export const OFFICIAL_CATALOG: ModelCatalogEntry[] = [
  // ── Recommended (curated, tested with Edgebric) ──
  {
    tag: "qwen3.5-4b",
    ggufFilename: "Qwen3.5-4B-Q4_K_M.gguf",
    downloadUrl: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
    name: "Qwen 3.5 4B",
    family: "Qwen",
    description: "Best overall for most hardware. Vision + tool use, 256K context.",
    paramCount: "4B",
    downloadSizeGB: 2.7,
    ramUsageGB: 5.5,
    origin: "Alibaba",
    tier: "recommended",
    minRAMGB: 8,
    capabilities: { vision: true, toolUse: true, reasoning: false },
    huggingFaceUrl: "https://huggingface.co/Qwen/Qwen3.5-4B",
  },
  {
    tag: "qwen3.5-9b",
    ggufFilename: "Qwen3.5-9B-Q4_K_M.gguf",
    downloadUrl: "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf",
    name: "Qwen 3.5 9B",
    family: "Qwen",
    description: "Stronger reasoning and analysis. Vision + tool use. Best for 16GB machines.",
    paramCount: "9B",
    downloadSizeGB: 5.9,
    ramUsageGB: 9.5,
    origin: "Alibaba",
    tier: "recommended",
    minRAMGB: 16,
    capabilities: { vision: true, toolUse: true, reasoning: false },
    huggingFaceUrl: "https://huggingface.co/Qwen/Qwen3.5-9B",
  },
  {
    tag: "qwen3.5-35b-a3b",
    ggufFilename: "Qwen3.5-35B-A3B-Q4_K_M.gguf",
    downloadUrl: "https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-Q4_K_M.gguf",
    name: "Qwen 3.5 35B-A3B MoE",
    family: "Qwen",
    description: "35B params, only 3B active. Thinks like a big model, runs like a small one. Vision + tool use.",
    paramCount: "35B (3B active)",
    downloadSizeGB: 5.5,
    ramUsageGB: 9,
    origin: "Alibaba",
    tier: "recommended",
    minRAMGB: 16,
    capabilities: { vision: true, toolUse: true, reasoning: true },
    huggingFaceUrl: "https://huggingface.co/Qwen/Qwen3.5-35B-A3B",
  },
  // ── Supported (alternatives, known to work) ──
  {
    tag: "qwen3.5-27b",
    ggufFilename: "Qwen3.5-27B-Q4_K_M.gguf",
    downloadUrl: "https://huggingface.co/unsloth/Qwen3.5-27B-GGUF/resolve/main/Qwen3.5-27B-Q4_K_M.gguf",
    name: "Qwen 3.5 27B",
    family: "Qwen",
    description: "Highest quality dense model. Vision + tool use. For 32GB machines.",
    paramCount: "27B",
    downloadSizeGB: 16.5,
    ramUsageGB: 22,
    origin: "Alibaba",
    tier: "supported",
    minRAMGB: 32,
    capabilities: { vision: true, toolUse: true, reasoning: true },
    huggingFaceUrl: "https://huggingface.co/Qwen/Qwen3.5-27B",
  },
  {
    tag: "phi4-mini",
    ggufFilename: "Phi-4-mini-instruct-Q4_K_M.gguf",
    downloadUrl: "https://huggingface.co/bartowski/Phi-4-mini-instruct-GGUF/resolve/main/Phi-4-mini-instruct-Q4_K_M.gguf",
    name: "Phi-4 Mini",
    family: "Microsoft",
    description: "Compact, efficient, 128K context. Good for constrained setups.",
    paramCount: "3.8B",
    downloadSizeGB: 2.5,
    ramUsageGB: 5,
    origin: "Microsoft",
    tier: "supported",
    minRAMGB: 8,
    capabilities: { vision: false, toolUse: true, reasoning: false },
    huggingFaceUrl: "https://huggingface.co/microsoft/Phi-4-mini-instruct",
  },
  {
    tag: "gemma4-e4b",
    ggufFilename: "gemma-4-E4B-it-Q4_K_M.gguf",
    downloadUrl: "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf",
    name: "Gemma 4 E4B",
    family: "Google",
    description: "Google's latest efficient model. Vision, 128K context. Apache 2.0.",
    paramCount: "4B",
    downloadSizeGB: 5.0,
    ramUsageGB: 8,
    origin: "Google",
    tier: "supported",
    minRAMGB: 12,
    capabilities: { vision: true, toolUse: false, reasoning: false },
    huggingFaceUrl: "https://huggingface.co/google/gemma-4-E4B-it",
  },
  {
    tag: "gemma4-26b-a4b",
    ggufFilename: "gemma-4-26B-A4B-it-UD-Q4_K_M.gguf",
    downloadUrl: "https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/resolve/main/gemma-4-26B-A4B-it-UD-Q4_K_M.gguf",
    name: "Gemma 4 26B-A4B MoE",
    family: "Google",
    description: "26B params, only 4B active. Vision, strong reasoning. Apache 2.0.",
    paramCount: "26B (4B active)",
    downloadSizeGB: 16.9,
    ramUsageGB: 22,
    origin: "Google",
    tier: "supported",
    minRAMGB: 32,
    capabilities: { vision: true, toolUse: false, reasoning: true },
    huggingFaceUrl: "https://huggingface.co/google/gemma-4-26B-A4B-it",
  },
  {
    tag: "phi4-reasoning-vision",
    ggufFilename: "phi-4-reasoning-vision-q4_K_M.gguf",
    downloadUrl: "https://huggingface.co/jamesburton/Phi-4-reasoning-vision-15B-GGUF/resolve/main/phi-4-reasoning-vision-q4_K_M.gguf",
    name: "Phi-4 Reasoning Vision 15B",
    family: "Microsoft",
    description: "Vision + reasoning + tool use. Strong for document analysis. 15B params.",
    paramCount: "15B",
    downloadSizeGB: 9.1,
    ramUsageGB: 14,
    origin: "Microsoft",
    tier: "supported",
    minRAMGB: 24,
    capabilities: { vision: true, toolUse: true, reasoning: true },
    huggingFaceUrl: "https://huggingface.co/microsoft/Phi-4-reasoning-vision-15B",
  },
  // ── Large split-GGUF models ──
  {
    tag: "qwen3.5-122b-a10b",
    ggufFilename: "Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf",
    downloadUrl: "https://huggingface.co/unsloth/Qwen3.5-122B-A10B-GGUF/resolve/main/Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf",
    name: "Qwen 3.5 122B-A10B MoE",
    family: "Qwen",
    description: "122B params, 10B active. Frontier-class MoE on consumer hardware. 3 split files, 76.5 GB.",
    paramCount: "122B (10B active)",
    downloadSizeGB: 76.5,
    ramUsageGB: 85,
    origin: "Alibaba",
    tier: "supported",
    minRAMGB: 96,
    capabilities: { vision: true, toolUse: true, reasoning: true },
    huggingFaceUrl: "https://huggingface.co/Qwen/Qwen3.5-122B-A10B",
  },
  {
    tag: "minimax-m2.5",
    ggufFilename: "MiniMax-M2.5-UD-Q3_K_XL-00001-of-00004.gguf",
    downloadUrl: "https://huggingface.co/unsloth/MiniMax-M2.5-GGUF/resolve/main/MiniMax-M2.5-UD-Q3_K_XL-00001-of-00004.gguf",
    name: "MiniMax M2.5",
    family: "MiniMax",
    description: "MiniMax flagship model. 4 split files, 101 GB.",
    paramCount: "456B",
    downloadSizeGB: 101,
    ramUsageGB: 110,
    origin: "MiniMax",
    tier: "supported",
    minRAMGB: 128,
    capabilities: { vision: false, toolUse: true, reasoning: true },
    huggingFaceUrl: "https://huggingface.co/MiniMax/MiniMax-M2.5",
  },
  {
    tag: "glm-5.1",
    ggufFilename: "GLM-5.1-UD-IQ2_M-00001-of-00006.gguf",
    downloadUrl: "https://huggingface.co/unsloth/GLM-5.1-GGUF/resolve/main/GLM-5.1-UD-IQ2_M-00001-of-00006.gguf",
    name: "GLM 5.1",
    family: "GLM",
    description: "THUDM flagship model. 6 split files, 236 GB.",
    paramCount: "400B+",
    downloadSizeGB: 236,
    ramUsageGB: 250,
    origin: "THUDM",
    tier: "supported",
    minRAMGB: 256,
    capabilities: { vision: true, toolUse: true, reasoning: true },
    huggingFaceUrl: "https://huggingface.co/THUDM/GLM-5.1",
  },
  // ── Hidden infrastructure ──
  {
    tag: "nomic-embed-text",
    ggufFilename: "nomic-embed-text-v1.5.Q8_0.gguf",
    downloadUrl: "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf",
    name: "Nomic Embed Text",
    family: "Nomic",
    description: "Text embedding model for semantic search.",
    paramCount: "137M",
    downloadSizeGB: 0.15,
    ramUsageGB: 0.3,
    origin: "Nomic",
    tier: "recommended",
    minRAMGB: 4,
    hidden: true,
    capabilities: { vision: false, toolUse: false, reasoning: false },
    huggingFaceUrl: "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5",
  },
];

/** Lookup catalog entry by tag. Returns undefined for community models. */
export const MODEL_CATALOG_MAP: ReadonlyMap<string, ModelCatalogEntry> = new Map(
  OFFICIAL_CATALOG.map((m) => [m.tag, m]),
);

/** Lookup catalog entry by GGUF filename. */
export const MODEL_FILENAME_MAP: ReadonlyMap<string, ModelCatalogEntry> = new Map(
  OFFICIAL_CATALOG.map((m) => [m.ggufFilename, m]),
);

// ─── Split GGUF Helpers ─────────────────────────────────────────────────────

/** Pattern: `-NNNNN-of-NNNNN` before the `.gguf` extension. */
const SPLIT_GGUF_RE = /-(\d{5})-of-(\d{5})\.gguf$/;

export interface SplitGGUFInfo {
  /** Whether the filename matches the split GGUF pattern. */
  isSplit: boolean;
  /** 1-based shard index (e.g., 1 for the first shard). */
  shardIndex: number;
  /** Total number of shards (e.g., 3). */
  totalShards: number;
  /**
   * Base pattern with the shard number replaced by a `%s` placeholder.
   * E.g., `"Qwen3.5-122B-A10B-Q4_K_M-%s-of-00003.gguf"`.
   */
  basePattern: string;
}

/**
 * Parse a GGUF filename to detect split-file sharding.
 * Returns `{ isSplit: false, ... }` for single files (backward compatible).
 */
export function parseSplitGGUF(filename: string): SplitGGUFInfo {
  const match = filename.match(SPLIT_GGUF_RE);
  if (!match) {
    return { isSplit: false, shardIndex: 1, totalShards: 1, basePattern: filename };
  }
  const shardIndex = parseInt(match[1]!, 10);
  const totalShards = parseInt(match[2]!, 10);
  const basePattern = filename.replace(SPLIT_GGUF_RE, `-%s-of-${match[2]}.gguf`);
  return { isSplit: true, shardIndex, totalShards, basePattern };
}

/**
 * Generate all shard filenames for a split GGUF model.
 * For single files, returns an array with just the original filename.
 */
export function getAllShardFilenames(filename: string): string[] {
  const info = parseSplitGGUF(filename);
  if (!info.isSplit) return [filename];

  const filenames: string[] = [];
  for (let i = 1; i <= info.totalShards; i++) {
    filenames.push(info.basePattern.replace("%s", String(i).padStart(5, "0")));
  }
  return filenames;
}

/**
 * Generate all shard download URLs from the first shard's URL.
 * For single files, returns an array with just the original URL.
 */
export function getAllShardUrls(firstShardUrl: string, firstShardFilename: string): string[] {
  const info = parseSplitGGUF(firstShardFilename);
  if (!info.isSplit) return [firstShardUrl];

  const filenames = getAllShardFilenames(firstShardFilename);
  // The first shard filename appears at the end of the URL path.
  // Replace it to generate URLs for other shards.
  return filenames.map((shardFilename) =>
    firstShardUrl.replace(firstShardFilename, shardFilename),
  );
}

/**
 * Check if ALL shards of a split GGUF model are present in a set of filenames.
 * For single-file models, just checks if the file is present.
 */
export function allShardsPresent(catalogFilename: string, diskFilenames: Set<string>): boolean {
  const shards = getAllShardFilenames(catalogFilename);
  return shards.every((f) => diskFilenames.has(f));
}

/**
 * Given a filename found on disk, return the catalog entry's ggufFilename (first shard)
 * if this file is part of a split GGUF set. Returns undefined if no match.
 */
export function findCatalogForShard(diskFilename: string): ModelCatalogEntry | undefined {
  // Direct match (single file or first shard)
  const direct = MODEL_FILENAME_MAP.get(diskFilename);
  if (direct) return direct;

  // Check if this is a non-first shard of a catalog entry
  const info = parseSplitGGUF(diskFilename);
  if (!info.isSplit) return undefined;

  // Reconstruct the first shard filename
  const firstShardFilename = info.basePattern.replace("%s", "00001");
  return MODEL_FILENAME_MAP.get(firstShardFilename);
}

/** Returns the recommended model tag based on available RAM (in GB). */
export function getRecommendedModelTag(ramGB: number): string {
  if (ramGB < 12) return "qwen3.5-4b";
  if (ramGB < 24) return "qwen3.5-35b-a3b"; // MoE: 35B quality with only 3B active params
  return "qwen3.5-27b";
}

/**
 * Infer model capabilities from HuggingFace tags.
 * Used for community models discovered via search.
 */
export function inferCapabilitiesFromTags(tags: string[], modelId: string): ModelCapabilities {
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  const id = modelId.toLowerCase();

  const vision = tagSet.has("image-text-to-text") || tagSet.has("vision");
  const toolUse = tagSet.has("tool-use") || tagSet.has("function-calling")
    || /qwen3\.5|llama-3\.[1-9]|mistral/.test(id);
  const reasoning = tagSet.has("reasoning") || /\breasonin/.test(id);

  return { vision, toolUse, reasoning };
}

/** User-visible catalog (excludes hidden models like embedding). */
export function getVisibleCatalog(): ModelCatalogEntry[] {
  return OFFICIAL_CATALOG.filter((m) => !m.hidden);
}

/** The embedding model tag — auto-installed, never shown to users. */
export const EMBEDDING_MODEL_TAG = "nomic-embed-text";

// ─── RAM Fitness Check ──────────────────────────────────────────────────────

export type RAMFitLevel = "ok" | "tight" | "exceeds";

export interface RAMFitResult {
  level: RAMFitLevel;
  /** Human-readable message for the UI */
  message: string;
  /** Model RAM requirement in GB */
  modelRAMGB: number;
  /** Available RAM for models in GB (total minus headroom) */
  availableRAMGB: number;
  /** Total system RAM in GB */
  totalRAMGB: number;
}

/**
 * Check whether a model fits in available RAM.
 *
 * @param modelRAMGB - RAM the model needs when loaded (from catalog or estimate)
 * @param systemRAMTotalBytes - Total system RAM in bytes
 * @param headroomGB - RAM to reserve for OS/apps (default 8 for solo, 4 for server)
 * @returns RAMFitResult with level, message, and numeric details
 */
export function checkModelRAMFit(
  modelRAMGB: number,
  systemRAMTotalBytes: number,
  headroomGB = 8,
): RAMFitResult {
  const totalRAMGB = systemRAMTotalBytes / (1024 ** 3);
  const availableRAMGB = Math.max(0, totalRAMGB - headroomGB);

  const base = { modelRAMGB, availableRAMGB, totalRAMGB };

  if (modelRAMGB > totalRAMGB) {
    return {
      ...base,
      level: "exceeds",
      message: `This model needs ~${modelRAMGB} GB RAM but your system only has ${Math.round(totalRAMGB)} GB. It will not load.`,
    };
  }

  if (modelRAMGB > availableRAMGB) {
    return {
      ...base,
      level: "tight",
      message: `This model needs ~${modelRAMGB} GB RAM. With ~${headroomGB} GB reserved for your system, only ~${Math.round(availableRAMGB)} GB is available for models. Performance may suffer.`,
    };
  }

  return { ...base, level: "ok", message: "" };
}
