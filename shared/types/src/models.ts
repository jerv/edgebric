// ─── AI Model Management ─────────────────────────────────────────────────────

export type ModelStatus = "not_installed" | "installed" | "loaded" | "downloading";
export type ModelTier = "recommended" | "supported" | "community";

export interface ModelCatalogEntry {
  /** Ollama model tag (e.g., "qwen3:4b") */
  tag: string;
  /** Display name (e.g., "Qwen 3") */
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
}

export interface InstalledModel {
  /** Ollama model tag */
  tag: string;
  /** Display name (from catalog or Ollama) */
  name: string;
  /** Size on disk in bytes */
  sizeBytes: number;
  /** Model digest / hash */
  digest: string;
  /** Last modified timestamp */
  modifiedAt: string;
  /** Current status */
  status: ModelStatus;
  /** RAM usage in bytes (only set when model is loaded) */
  ramUsageBytes?: number | undefined;
  /** Matched catalog entry, if any (undefined for community models) */
  catalogEntry?: ModelCatalogEntry | undefined;
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
  /** Ollama model files on disk (bytes). */
  ollamaModelsBytes: number;
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
    tag: "qwen3:4b",
    name: "Qwen 3 4B",
    family: "Qwen",
    description: "Best overall for most hardware. Fast, accurate, 256K context.",
    paramCount: "4B",
    downloadSizeGB: 2.5,
    ramUsageGB: 5.5,
    origin: "Alibaba",
    tier: "recommended",
    minRAMGB: 8,
  },
  {
    tag: "qwen3:8b",
    name: "Qwen 3 8B",
    family: "Qwen",
    description: "Stronger reasoning and analysis. Best for 16GB machines.",
    paramCount: "8B",
    downloadSizeGB: 5.2,
    ramUsageGB: 9,
    origin: "Alibaba",
    tier: "recommended",
    minRAMGB: 16,
  },
  {
    tag: "qwen3:14b",
    name: "Qwen 3 14B",
    family: "Qwen",
    description: "Highest quality answers. Needs 32GB RAM.",
    paramCount: "14B",
    downloadSizeGB: 9.3,
    ramUsageGB: 15,
    origin: "Alibaba",
    tier: "recommended",
    minRAMGB: 32,
  },
  // ── Supported (alternatives, known to work) ──
  {
    tag: "phi4-mini",
    name: "Phi-4 Mini",
    family: "Microsoft",
    description: "Compact, efficient, 128K context. Good for constrained setups.",
    paramCount: "3.8B",
    downloadSizeGB: 2.5,
    ramUsageGB: 5,
    origin: "Microsoft",
    tier: "supported",
    minRAMGB: 8,
  },
  {
    tag: "gemma3:4b",
    name: "Gemma 3 4B",
    family: "Google",
    description: "Google's efficient model. Multimodal capable, 128K context.",
    paramCount: "4B",
    downloadSizeGB: 3.3,
    ramUsageGB: 6,
    origin: "Google",
    tier: "supported",
    minRAMGB: 8,
  },
  {
    tag: "gemma3:12b",
    name: "Gemma 3 12B",
    family: "Google",
    description: "Strong document analysis. Multimodal, 128K context.",
    paramCount: "12B",
    downloadSizeGB: 8.1,
    ramUsageGB: 13,
    origin: "Google",
    tier: "supported",
    minRAMGB: 16,
  },
  // ── Hidden infrastructure ──
  {
    tag: "nomic-embed-text",
    name: "Nomic Embed Text",
    family: "Nomic",
    description: "Text embedding model for semantic search.",
    paramCount: "137M",
    downloadSizeGB: 0.27,
    ramUsageGB: 0.3,
    origin: "Nomic",
    tier: "recommended",
    minRAMGB: 4,
    hidden: true,
  },
];

/** Lookup catalog entry by Ollama tag. Returns undefined for community models. */
export const MODEL_CATALOG_MAP: ReadonlyMap<string, ModelCatalogEntry> = new Map(
  OFFICIAL_CATALOG.map((m) => [m.tag, m]),
);

/** Returns the recommended model tag based on available RAM (in GB). */
export function getRecommendedModelTag(ramGB: number): string {
  if (ramGB < 12) return "qwen3:4b";
  if (ramGB < 24) return "qwen3:8b";
  return "qwen3:14b";
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
