import Database from "better-sqlite3";
import type { MemoryEntry } from "../../src/core/memory/types.js";
import { MemoryTier } from "../../src/core/memory/types.js";
import { randomUUID } from "crypto";

export function createTestDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  return db;
}

export function createMockMarketData() {
  return {
    price: 150.5 + Math.random() * 10,
    volume24h: 1000000 + Math.random() * 500000,
    change24h: -5 + Math.random() * 10,
    timestamp: Date.now(),
  };
}

export function createMockMemoryEntry(overrides?: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: randomUUID(),
    tier: MemoryTier.WORKING,
    content: "Test memory content",
    embedding: null,
    confidence: 0.8,
    accessCount: 0,
    lastAccessed: Date.now(),
    createdAt: Date.now(),
    decayFactor: 1.0,
    metadata: {},
    tags: [],
    contentHash: randomUUID(),
    ...overrides,
  };
}

export function cleanupTestDatabase(db: Database.Database): void {
  db.close();
}
