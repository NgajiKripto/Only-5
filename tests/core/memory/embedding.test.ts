import { describe, it, expect, beforeEach } from "vitest";
import { EmbeddingService } from "../../../src/core/memory/embedding.js";

describe("EmbeddingService", () => {
  let service: EmbeddingService;

  beforeEach(() => {
    service = new EmbeddingService();
  });

  describe("generateEmbedding", () => {
    it("should return a number array of correct dimension (128)", async () => {
      const embedding = await service.generateEmbedding("Hello world this is a test");
      expect(embedding).toHaveLength(128);
      expect(embedding.every((v) => typeof v === "number")).toBe(true);
    });

    it("should produce same embedding for same text (deterministic)", async () => {
      // Use a fresh service for each call to test determinism
      const service1 = new EmbeddingService();
      const service2 = new EmbeddingService();
      const emb1 = await service1.generateEmbedding("Solana DeFi trading");
      const emb2 = await service2.generateEmbedding("Solana DeFi trading");
      expect(emb1).toEqual(emb2);
    });

    it("should produce different embeddings for different texts", async () => {
      const emb1 = await service.generateEmbedding("BTC price is rising quickly");
      const emb2 = await service.generateEmbedding("The weather is sunny today");
      expect(emb1).not.toEqual(emb2);
    });

    it("should produce valid embedding for empty/short text", async () => {
      const embEmpty = await service.generateEmbedding("");
      expect(embEmpty).toHaveLength(128);
      expect(embEmpty.every((v) => v === 0)).toBe(true);

      const embShort = await service.generateEmbedding("hi");
      expect(embShort).toHaveLength(128);
    });

    it("should produce normalized vectors (magnitude ~1)", async () => {
      const emb = await service.generateEmbedding("Solana blockchain transactions");
      const magnitude = Math.sqrt(emb.reduce((sum, v) => sum + v * v, 0));
      // Non-zero text should produce a unit vector
      if (magnitude > 0) {
        expect(magnitude).toBeCloseTo(1.0, 3);
      }
    });
  });

  describe("cosineSimilarity", () => {
    it("should return 1.0 for identical vectors", () => {
      const vec = [0.5, 0.3, 0.1, 0.7, 0.2];
      const similarity = service.cosineSimilarity(vec, vec);
      expect(similarity).toBeCloseTo(1.0, 5);
    });

    it("should return 0 for orthogonal vectors", () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      const similarity = service.cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(0, 5);
    });

    it("should return values between -1 and 1", () => {
      const a = [0.5, -0.3, 0.8, 0.1];
      const b = [-0.2, 0.7, -0.4, 0.9];
      const similarity = service.cosineSimilarity(a, b);
      expect(similarity).toBeGreaterThanOrEqual(-1);
      expect(similarity).toBeLessThanOrEqual(1);
    });

    it("should return 0 for zero vectors", () => {
      const zero = [0, 0, 0];
      const vec = [1, 2, 3];
      expect(service.cosineSimilarity(zero, vec)).toBe(0);
      expect(service.cosineSimilarity(vec, zero)).toBe(0);
    });

    it("should return 0 for vectors of different lengths", () => {
      const a = [1, 2, 3];
      const b = [1, 2];
      expect(service.cosineSimilarity(a, b)).toBe(0);
    });
  });
});
