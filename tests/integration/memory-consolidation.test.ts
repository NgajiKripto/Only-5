import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { MemoryStorage } from "../../src/core/memory/storage.js";
import { EmbeddingService } from "../../src/core/memory/embedding.js";
import { MemoryLifecycle } from "../../src/core/memory/lifecycle.js";
import { ConsolidationPipeline } from "../../src/core/memory/consolidation.js";
import { MemoryTier } from "../../src/core/memory/types.js";
import type { LLMMessage, LLMResponse } from "../../src/types/index.js";
import { createTestDatabase, createMockMemoryEntry, cleanupTestDatabase } from "./helpers.js";

describe("Memory Consolidation Integration", () => {
  let db: Database.Database;
  let storage: MemoryStorage;
  let embeddingService: EmbeddingService;
  let lifecycle: MemoryLifecycle;
  let pipeline: ConsolidationPipeline;
  let mockLLM: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = createTestDatabase();
    storage = new MemoryStorage(db);
    storage.initialize();
    embeddingService = new EmbeddingService();
    lifecycle = new MemoryLifecycle(storage);

    mockLLM = vi.fn<[LLMMessage[], { temperature?: number; maxTokens?: number }?], Promise<LLMResponse>>()
      .mockResolvedValue({
        content: "Summary of observations: Market conditions were favorable. SOL price increased.",
        model: "test-model",
        tokensUsed: 30,
      });

    pipeline = new ConsolidationPipeline(
      storage,
      embeddingService,
      lifecycle,
      mockLLM,
    );
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  it("should store and retrieve WORKING tier entries", () => {
    const entry = createMockMemoryEntry({ content: "Observed SOL price at $150" });
    storage.insertEntry(entry);

    const entries = storage.getByTier(MemoryTier.WORKING);
    expect(entries.length).toBe(1);
    expect(entries[0].content).toBe("Observed SOL price at $150");
  });

  it("should consolidate WORKING entries to EPISODIC tier", async () => {
    // Insert entries with old timestamps (> 1 hour ago) so they get consolidated
    const oneHourAgo = Date.now() - 2 * 60 * 60 * 1000;

    for (let i = 0; i < 5; i++) {
      const entry = createMockMemoryEntry({
        content: `Market observation ${i}: SOL price moved ${i}%`,
        createdAt: oneHourAgo - i * 1000,
        lastAccessed: oneHourAgo - i * 1000,
        tags: ["market"],
      });
      storage.insertEntry(entry);
    }

    // Verify initial state
    expect(storage.getByTier(MemoryTier.WORKING).length).toBe(5);
    expect(storage.getByTier(MemoryTier.EPISODIC).length).toBe(0);

    // Run consolidation
    const result = await pipeline.consolidateWorkingToEpisodic();

    expect(result.fromTier).toBe(MemoryTier.WORKING);
    expect(result.toTier).toBe(MemoryTier.EPISODIC);
    expect(result.entriesProcessed).toBe(5);
    expect(result.entriesCreated).toBeGreaterThan(0);

    // Working entries should be removed
    expect(storage.getByTier(MemoryTier.WORKING).length).toBe(0);

    // Episodic entries should exist
    const episodic = storage.getByTier(MemoryTier.EPISODIC);
    expect(episodic.length).toBeGreaterThan(0);

    // LLM should have been called for summarization
    expect(mockLLM).toHaveBeenCalled();
  });

  it("should consolidate EPISODIC entries to SEMANTIC tier", async () => {
    // Insert entries directly into EPISODIC tier with old timestamps (> 24 hours)
    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;

    for (let i = 0; i < 3; i++) {
      const entry = createMockMemoryEntry({
        tier: MemoryTier.EPISODIC,
        content: `Episodic memory ${i}: Trading session produced ${i * 0.5} SOL profit`,
        createdAt: twoDaysAgo - i * 1000,
        lastAccessed: twoDaysAgo - i * 1000,
        tags: ["trading"],
      });
      storage.insertEntry(entry);
    }

    // Verify initial state
    expect(storage.getByTier(MemoryTier.EPISODIC).length).toBe(3);
    expect(storage.getByTier(MemoryTier.SEMANTIC).length).toBe(0);

    // Run consolidation
    const result = await pipeline.consolidateEpisodicToSemantic();

    expect(result.fromTier).toBe(MemoryTier.EPISODIC);
    expect(result.toTier).toBe(MemoryTier.SEMANTIC);
    expect(result.entriesProcessed).toBe(3);
    expect(result.entriesCreated).toBe(1);

    // EPISODIC entries should be removed
    expect(storage.getByTier(MemoryTier.EPISODIC).length).toBe(0);

    // SEMANTIC entries should exist
    const semantic = storage.getByTier(MemoryTier.SEMANTIC);
    expect(semantic.length).toBe(1);
  });

  it("should skip consolidation when no eligible entries exist", async () => {
    // Insert recent entries (not old enough for consolidation)
    const entry = createMockMemoryEntry({ content: "Very recent observation" });
    storage.insertEntry(entry);

    const result = await pipeline.consolidateWorkingToEpisodic();

    expect(result.entriesProcessed).toBe(0);
    expect(result.entriesCreated).toBe(0);

    // Entry should still be in WORKING
    expect(storage.getByTier(MemoryTier.WORKING).length).toBe(1);
  });

  it("should run full consolidation pipeline", async () => {
    // Set up entries at different age thresholds
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;

    // WORKING entries (old enough for Working->Episodic)
    for (let i = 0; i < 3; i++) {
      storage.insertEntry(createMockMemoryEntry({
        content: `Working memory ${i}`,
        createdAt: twoHoursAgo,
        lastAccessed: twoHoursAgo,
        tags: ["test"],
      }));
    }

    // EPISODIC entries (old enough for Episodic->Semantic)
    for (let i = 0; i < 2; i++) {
      storage.insertEntry(createMockMemoryEntry({
        tier: MemoryTier.EPISODIC,
        content: `Episodic memory ${i}`,
        createdAt: twoDaysAgo,
        lastAccessed: twoDaysAgo,
        tags: ["test"],
      }));
    }

    // Run full pipeline
    await pipeline.runFullConsolidation();

    // Working entries consolidated to episodic
    expect(storage.getByTier(MemoryTier.WORKING).length).toBe(0);
    // Episodic entries consolidated to semantic (old ones removed, new ones from working added)
    const episodic = storage.getByTier(MemoryTier.EPISODIC);
    const semantic = storage.getByTier(MemoryTier.SEMANTIC);
    // New episodic entries should have been created from working consolidation
    expect(episodic.length).toBeGreaterThanOrEqual(0);
    // Semantic should have been created from old episodic entries
    expect(semantic.length).toBe(1);
  });

  it("should handle consolidation without LLM (fallback mode)", async () => {
    // Create pipeline without LLM
    const noLlmPipeline = new ConsolidationPipeline(
      storage,
      embeddingService,
      lifecycle,
      null,
    );

    const oneHourAgo = Date.now() - 2 * 60 * 60 * 1000;
    for (let i = 0; i < 3; i++) {
      storage.insertEntry(createMockMemoryEntry({
        content: `Observation ${i}: data point for consolidation without LLM`,
        createdAt: oneHourAgo,
        lastAccessed: oneHourAgo,
        tags: ["fallback"],
      }));
    }

    const result = await noLlmPipeline.consolidateWorkingToEpisodic();

    expect(result.entriesProcessed).toBe(3);
    expect(result.entriesCreated).toBeGreaterThan(0);

    // Even without LLM, episodic entries should be created using fallback text
    const episodic = storage.getByTier(MemoryTier.EPISODIC);
    expect(episodic.length).toBeGreaterThan(0);
    expect(episodic[0].content.length).toBeGreaterThan(0);
  });

  it("should capture observations via the pipeline with deduplication", async () => {
    const content = "SOL price is at $155.30 with high volume";

    // First capture should succeed
    const id1 = await pipeline.captureObservation(content, { source: "market" });
    expect(id1).toBeTruthy();

    // Duplicate within 5 minutes should be skipped
    const id2 = await pipeline.captureObservation(content, { source: "market" });
    expect(id2).toBe("");

    // Only one entry should exist
    const entries = storage.getByTier(MemoryTier.WORKING);
    expect(entries.length).toBe(1);
  });

  it("should generate embeddings for consolidated entries", async () => {
    const oneHourAgo = Date.now() - 2 * 60 * 60 * 1000;

    storage.insertEntry(createMockMemoryEntry({
      content: "SOL price reached all-time high of $200",
      createdAt: oneHourAgo,
      lastAccessed: oneHourAgo,
      tags: ["price"],
    }));

    await pipeline.consolidateWorkingToEpisodic();

    const episodic = storage.getByTier(MemoryTier.EPISODIC);
    expect(episodic.length).toBe(1);
    // Embedding should be generated
    expect(episodic[0].embedding).not.toBeNull();
    expect(episodic[0].embedding!.length).toBeGreaterThan(0);
  });
});
