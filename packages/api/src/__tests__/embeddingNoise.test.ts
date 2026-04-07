import { describe, it, expect, beforeAll } from "vitest";
import { initEncryptionKey, generateEmbeddingNoise, addEmbeddingNoise, removeEmbeddingNoise } from "../lib/crypto.js";

describe("Embedding noise protection", () => {
  beforeAll(() => {
    initEncryptionKey();
  });

  describe("generateEmbeddingNoise", () => {
    it("produces a Float32Array of the requested dimension", () => {
      const noise = generateEmbeddingNoise("test-chunk-0", 768);
      expect(noise).toBeInstanceOf(Float32Array);
      expect(noise.length).toBe(768);
    });

    it("produces values in [-1, 1]", () => {
      const noise = generateEmbeddingNoise("test-chunk-0", 768);
      for (const v of noise) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it("is deterministic — same chunkId produces same noise", () => {
      const a = generateEmbeddingNoise("chunk-42", 768);
      const b = generateEmbeddingNoise("chunk-42", 768);
      expect(Array.from(a)).toEqual(Array.from(b));
    });

    it("produces different noise for different chunkIds", () => {
      const a = generateEmbeddingNoise("chunk-1", 768);
      const b = generateEmbeddingNoise("chunk-2", 768);
      // Extremely unlikely to collide — check first few values
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

  describe("addEmbeddingNoise / removeEmbeddingNoise roundtrip", () => {
    it("recovers the original embedding exactly", () => {
      const original = Array.from({ length: 768 }, (_, i) => Math.sin(i * 0.1));
      const chunkId = "knowledge-base-7";

      const noised = addEmbeddingNoise(original, chunkId);
      const recovered = removeEmbeddingNoise(noised, chunkId);

      for (let i = 0; i < original.length; i++) {
        expect(recovered[i]).toBeCloseTo(original[i]!, 10);
      }
    });

    it("noised embedding differs significantly from original", () => {
      const original = Array.from({ length: 768 }, () => 0.5);
      const noised = addEmbeddingNoise(original, "chunk-0");

      // At least some values should differ by more than 0.1
      const diffs = noised.map((v, i) => Math.abs(v - original[i]!));
      const maxDiff = Math.max(...diffs);
      expect(maxDiff).toBeGreaterThan(0.1);
    });

    it("different chunkIds produce different noised embeddings", () => {
      const original = Array.from({ length: 768 }, () => 0.0);
      const noisedA = addEmbeddingNoise(original, "chunk-a");
      const noisedB = addEmbeddingNoise(original, "chunk-b");

      const same = noisedA.every((v, i) => v === noisedB[i]);
      expect(same).toBe(false);
    });
  });

  describe("cosine similarity is destroyed by noise", () => {
    it("two similar embeddings become dissimilar when noise is added", () => {
      // Create two similar embeddings (slight perturbation)
      const base = Array.from({ length: 768 }, (_, i) => Math.sin(i * 0.05));
      const similar = base.map((v) => v + (Math.random() - 0.5) * 0.01);

      const cosine = (a: number[], b: number[]) => {
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
          dot += a[i]! * b[i]!;
          normA += a[i]! * a[i]!;
          normB += b[i]! * b[i]!;
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
      };

      // Original similarity should be very high
      const originalSim = cosine(base, similar);
      expect(originalSim).toBeGreaterThan(0.99);

      // After adding different noise, similarity should drop
      const noisedBase = addEmbeddingNoise(base, "chunk-0");
      const noisedSimilar = addEmbeddingNoise(similar, "chunk-1");
      const noisedSim = cosine(noisedBase, noisedSimilar);
      expect(noisedSim).toBeLessThan(0.5);
    });
  });
});
