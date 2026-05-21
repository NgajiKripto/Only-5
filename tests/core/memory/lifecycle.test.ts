import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { MemoryStorage } from "../../../src/core/memory/storage.js";
import { MemoryLifecycle } from "../../../src/core/memory/lifecycle.js";
import { MemoryTier } from "../../../src/core/memory/types.js";
import type { MemoryEntry } from "../../../src/core/memory/types.js";

describe("MemoryLifecycle", () => {
  let db: Database.Database;
  let storage: MemoryStorage;
  let lifecycle: MemoryLifecycle;

  beforeEach(() => {
    const dir = join(tmpdir(), "only5-test-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "test.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    storage = new MemoryStorage(db);
    storage.initialize();
    lifecycle = new MemoryLifecycle(storage);
  });

  afterEach(() => {
    db.close();
  });

  const makeEntry = (overrides?: Partial<MemoryEntry>): MemoryEntry => ({
    id: randomUUID(),
    tier: MemoryTier.WORKING,
    content: "test content",
    embedding: null,
    confidence: 1.0,
    accessCount: 0,
    lastAccessed: Date.now(),
    createdAt: Date.now(),
    decayFactor: 1.0,
    metadata: {},
    tags: [],
    contentHash: "hash-" + randomUUID(),
    ...overrides,
  });

  describe("calculateDecay", () => {
    it("should return lower value for older memories", () => {
      const recentEntry = makeEntry({ lastAccessed: Date.now() });
      const oldEntry = makeEntry({ lastAccessed: Date.now() - 7200000 }); // 2 hours ago

      const recentDecay = lifecycle.calculateDecay(recentEntry);
      const oldDecay = lifecycle.calculateDecay(oldEntry);

      expect(recentDecay).toBeGreaterThan(oldDecay);
    });

    it("should return higher value for frequently accessed memories", () => {
      const now = Date.now();
      const lastAccessed = now - 3600000; // 1 hour ago

      const lowAccess = makeEntry({ accessCount: 0, lastAccessed });
      const highAccess = makeEntry({ accessCount: 10, lastAccessed });

      const lowDecay = lifecycle.calculateDecay(lowAccess);
      const highDecay = lifecycle.calculateDecay(highAccess);

      expect(highDecay).toBeGreaterThan(lowDecay);
    });

    it("should return value between 0 and 1 for reasonable inputs", () => {
      const entry = makeEntry({ lastAccessed: Date.now() - 1800000, accessCount: 2 });
      const decay = lifecycle.calculateDecay(entry);
      expect(decay).toBeGreaterThan(0);
      expect(decay).toBeLessThanOrEqual(1);
    });
  });

  describe("strengthenOnAccess", () => {
    it("should increment access_count", () => {
      const entry = makeEntry({ accessCount: 3 });
      storage.insertEntry(entry);

      lifecycle.strengthenOnAccess(entry.id);

      const updated = storage.getEntry(entry.id);
      expect(updated!.accessCount).toBe(4);
    });

    it("should update last_accessed timestamp", () => {
      const oldTime = Date.now() - 100000;
      const entry = makeEntry({ lastAccessed: oldTime });
      storage.insertEntry(entry);

      lifecycle.strengthenOnAccess(entry.id);

      const updated = storage.getEntry(entry.id);
      expect(updated!.lastAccessed).toBeGreaterThan(oldTime);
    });
  });

  describe("evictStaleMemories", () => {
    it("should remove entries below threshold", () => {
      // Insert an entry that was accessed long ago with low decay factor
      const staleEntry = makeEntry({
        lastAccessed: Date.now() - 100 * 3600000, // 100 hours ago
        confidence: 0.01,
        decayFactor: 0.001,
        accessCount: 0,
      });
      storage.insertEntry(staleEntry);

      // Insert a fresh entry
      const freshEntry = makeEntry({
        lastAccessed: Date.now(),
        confidence: 1.0,
        decayFactor: 1.0,
        accessCount: 5,
      });
      storage.insertEntry(freshEntry);

      const evicted = lifecycle.evictStaleMemories(0.1);
      expect(evicted).toBeGreaterThanOrEqual(1);
      expect(storage.getEntry(freshEntry.id)).not.toBeNull();
    });

    it("should return count of evicted entries", () => {
      // Create very stale entries
      for (let i = 0; i < 3; i++) {
        storage.insertEntry(
          makeEntry({
            lastAccessed: Date.now() - 200 * 3600000,
            confidence: 0.001,
            decayFactor: 0.0001,
            accessCount: 0,
          })
        );
      }

      const evicted = lifecycle.evictStaleMemories(0.5);
      expect(evicted).toBe(3);
    });

    it("should not evict fresh entries", () => {
      const entry = makeEntry({
        lastAccessed: Date.now(),
        confidence: 1.0,
        accessCount: 5,
      });
      storage.insertEntry(entry);

      const evicted = lifecycle.evictStaleMemories(0.1);
      expect(evicted).toBe(0);
      expect(storage.getEntry(entry.id)).not.toBeNull();
    });
  });

  describe("isDuplicate", () => {
    it("should return true for same content within 5min window", () => {
      const content = "SOL price is 150 USD";
      const hash = lifecycle.getContentHash(content);
      const entry = makeEntry({
        content,
        contentHash: hash,
        createdAt: Date.now(),
      });
      storage.insertEntry(entry);

      expect(lifecycle.isDuplicate(content)).toBe(true);
    });

    it("should return false for same content after 5min window", () => {
      const content = "SOL price is 150 USD";
      const hash = lifecycle.getContentHash(content);
      const entry = makeEntry({
        content,
        contentHash: hash,
        createdAt: Date.now() - 6 * 60 * 1000, // 6 minutes ago
      });
      storage.insertEntry(entry);

      expect(lifecycle.isDuplicate(content)).toBe(false);
    });

    it("should return false for different content", () => {
      const entry = makeEntry({
        content: "Original content",
        contentHash: lifecycle.getContentHash("Original content"),
        createdAt: Date.now(),
      });
      storage.insertEntry(entry);

      expect(lifecycle.isDuplicate("Different content entirely")).toBe(false);
    });
  });

  describe("getContentHash", () => {
    it("should be deterministic (same input produces same hash)", () => {
      const hash1 = lifecycle.getContentHash("Hello world");
      const hash2 = lifecycle.getContentHash("Hello world");
      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different inputs", () => {
      const hash1 = lifecycle.getContentHash("Hello world");
      const hash2 = lifecycle.getContentHash("Goodbye world");
      expect(hash1).not.toBe(hash2);
    });

    it("should return a hex string", () => {
      const hash = lifecycle.getContentHash("test");
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe("detectContradictions", () => {
    it("should find entries with opposing signals", () => {
      const existingEntries: MemoryEntry[] = [
        makeEntry({ content: "The staking strategy had success with high APY" }),
        makeEntry({ content: "Weather is nice today" }),
      ];

      const contradictions = lifecycle.detectContradictions(
        "The staking strategy had failure with low APY",
        existingEntries
      );

      expect(contradictions.length).toBeGreaterThan(0);
    });

    it("should not flag entries without negation patterns", () => {
      const existingEntries: MemoryEntry[] = [
        makeEntry({ content: "SOL price went up today" }),
      ];

      const contradictions = lifecycle.detectContradictions(
        "SOL price went up significantly",
        existingEntries
      );

      expect(contradictions).toHaveLength(0);
    });

    it("should return empty for unrelated content", () => {
      const existingEntries: MemoryEntry[] = [
        makeEntry({ content: "Solana blockchain is fast" }),
      ];

      const contradictions = lifecycle.detectContradictions(
        "Weather is cold today",
        existingEntries
      );

      expect(contradictions).toHaveLength(0);
    });
  });
});
