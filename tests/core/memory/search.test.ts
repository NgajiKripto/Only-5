import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { MemoryStorage } from "../../../src/core/memory/storage.js";
import { EmbeddingService } from "../../../src/core/memory/embedding.js";
import { HybridSearch } from "../../../src/core/memory/search.js";
import { MemoryTier } from "../../../src/core/memory/types.js";
import type { MemoryEntry, SearchResult } from "../../../src/core/memory/types.js";

describe("HybridSearch", () => {
  let db: Database.Database;
  let storage: MemoryStorage;
  let embeddingService: EmbeddingService;
  let search: HybridSearch;

  beforeEach(() => {
    const dir = join(tmpdir(), "only5-test-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "test.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    storage = new MemoryStorage(db);
    storage.initialize();
    embeddingService = new EmbeddingService();
    search = new HybridSearch(storage, embeddingService);
  });

  afterEach(() => {
    db.close();
  });

  const makeEntry = async (content: string, tier: MemoryTier = MemoryTier.WORKING): Promise<MemoryEntry> => {
    const embedding = await embeddingService.generateEmbedding(content);
    const entry: MemoryEntry = {
      id: randomUUID(),
      tier,
      content,
      embedding,
      confidence: 1.0,
      accessCount: 0,
      lastAccessed: Date.now(),
      createdAt: Date.now(),
      decayFactor: 1.0,
      metadata: {},
      tags: [],
      contentHash: "hash-" + randomUUID(),
    };
    storage.insertEntry(entry);
    return entry;
  };

  describe("bm25Search", () => {
    it("should return results matching query keywords", () => {
      const entries: MemoryEntry[] = [
        { id: "1", tier: MemoryTier.WORKING, content: "Solana blockchain transaction speed", embedding: null, confidence: 1, accessCount: 0, lastAccessed: 0, createdAt: 0, decayFactor: 1, metadata: {}, tags: [], contentHash: "h1" },
        { id: "2", tier: MemoryTier.WORKING, content: "Ethereum gas fees are high", embedding: null, confidence: 1, accessCount: 0, lastAccessed: 0, createdAt: 0, decayFactor: 1, metadata: {}, tags: [], contentHash: "h2" },
        { id: "3", tier: MemoryTier.WORKING, content: "Weather forecast for tomorrow", embedding: null, confidence: 1, accessCount: 0, lastAccessed: 0, createdAt: 0, decayFactor: 1, metadata: {}, tags: [], contentHash: "h3" },
      ];

      const results = search.bm25Search("Solana transaction", entries, 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.id).toBe("1");
      expect(results[0].source).toBe("bm25");
    });

    it("should rank exact matches higher than partial matches", () => {
      const entries: MemoryEntry[] = [
        { id: "1", tier: MemoryTier.WORKING, content: "BTC price is falling rapidly today", embedding: null, confidence: 1, accessCount: 0, lastAccessed: 0, createdAt: 0, decayFactor: 1, metadata: {}, tags: [], contentHash: "h1" },
        { id: "2", tier: MemoryTier.WORKING, content: "BTC BTC BTC price price analysis complete", embedding: null, confidence: 1, accessCount: 0, lastAccessed: 0, createdAt: 0, decayFactor: 1, metadata: {}, tags: [], contentHash: "h2" },
        { id: "3", tier: MemoryTier.WORKING, content: "Something unrelated to crypto", embedding: null, confidence: 1, accessCount: 0, lastAccessed: 0, createdAt: 0, decayFactor: 1, metadata: {}, tags: [], contentHash: "h3" },
      ];

      const results = search.bm25Search("BTC price", entries, 10);
      expect(results.length).toBeGreaterThanOrEqual(2);
      // Entry with more BTC/price occurrences should rank higher
      const ids = results.map((r) => r.entry.id);
      expect(ids).toContain("1");
      expect(ids).toContain("2");
      // Unrelated entry should not appear
      expect(ids).not.toContain("3");
    });

    it("should return empty array for empty query", () => {
      const entries: MemoryEntry[] = [
        { id: "1", tier: MemoryTier.WORKING, content: "Some content", embedding: null, confidence: 1, accessCount: 0, lastAccessed: 0, createdAt: 0, decayFactor: 1, metadata: {}, tags: [], contentHash: "h1" },
      ];
      const results = search.bm25Search("", entries, 10);
      expect(results).toEqual([]);
    });
  });

  describe("vectorSearch", () => {
    it("should return semantically similar entries", async () => {
      const entries: MemoryEntry[] = [];
      const e1Emb = await embeddingService.generateEmbedding("Solana blockchain fast transactions");
      entries.push({ id: "1", tier: MemoryTier.WORKING, content: "Solana blockchain fast transactions", embedding: e1Emb, confidence: 1, accessCount: 0, lastAccessed: 0, createdAt: 0, decayFactor: 1, metadata: {}, tags: [], contentHash: "h1" });

      const e2Emb = await embeddingService.generateEmbedding("Weather is sunny and warm");
      entries.push({ id: "2", tier: MemoryTier.WORKING, content: "Weather is sunny and warm", embedding: e2Emb, confidence: 1, accessCount: 0, lastAccessed: 0, createdAt: 0, decayFactor: 1, metadata: {}, tags: [], contentHash: "h2" });

      const results = await search.vectorSearch("Solana speed", entries, 10);
      expect(results.length).toBeGreaterThan(0);
      // Solana entry should be more similar to "Solana speed"
      expect(results[0].entry.id).toBe("1");
      expect(results[0].source).toBe("vector");
    });

    it("should skip entries without embeddings", async () => {
      const entries: MemoryEntry[] = [
        { id: "1", tier: MemoryTier.WORKING, content: "Has no embedding", embedding: null, confidence: 1, accessCount: 0, lastAccessed: 0, createdAt: 0, decayFactor: 1, metadata: {}, tags: [], contentHash: "h1" },
      ];
      const results = await search.vectorSearch("test query", entries, 10);
      expect(results).toEqual([]);
    });
  });

  describe("reciprocalRankFusion", () => {
    it("should correctly merge two result sets", () => {
      const entry1: MemoryEntry = { id: "1", tier: MemoryTier.WORKING, content: "a", embedding: null, confidence: 1, accessCount: 0, lastAccessed: 0, createdAt: 0, decayFactor: 1, metadata: {}, tags: [], contentHash: "h1" };
      const entry2: MemoryEntry = { id: "2", tier: MemoryTier.WORKING, content: "b", embedding: null, confidence: 1, accessCount: 0, lastAccessed: 0, createdAt: 0, decayFactor: 1, metadata: {}, tags: [], contentHash: "h2" };
      const entry3: MemoryEntry = { id: "3", tier: MemoryTier.WORKING, content: "c", embedding: null, confidence: 1, accessCount: 0, lastAccessed: 0, createdAt: 0, decayFactor: 1, metadata: {}, tags: [], contentHash: "h3" };

      const set1: SearchResult[] = [
        { entry: entry1, score: 5.0, source: "bm25" },
        { entry: entry2, score: 3.0, source: "bm25" },
      ];
      const set2: SearchResult[] = [
        { entry: entry2, score: 0.9, source: "vector" },
        { entry: entry3, score: 0.7, source: "vector" },
      ];

      const fused = search.reciprocalRankFusion([set1, set2]);
      expect(fused.length).toBe(3);
      // Entry2 appears in both sets so should have highest fused score
      expect(fused[0].entry.id).toBe("2");
      expect(fused[0].source).toBe("fused");
    });

    it("should deduplicate entries appearing in multiple sets", () => {
      const entry: MemoryEntry = { id: "1", tier: MemoryTier.WORKING, content: "x", embedding: null, confidence: 1, accessCount: 0, lastAccessed: 0, createdAt: 0, decayFactor: 1, metadata: {}, tags: [], contentHash: "h1" };

      const set1: SearchResult[] = [{ entry, score: 5.0, source: "bm25" }];
      const set2: SearchResult[] = [{ entry, score: 0.9, source: "vector" }];

      const fused = search.reciprocalRankFusion([set1, set2]);
      // Should only appear once despite being in both sets
      expect(fused).toHaveLength(1);
      // RRF score: 1/(60+0+1) + 1/(60+0+1) = 2/61
      expect(fused[0].score).toBeCloseTo(2 / 61, 5);
    });
  });

  describe("search (integrated)", () => {
    it("should combine BM25 and vector results", async () => {
      await makeEntry("Solana blockchain transactions are very fast");
      await makeEntry("Ethereum gas fees remain high this week");
      await makeEntry("Weather forecast says rain tomorrow");

      const results = await search.search("Solana fast");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.content).toContain("Solana");
    });

    it("should respect limit option", async () => {
      for (let i = 0; i < 10; i++) {
        await makeEntry(`Entry number ${i} about crypto trading strategies`);
      }

      const results = await search.search("crypto trading", { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("should filter by tier when specified", async () => {
      await makeEntry("Solana working memory entry", MemoryTier.WORKING);
      await makeEntry("Solana episodic memory entry", MemoryTier.EPISODIC);

      const results = await search.search("Solana", { tiers: [MemoryTier.EPISODIC] });
      for (const result of results) {
        expect(result.entry.tier).toBe(MemoryTier.EPISODIC);
      }
    });

    it("should return empty for no matches", async () => {
      const results = await search.search("xyznonexistent");
      expect(results).toEqual([]);
    });
  });
});
