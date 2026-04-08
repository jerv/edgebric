import { describe, it, expect } from "vitest";
import {
  parseSplitGGUF,
  getAllShardFilenames,
  getAllShardUrls,
  allShardsPresent,
  findCatalogForShard,
} from "@edgebric/types";

describe("Split GGUF Helpers", () => {
  // ─── parseSplitGGUF ────────────────────────────────────────────────────────

  describe("parseSplitGGUF", () => {
    it("detects a split GGUF filename (3 shards)", () => {
      const result = parseSplitGGUF("Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf");
      expect(result.isSplit).toBe(true);
      expect(result.shardIndex).toBe(1);
      expect(result.totalShards).toBe(3);
      expect(result.basePattern).toBe("Qwen3.5-122B-A10B-Q4_K_M-%s-of-00003.gguf");
    });

    it("detects a split GGUF filename (6 shards, shard 4)", () => {
      const result = parseSplitGGUF("GLM-5.1-UD-IQ2_M-00004-of-00006.gguf");
      expect(result.isSplit).toBe(true);
      expect(result.shardIndex).toBe(4);
      expect(result.totalShards).toBe(6);
    });

    it("returns isSplit=false for a single-file GGUF", () => {
      const result = parseSplitGGUF("Qwen3.5-4B-Q4_K_M.gguf");
      expect(result.isSplit).toBe(false);
      expect(result.shardIndex).toBe(1);
      expect(result.totalShards).toBe(1);
      expect(result.basePattern).toBe("Qwen3.5-4B-Q4_K_M.gguf");
    });

    it("returns isSplit=false for filenames that look similar but aren't split", () => {
      // Missing the 5-digit padding
      const result = parseSplitGGUF("Model-1-of-3.gguf");
      expect(result.isSplit).toBe(false);
    });

    it("returns isSplit=false for non-gguf files", () => {
      const result = parseSplitGGUF("readme-00001-of-00002.txt");
      expect(result.isSplit).toBe(false);
    });
  });

  // ─── getAllShardFilenames ───────────────────────────────────────────────────

  describe("getAllShardFilenames", () => {
    it("generates all 3 shard filenames", () => {
      const filenames = getAllShardFilenames("Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf");
      expect(filenames).toEqual([
        "Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf",
        "Qwen3.5-122B-A10B-Q4_K_M-00002-of-00003.gguf",
        "Qwen3.5-122B-A10B-Q4_K_M-00003-of-00003.gguf",
      ]);
    });

    it("generates all 6 shard filenames", () => {
      const filenames = getAllShardFilenames("GLM-5.1-UD-IQ2_M-00001-of-00006.gguf");
      expect(filenames).toHaveLength(6);
      expect(filenames[0]).toBe("GLM-5.1-UD-IQ2_M-00001-of-00006.gguf");
      expect(filenames[5]).toBe("GLM-5.1-UD-IQ2_M-00006-of-00006.gguf");
    });

    it("returns single filename for non-split model", () => {
      const filenames = getAllShardFilenames("Qwen3.5-4B-Q4_K_M.gguf");
      expect(filenames).toEqual(["Qwen3.5-4B-Q4_K_M.gguf"]);
    });

    it("generates filenames even when given a non-first shard", () => {
      const filenames = getAllShardFilenames("MiniMax-M2.5-UD-Q3_K_XL-00003-of-00004.gguf");
      expect(filenames).toHaveLength(4);
      expect(filenames[0]).toBe("MiniMax-M2.5-UD-Q3_K_XL-00001-of-00004.gguf");
      expect(filenames[3]).toBe("MiniMax-M2.5-UD-Q3_K_XL-00004-of-00004.gguf");
    });
  });

  // ─── getAllShardUrls ───────────────────────────────────────────────────────

  describe("getAllShardUrls", () => {
    it("generates URLs for all 3 shards", () => {
      const baseUrl = "https://huggingface.co/unsloth/Qwen3.5-122B-A10B-GGUF/resolve/main/Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf";
      const urls = getAllShardUrls(baseUrl, "Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf");
      expect(urls).toHaveLength(3);
      expect(urls[0]).toBe(baseUrl);
      expect(urls[1]).toContain("-00002-of-00003.gguf");
      expect(urls[2]).toContain("-00003-of-00003.gguf");
    });

    it("returns single URL for non-split model", () => {
      const url = "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf";
      const urls = getAllShardUrls(url, "Qwen3.5-4B-Q4_K_M.gguf");
      expect(urls).toEqual([url]);
    });

    it("preserves full URL structure when replacing shard number", () => {
      const baseUrl = "https://huggingface.co/unsloth/GLM-5.1-GGUF/resolve/main/GLM-5.1-UD-IQ2_M-00001-of-00006.gguf";
      const urls = getAllShardUrls(baseUrl, "GLM-5.1-UD-IQ2_M-00001-of-00006.gguf");
      expect(urls[5]).toBe("https://huggingface.co/unsloth/GLM-5.1-GGUF/resolve/main/GLM-5.1-UD-IQ2_M-00006-of-00006.gguf");
    });
  });

  // ─── allShardsPresent ──────────────────────────────────────────────────────

  describe("allShardsPresent", () => {
    it("returns true when all shards are present", () => {
      const diskFiles = new Set([
        "Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf",
        "Qwen3.5-122B-A10B-Q4_K_M-00002-of-00003.gguf",
        "Qwen3.5-122B-A10B-Q4_K_M-00003-of-00003.gguf",
        "some-other-model.gguf",
      ]);
      expect(allShardsPresent("Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf", diskFiles)).toBe(true);
    });

    it("returns false when a shard is missing", () => {
      const diskFiles = new Set([
        "Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf",
        "Qwen3.5-122B-A10B-Q4_K_M-00003-of-00003.gguf",
        // shard 2 is missing
      ]);
      expect(allShardsPresent("Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf", diskFiles)).toBe(false);
    });

    it("returns true for single-file model when present", () => {
      const diskFiles = new Set(["Qwen3.5-4B-Q4_K_M.gguf"]);
      expect(allShardsPresent("Qwen3.5-4B-Q4_K_M.gguf", diskFiles)).toBe(true);
    });

    it("returns false for single-file model when absent", () => {
      const diskFiles = new Set(["other-model.gguf"]);
      expect(allShardsPresent("Qwen3.5-4B-Q4_K_M.gguf", diskFiles)).toBe(false);
    });

    it("returns false when only some shards of 6-shard model exist", () => {
      const diskFiles = new Set([
        "GLM-5.1-UD-IQ2_M-00001-of-00006.gguf",
        "GLM-5.1-UD-IQ2_M-00002-of-00006.gguf",
        "GLM-5.1-UD-IQ2_M-00003-of-00006.gguf",
      ]);
      expect(allShardsPresent("GLM-5.1-UD-IQ2_M-00001-of-00006.gguf", diskFiles)).toBe(false);
    });
  });

  // ─── findCatalogForShard ───────────────────────────────────────────────────

  describe("findCatalogForShard", () => {
    it("finds catalog entry for first shard filename", () => {
      const entry = findCatalogForShard("Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf");
      expect(entry).toBeDefined();
      expect(entry!.tag).toBe("qwen3.5-122b-a10b");
    });

    it("finds catalog entry for non-first shard filename", () => {
      const entry = findCatalogForShard("Qwen3.5-122B-A10B-Q4_K_M-00002-of-00003.gguf");
      expect(entry).toBeDefined();
      expect(entry!.tag).toBe("qwen3.5-122b-a10b");
    });

    it("finds catalog entry for single-file model", () => {
      const entry = findCatalogForShard("Qwen3.5-4B-Q4_K_M.gguf");
      expect(entry).toBeDefined();
      expect(entry!.tag).toBe("qwen3.5-4b");
    });

    it("returns undefined for unknown filename", () => {
      const entry = findCatalogForShard("totally-unknown-model.gguf");
      expect(entry).toBeUndefined();
    });

    it("returns undefined for unknown split shard", () => {
      const entry = findCatalogForShard("Unknown-Model-00001-of-00010.gguf");
      expect(entry).toBeUndefined();
    });
  });
});
