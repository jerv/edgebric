import { describe, it, expect, beforeAll } from "vitest";
import { initEncryptionKey, generateEmbeddingNoise, addEmbeddingNoise, shiftQueryEmbedding } from "../lib/crypto.js";

describe("Embedding noise protection", () => {
  beforeAll(() => {
    initEncryptionKey();
  });

  describe("generateEmbeddingNoise", () => {
    it("produces a Float32Array of the requested dimension", () => {
      const noise = generateEmbeddingNoise("knowledge-base", 768);
      expect(noise).toBeInstanceOf(Float32Array);
      expect(noise.length).toBe(768);
    });

    it("produces values in [-1, 1]", () => {
      const noise = generateEmbeddingNoise("knowledge-base", 768);
      for (const v of noise) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it("is deterministic — same label produces same noise", () => {
      const a = generateEmbeddingNoise("hr-policies", 768);
      const b = generateEmbeddingNoise("hr-policies", 768);
      expect(Array.from(a)).toEqual(Array.from(b));
    });

    it("produces different noise for different dataset names", () => {
      const a = generateEmbeddingNoise("knowledge-base", 768);
      const b = generateEmbeddingNoise("sales", 768);
      const same = Array.from(a).every((v, i) => v === b[i]);
      expect(same).toBe(false);
    });

    it("works with non-standard dimensions", () => {
      const noise = generateEmbeddingNoise("test", 384);
      expect(noise.length).toBe(384);

      const big = generateEmbeddingNoise("test", 1536);
      expect(big.length).toBe(1536);
    });
  });

  describe("addEmbeddingNoise + shiftQueryEmbedding preserve L2 distance", () => {
    const l2 = (a: number[], b: number[]) => {
      let sum = 0;
      for (let i = 0; i < a.length; i++) {
        const d = a[i]! - b[i]!;
        sum += d * d;
      }
      return Math.sqrt(sum);
    };

    it("L2(stored, shifted_query) equals L2(real, query)", () => {
      const real = Array.from({ length: 768 }, (_, i) => Math.sin(i * 0.1));
      const query = Array.from({ length: 768 }, (_, i) => Math.cos(i * 0.1));
      const ds = "knowledge-base";

      const originalDist = l2(real, query);
      const stored = addEmbeddingNoise(real, ds);
      const shiftedQuery = shiftQueryEmbedding(query, ds);
      const noisedDist = l2(stored, shiftedQuery);

      expect(noisedDist).toBeCloseTo(originalDist, 5);
    });

    it("noised embedding differs significantly from original", () => {
      const original = Array.from({ length: 768 }, () => 0.5);
      const noised = addEmbeddingNoise(original, "sales");

      const diffs = noised.map((v, i) => Math.abs(v - original[i]!));
      const maxDiff = Math.max(...diffs);
      expect(maxDiff).toBeGreaterThan(0.1);
    });

    it("same dataset produces same noise for all chunks", () => {
      const embA = Array.from({ length: 768 }, () => 0.0);
      const embB = Array.from({ length: 768 }, () => 1.0);
      const ds = "knowledge-base";

      const noisedA = addEmbeddingNoise(embA, ds);
      const noisedB = addEmbeddingNoise(embB, ds);

      // Difference between noised should equal difference between originals
      // since both got the same noise added
      for (let i = 0; i < embA.length; i++) {
        expect(noisedB[i]! - noisedA[i]!).toBeCloseTo(1.0, 10);
      }
    });
  });

  describe("cross-dataset similarity is destroyed", () => {
    // Helper: L2-normalize a vector (like real embeddings from nomic-embed-text)
    const normalize = (v: number[]): number[] => {
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      return v.map((x) => x / norm);
    };

    const cosine = (a: number[], b: number[]) => {
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i]! * b[i]!;
        normA += a[i]! * a[i]!;
        normB += b[i]! * b[i]!;
      }
      return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    };

    it("two similar embeddings from different datasets become dissimilar", () => {
      // Use unit-normalized vectors like real embeddings (L2 norm = 1.0)
      const raw = Array.from({ length: 768 }, (_, i) => Math.sin(i * 0.05));
      const base = normalize(raw);
      const similar = normalize(base.map((v) => v + (Math.random() - 0.5) * 0.01));

      // Original similarity should be very high
      expect(cosine(base, similar)).toBeGreaterThan(0.99);

      // After adding noise from DIFFERENT datasets, similarity should be destroyed.
      // Noise magnitude (~0.58 RMS per dim) vastly exceeds signal (~0.036 RMS per dim),
      // so cross-dataset cosine should drop close to zero.
      const noisedBase = addEmbeddingNoise(base, "dataset-a");
      const noisedSimilar = addEmbeddingNoise(similar, "dataset-b");
      expect(cosine(noisedBase, noisedSimilar)).toBeLessThan(0.3);
    });

    it("two similar embeddings from the SAME dataset stay similar", () => {
      const raw = Array.from({ length: 768 }, (_, i) => Math.sin(i * 0.05));
      const base = normalize(raw);
      const similar = normalize(base.map((v) => v + (Math.random() - 0.5) * 0.01));

      // Same dataset noise preserves relative similarity
      const ds = "same-dataset";
      const noisedBase = addEmbeddingNoise(base, ds);
      const noisedSimilar = addEmbeddingNoise(similar, ds);

      // Cosine sim won't be exactly preserved (noise shifts the origin),
      // but L2 distance is preserved, so the ranking is correct.
      // For a meaningful test: L2 should be preserved exactly.
      const l2 = (a: number[], b: number[]) => {
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
          const d = a[i]! - b[i]!;
          sum += d * d;
        }
        return Math.sqrt(sum);
      };

      expect(l2(noisedBase, noisedSimilar)).toBeCloseTo(l2(base, similar), 5);
    });
  });
});
