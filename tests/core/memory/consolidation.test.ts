import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { MemoryStorage } from "../../../src/core/memory/storage.js";
import { EmbeddingService } from "../../../src/core/memory/embedding.js";
import { MemoryLifecycle } from "../../../src/core/memory/lifecycle.js";
import { ConsolidationPipeline } from "../../../src/core/memory/consolidation.js";
import { MemoryTier } from "../../../src/core/memory/types.js";

describe("ConsolidationPipeline", () => {
  let db: Database.Database;
  let storage: MemoryStorage;
  let embeddingService: EmbeddingService;
  let lifecycle: MemoryLifecycle;
  let pipeline: ConsolidationPipeline;
  let mockLLM: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const dir = join(tmpdir(), "only5-test-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "test.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    storage = new MemoryStorage(db);
    storage.initialize();
    embeddingService = new EmbeddingService();
    lifecycle = new MemoryLifecycle(storage);
    mockLLM = vi.fn().mockResolvedValue({
      content: "Summarized content here",
      model: "test-model",
      tokensUsed: 50,
    });
    pipeline = new ConsolidationPipeline(storage, embeddingService, lifecycle, mockLLM);
  });

  afterEach(() => {
    db.close();
  });

  describe("captureObservation", () => {
    it("should store entry in WORKING tier", async () => {
      const id = await pipeline.captureObservation("SOL price went up today");
      expect(id).toBeDefined();
      expect(id.length).toBeGreaterThan(0);

      const entries = storage.getByTier(MemoryTier.WORKING);
      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe("SOL price went up today");
    });

    it("should deduplicate within time window", async () => {
      const id1 = await pipeline.captureObservation("Duplicate observation text");
      const id2 = await pipeline.captureObservation("Duplicate observation text");

      expect(id1.length).toBeGreaterThan(0);
      expect(id2).toBe(""); // duplicate returns empty string

      const entries = storage.getByTier(MemoryTier.WORKING);
      expect(entries).toHaveLength(1);
    });

    it("should strip sensitive data via privacy filter", async () => {
      await pipeline.captureObservation("My key is sk-abc123456789012345678901");
      const entries = storage.getByTier(MemoryTier.WORKING);
      expect(entries[0].content).not.toContain("sk-abc123456789012345678901");
      expect(entries[0].content).toContain("[REDACTED_API_KEY]");
    });

    it("should store metadata as tags", async () => {
      await pipeline.captureObservation("Test content", { strategy: "airdrop", source: "scanner" });
      const entries = storage.getByTier(MemoryTier.WORKING);
      expect(entries[0].tags).toContain("strategy");
      expect(entries[0].tags).toContain("source");
    });
  });

  describe("consolidateWorkingToEpisodic", () => {
    it("should compress old working memories using LLM", async () => {
      // Insert entries that are older than 1 hour
      const oldTime = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
      storage.insertEntry({
        id: randomUUID(),
        tier: MemoryTier.WORKING,
        content: "First observation about trading",
        embedding: null,
        confidence: 1.0,
        accessCount: 0,
        lastAccessed: oldTime,
        createdAt: oldTime,
        decayFactor: 1.0,
        metadata: {},
        tags: ["trading"],
        contentHash: "hash1-" + randomUUID(),
      });
      storage.insertEntry({
        id: randomUUID(),
        tier: MemoryTier.WORKING,
        content: "Second observation about trading",
        embedding: null,
        confidence: 1.0,
        accessCount: 0,
        lastAccessed: oldTime,
        createdAt: oldTime,
        decayFactor: 1.0,
        metadata: {},
        tags: ["trading"],
        contentHash: "hash2-" + randomUUID(),
      });

      const result = await pipeline.consolidateWorkingToEpisodic();

      expect(result.fromTier).toBe(MemoryTier.WORKING);
      expect(result.toTier).toBe(MemoryTier.EPISODIC);
      expect(result.entriesProcessed).toBe(2);
      expect(result.entriesCreated).toBeGreaterThanOrEqual(1);
      expect(mockLLM).toHaveBeenCalled();

      // Working entries should be removed
      const workingEntries = storage.getByTier(MemoryTier.WORKING);
      expect(workingEntries).toHaveLength(0);

      // Episodic entries should exist
      const episodicEntries = storage.getByTier(MemoryTier.EPISODIC);
      expect(episodicEntries.length).toBeGreaterThan(0);
    });

    it("should handle empty tier gracefully (no LLM calls)", async () => {
      const result = await pipeline.consolidateWorkingToEpisodic();
      expect(result.entriesProcessed).toBe(0);
      expect(result.entriesCreated).toBe(0);
      expect(mockLLM).not.toHaveBeenCalled();
    });
  });

  describe("consolidateEpisodicToSemantic", () => {
    it("should extract facts from episodes using LLM", async () => {
      const oldTime = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
      storage.insertEntry({
        id: randomUUID(),
        tier: MemoryTier.EPISODIC,
        content: "Episode about SOL price movements",
        embedding: null,
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: oldTime,
        createdAt: oldTime,
        decayFactor: 1.5,
        metadata: {},
        tags: ["market"],
        contentHash: "ep-hash-" + randomUUID(),
      });

      const result = await pipeline.consolidateEpisodicToSemantic();

      expect(result.fromTier).toBe(MemoryTier.EPISODIC);
      expect(result.toTier).toBe(MemoryTier.SEMANTIC);
      expect(result.entriesProcessed).toBe(1);
      expect(result.entriesCreated).toBe(1);
      expect(mockLLM).toHaveBeenCalled();

      const semanticEntries = storage.getByTier(MemoryTier.SEMANTIC);
      expect(semanticEntries.length).toBe(1);
    });

    it("should handle empty tier gracefully", async () => {
      const result = await pipeline.consolidateEpisodicToSemantic();
      expect(result.entriesProcessed).toBe(0);
      expect(mockLLM).not.toHaveBeenCalled();
    });
  });

  describe("consolidateSemanticToProcedural", () => {
    it("should create workflow entries from high-access semantic memories", async () => {
      const oldTime = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago
      storage.insertEntry({
        id: randomUUID(),
        tier: MemoryTier.SEMANTIC,
        content: "SOL trading patterns show recurring behavior",
        embedding: null,
        confidence: 0.85,
        accessCount: 5, // Above threshold of 3
        lastAccessed: oldTime,
        createdAt: oldTime,
        decayFactor: 2.0,
        metadata: {},
        tags: ["facts"],
        contentHash: "sem-hash-" + randomUUID(),
      });

      const result = await pipeline.consolidateSemanticToProcedural();

      expect(result.fromTier).toBe(MemoryTier.SEMANTIC);
      expect(result.toTier).toBe(MemoryTier.PROCEDURAL);
      expect(result.entriesProcessed).toBe(1);
      expect(result.entriesCreated).toBe(1);
      expect(mockLLM).toHaveBeenCalled();

      const proceduralEntries = storage.getByTier(MemoryTier.PROCEDURAL);
      expect(proceduralEntries.length).toBe(1);
    });

    it("should skip semantic entries with low access count", async () => {
      const oldTime = Date.now() - 8 * 24 * 60 * 60 * 1000;
      storage.insertEntry({
        id: randomUUID(),
        tier: MemoryTier.SEMANTIC,
        content: "Low access content",
        embedding: null,
        confidence: 0.85,
        accessCount: 1, // Below threshold of 3
        lastAccessed: oldTime,
        createdAt: oldTime,
        decayFactor: 2.0,
        metadata: {},
        tags: [],
        contentHash: "sem-low-" + randomUUID(),
      });

      const result = await pipeline.consolidateSemanticToProcedural();
      expect(result.entriesProcessed).toBe(0);
      expect(mockLLM).not.toHaveBeenCalled();
    });
  });

  describe("runFullConsolidation", () => {
    it("should run all stages without error", async () => {
      await expect(pipeline.runFullConsolidation()).resolves.not.toThrow();
    });

    it("should handle empty state gracefully", async () => {
      await pipeline.runFullConsolidation();
      expect(mockLLM).not.toHaveBeenCalled();
    });
  });
});
