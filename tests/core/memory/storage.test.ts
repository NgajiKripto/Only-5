import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { MemoryStorage } from "../../../src/core/memory/storage.js";
import { MemoryTier } from "../../../src/core/memory/types.js";
import type { MemoryEntry, KnowledgeGraphNode, KnowledgeGraphEdge } from "../../../src/core/memory/types.js";

describe("MemoryStorage", () => {
  let db: Database.Database;
  let storage: MemoryStorage;

  beforeEach(() => {
    const dir = join(tmpdir(), "only5-test-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "test.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    storage = new MemoryStorage(db);
    storage.initialize();
  });

  afterEach(() => {
    db.close();
  });

  describe("initialization", () => {
    it("should create tables on initialization", () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = tables.map((t) => t.name);
      expect(names).toContain("memory_entries");
      expect(names).toContain("knowledge_graph_nodes");
      expect(names).toContain("knowledge_graph_edges");
      expect(names).toContain("consolidation_log");
    });

    it("should be safe to call initialize multiple times", () => {
      expect(() => storage.initialize()).not.toThrow();
    });
  });

  describe("memory entries CRUD", () => {
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

    it("should store and retrieve memory entries by ID", () => {
      const entry = makeEntry({ content: "Hello world" });
      storage.insertEntry(entry);

      const retrieved = storage.getEntry(entry.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(entry.id);
      expect(retrieved!.content).toBe("Hello world");
      expect(retrieved!.tier).toBe(MemoryTier.WORKING);
    });

    it("should get entries by tier with limit", () => {
      for (let i = 0; i < 5; i++) {
        storage.insertEntry(makeEntry({ tier: MemoryTier.WORKING }));
      }
      for (let i = 0; i < 3; i++) {
        storage.insertEntry(makeEntry({ tier: MemoryTier.EPISODIC }));
      }

      const working = storage.getByTier(MemoryTier.WORKING);
      expect(working).toHaveLength(5);

      const limited = storage.getByTier(MemoryTier.WORKING, 2);
      expect(limited).toHaveLength(2);

      const episodic = storage.getByTier(MemoryTier.EPISODIC);
      expect(episodic).toHaveLength(3);
    });

    it("should update existing entries", () => {
      const entry = makeEntry({ confidence: 0.5, accessCount: 0 });
      storage.insertEntry(entry);

      storage.updateEntry(entry.id, { confidence: 0.9, accessCount: 5 });

      const updated = storage.getEntry(entry.id);
      expect(updated!.confidence).toBe(0.9);
      expect(updated!.accessCount).toBe(5);
    });

    it("should get entry by content hash", () => {
      const hash = "unique-hash-123";
      const entry = makeEntry({ contentHash: hash });
      storage.insertEntry(entry);

      const found = storage.getByContentHash(hash);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(entry.id);
    });

    it("should return null for non-existent content hash", () => {
      const found = storage.getByContentHash("non-existent-hash");
      expect(found).toBeNull();
    });

    it("should return null for non-existent entry ID", () => {
      const found = storage.getEntry("non-existent-id");
      expect(found).toBeNull();
    });

    it("should handle empty results gracefully", () => {
      const entries = storage.getByTier(MemoryTier.PROCEDURAL);
      expect(entries).toEqual([]);

      const all = storage.getAllEntries();
      expect(all).toEqual([]);
    });

    it("should delete entries", () => {
      const entry = makeEntry();
      storage.insertEntry(entry);
      expect(storage.getEntry(entry.id)).not.toBeNull();

      storage.deleteEntry(entry.id);
      expect(storage.getEntry(entry.id)).toBeNull();
    });

    it("should store and retrieve embeddings correctly", () => {
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      const entry = makeEntry({ embedding });
      storage.insertEntry(entry);

      const retrieved = storage.getEntry(entry.id);
      expect(retrieved!.embedding).not.toBeNull();
      expect(retrieved!.embedding!.length).toBe(5);
      expect(retrieved!.embedding![0]).toBeCloseTo(0.1);
      expect(retrieved!.embedding![4]).toBeCloseTo(0.5);
    });

    it("should get entry count by tier", () => {
      storage.insertEntry(makeEntry({ tier: MemoryTier.WORKING }));
      storage.insertEntry(makeEntry({ tier: MemoryTier.WORKING }));
      storage.insertEntry(makeEntry({ tier: MemoryTier.SEMANTIC }));

      const counts = storage.getEntryCount();
      expect(counts[MemoryTier.WORKING]).toBe(2);
      expect(counts[MemoryTier.SEMANTIC]).toBe(1);
    });
  });

  describe("knowledge graph nodes", () => {
    it("should store and retrieve nodes", () => {
      const node: KnowledgeGraphNode = {
        id: randomUUID(),
        label: "SOL",
        entityType: "token",
        properties: { chain: "solana" },
        firstSeen: Date.now(),
        lastSeen: Date.now(),
      };
      storage.insertNode(node);

      const retrieved = storage.getNode(node.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.label).toBe("SOL");
      expect(retrieved!.entityType).toBe("token");
      expect(retrieved!.properties).toEqual({ chain: "solana" });
    });

    it("should get node by label", () => {
      const node: KnowledgeGraphNode = {
        id: randomUUID(),
        label: "Bitcoin",
        entityType: "token",
        properties: {},
        firstSeen: Date.now(),
        lastSeen: Date.now(),
      };
      storage.insertNode(node);

      const found = storage.getNodeByLabel("Bitcoin");
      expect(found).not.toBeNull();
      expect(found!.id).toBe(node.id);
    });

    it("should search nodes by label substring", () => {
      storage.insertNode({
        id: randomUUID(),
        label: "Solana Token",
        entityType: "token",
        properties: {},
        firstSeen: Date.now(),
        lastSeen: Date.now(),
      });
      storage.insertNode({
        id: randomUUID(),
        label: "Solana DeFi",
        entityType: "protocol",
        properties: {},
        firstSeen: Date.now(),
        lastSeen: Date.now(),
      });
      storage.insertNode({
        id: randomUUID(),
        label: "Ethereum",
        entityType: "chain",
        properties: {},
        firstSeen: Date.now(),
        lastSeen: Date.now(),
      });

      const results = storage.searchNodesByLabel("Solana");
      expect(results).toHaveLength(2);
    });
  });

  describe("knowledge graph edges", () => {
    it("should store and retrieve edges", () => {
      const sourceId = randomUUID();
      const targetId = randomUUID();
      const edge: KnowledgeGraphEdge = {
        id: randomUUID(),
        sourceId,
        targetId,
        relationship: "trades_on",
        weight: 0.8,
        metadata: { venue: "jupiter" },
      };
      storage.insertEdge(edge);

      const fromEdges = storage.getEdgesFrom(sourceId);
      expect(fromEdges).toHaveLength(1);
      expect(fromEdges[0].relationship).toBe("trades_on");
      expect(fromEdges[0].weight).toBe(0.8);
      expect(fromEdges[0].metadata).toEqual({ venue: "jupiter" });

      const toEdges = storage.getEdgesTo(targetId);
      expect(toEdges).toHaveLength(1);
      expect(toEdges[0].sourceId).toBe(sourceId);
    });

    it("should report edge count", () => {
      expect(storage.getEdgeCount()).toBe(0);

      storage.insertEdge({
        id: randomUUID(),
        sourceId: "a",
        targetId: "b",
        relationship: "relates",
        weight: 1.0,
        metadata: {},
      });
      storage.insertEdge({
        id: randomUUID(),
        sourceId: "b",
        targetId: "c",
        relationship: "relates",
        weight: 1.0,
        metadata: {},
      });

      expect(storage.getEdgeCount()).toBe(2);
    });
  });

  describe("consolidation log", () => {
    it("should log consolidation results", () => {
      expect(() =>
        storage.logConsolidation({
          fromTier: MemoryTier.WORKING,
          toTier: MemoryTier.EPISODIC,
          entriesProcessed: 5,
          entriesCreated: 2,
          timestamp: Date.now(),
        })
      ).not.toThrow();
    });
  });
});
