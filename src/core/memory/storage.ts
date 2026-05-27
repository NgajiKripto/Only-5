// SECURITY NOTE: For production deployments, consider replacing better-sqlite3 with
// @journeyapps/sqlcipher or similar for at-rest encryption of the database file.
// The database may contain sensitive trading data, decision history, and memory entries.
import { chmodSync } from "fs";
import { platform } from "os";
import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { createLogger } from "../logger.js";
import type {
  MemoryEntry,
  KnowledgeGraphNode,
  KnowledgeGraphEdge,
  ConsolidationResult,
  MemoryTier,
} from "./types.js";

const logger = createLogger("memory-storage");

export class MemoryStorage {
  private db: Database.Database;
  private dbPath: string | null = null;

  constructor(db: Database.Database, dbPath?: string) {
    this.db = db;
    this.dbPath = dbPath ?? null;
  }

  static setFilePermissions(dbPath: string): void {
    if (platform() !== "win32") {
      try {
        chmodSync(dbPath, 0o600);
      } catch {
        // Permission setting may fail in some environments
      }
    }
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        tier TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB,
        confidence REAL NOT NULL DEFAULT 1.0,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        decay_factor REAL NOT NULL DEFAULT 1.0,
        metadata TEXT NOT NULL DEFAULT '{}',
        tags TEXT NOT NULL DEFAULT '[]',
        content_hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        properties TEXT NOT NULL DEFAULT '{}',
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relationship TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS consolidation_log (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        from_tier TEXT NOT NULL,
        to_tier TEXT NOT NULL,
        entries_processed INTEGER NOT NULL,
        entries_created INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memory_entries_tier ON memory_entries(tier);
      CREATE INDEX IF NOT EXISTS idx_memory_entries_content_hash ON memory_entries(content_hash);
      CREATE INDEX IF NOT EXISTS idx_memory_entries_created_at ON memory_entries(created_at);
      CREATE INDEX IF NOT EXISTS idx_knowledge_graph_edges_source ON knowledge_graph_edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_graph_edges_target ON knowledge_graph_edges(target_id);
    `);

    // Set restrictive file permissions on the database
    if (this.dbPath) {
      MemoryStorage.setFilePermissions(this.dbPath);
    }

    logger.info("Advanced memory storage initialized");
  }

  // --- Memory Entries CRUD ---

  insertEntry(entry: MemoryEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO memory_entries (id, tier, content, embedding, confidence, access_count, last_accessed, created_at, decay_factor, metadata, tags, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.id,
      entry.tier,
      entry.content,
      entry.embedding ? Buffer.from(new Float64Array(entry.embedding).buffer) : null,
      entry.confidence,
      entry.accessCount,
      entry.lastAccessed,
      entry.createdAt,
      entry.decayFactor,
      JSON.stringify(entry.metadata),
      JSON.stringify(entry.tags),
      entry.contentHash
    );
  }

  getEntry(id: string): MemoryEntry | null {
    const stmt = this.db.prepare("SELECT * FROM memory_entries WHERE id = ?");
    const row = stmt.get(id) as RawMemoryRow | undefined;
    if (!row) return null;
    return this.rowToEntry(row);
  }

  updateEntry(id: string, updates: Partial<Pick<MemoryEntry, "confidence" | "accessCount" | "lastAccessed" | "embedding" | "decayFactor">>): void {
    const parts: string[] = [];
    const values: unknown[] = [];

    if (updates.confidence !== undefined) {
      parts.push("confidence = ?");
      values.push(updates.confidence);
    }
    if (updates.accessCount !== undefined) {
      parts.push("access_count = ?");
      values.push(updates.accessCount);
    }
    if (updates.lastAccessed !== undefined) {
      parts.push("last_accessed = ?");
      values.push(updates.lastAccessed);
    }
    if (updates.embedding !== undefined) {
      parts.push("embedding = ?");
      values.push(updates.embedding ? Buffer.from(new Float64Array(updates.embedding).buffer) : null);
    }
    if (updates.decayFactor !== undefined) {
      parts.push("decay_factor = ?");
      values.push(updates.decayFactor);
    }

    if (parts.length === 0) return;

    values.push(id);
    const stmt = this.db.prepare(`UPDATE memory_entries SET ${parts.join(", ")} WHERE id = ?`);
    stmt.run(...values);
  }

  deleteEntry(id: string): void {
    const stmt = this.db.prepare("DELETE FROM memory_entries WHERE id = ?");
    stmt.run(id);
  }

  getByTier(tier: MemoryTier, limit?: number): MemoryEntry[] {
    const sql = limit
      ? "SELECT * FROM memory_entries WHERE tier = ? ORDER BY created_at DESC LIMIT ?"
      : "SELECT * FROM memory_entries WHERE tier = ? ORDER BY created_at DESC";
    const stmt = this.db.prepare(sql);
    const rows = (limit ? stmt.all(tier, limit) : stmt.all(tier)) as RawMemoryRow[];
    return rows.map((r) => this.rowToEntry(r));
  }

  getByContentHash(hash: string): MemoryEntry | null {
    const stmt = this.db.prepare("SELECT * FROM memory_entries WHERE content_hash = ? LIMIT 1");
    const row = stmt.get(hash) as RawMemoryRow | undefined;
    if (!row) return null;
    return this.rowToEntry(row);
  }

  getAllEntries(limit?: number): MemoryEntry[] {
    const sql = limit
      ? "SELECT * FROM memory_entries ORDER BY created_at DESC LIMIT ?"
      : "SELECT * FROM memory_entries ORDER BY created_at DESC";
    const stmt = this.db.prepare(sql);
    const rows = (limit ? stmt.all(limit) : stmt.all()) as RawMemoryRow[];
    return rows.map((r) => this.rowToEntry(r));
  }

  getEntriesOlderThan(tier: MemoryTier, ageMs: number): MemoryEntry[] {
    const cutoff = Date.now() - ageMs;
    const stmt = this.db.prepare(
      "SELECT * FROM memory_entries WHERE tier = ? AND created_at < ? ORDER BY created_at ASC"
    );
    const rows = stmt.all(tier, cutoff) as RawMemoryRow[];
    return rows.map((r) => this.rowToEntry(r));
  }

  getEntriesWithHighAccess(tier: MemoryTier, minAccessCount: number): MemoryEntry[] {
    const stmt = this.db.prepare(
      "SELECT * FROM memory_entries WHERE tier = ? AND access_count >= ? ORDER BY access_count DESC"
    );
    const rows = stmt.all(tier, minAccessCount) as RawMemoryRow[];
    return rows.map((r) => this.rowToEntry(r));
  }

  getStaleEntryCandidates(lastAccessedBefore: number): MemoryEntry[] {
    const stmt = this.db.prepare(
      "SELECT * FROM memory_entries WHERE last_accessed < ? ORDER BY last_accessed ASC"
    );
    const rows = stmt.all(lastAccessedBefore) as RawMemoryRow[];
    return rows.map((r) => this.rowToEntry(r));
  }

  deleteEntriesBelowConfidence(threshold: number): number {
    const stmt = this.db.prepare("DELETE FROM memory_entries WHERE confidence < ?");
    const result = stmt.run(threshold);
    return result.changes;
  }

  getEntryCount(): Record<string, number> {
    const stmt = this.db.prepare("SELECT tier, COUNT(*) as count FROM memory_entries GROUP BY tier");
    const rows = stmt.all() as Array<{ tier: string; count: number }>;
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.tier] = row.count;
    }
    return counts;
  }

  // --- Knowledge Graph Nodes ---

  insertNode(node: KnowledgeGraphNode): void {
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_graph_nodes (id, label, entity_type, properties, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(node.id, node.label, node.entityType, JSON.stringify(node.properties), node.firstSeen, node.lastSeen);
  }

  getNode(id: string): KnowledgeGraphNode | null {
    const stmt = this.db.prepare("SELECT * FROM knowledge_graph_nodes WHERE id = ?");
    const row = stmt.get(id) as RawNodeRow | undefined;
    if (!row) return null;
    return this.rowToNode(row);
  }

  getNodeByLabel(label: string): KnowledgeGraphNode | null {
    const stmt = this.db.prepare("SELECT * FROM knowledge_graph_nodes WHERE label = ? LIMIT 1");
    const row = stmt.get(label) as RawNodeRow | undefined;
    if (!row) return null;
    return this.rowToNode(row);
  }

  searchNodesByLabel(label: string): KnowledgeGraphNode[] {
    const stmt = this.db.prepare("SELECT * FROM knowledge_graph_nodes WHERE label LIKE ?");
    const rows = stmt.all(`%${label}%`) as RawNodeRow[];
    return rows.map((r) => this.rowToNode(r));
  }

  updateNodeLastSeen(id: string, lastSeen: number): void {
    const stmt = this.db.prepare("UPDATE knowledge_graph_nodes SET last_seen = ? WHERE id = ?");
    stmt.run(lastSeen, id);
  }

  getAllNodes(): KnowledgeGraphNode[] {
    const stmt = this.db.prepare("SELECT * FROM knowledge_graph_nodes");
    const rows = stmt.all() as RawNodeRow[];
    return rows.map((r) => this.rowToNode(r));
  }

  getNodeCount(): number {
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM knowledge_graph_nodes");
    const row = stmt.get() as { count: number };
    return row.count;
  }

  // --- Knowledge Graph Edges ---

  insertEdge(edge: KnowledgeGraphEdge): void {
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_graph_edges (id, source_id, target_id, relationship, weight, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(edge.id, edge.sourceId, edge.targetId, edge.relationship, edge.weight, JSON.stringify(edge.metadata));
  }

  getEdgesFrom(sourceId: string): KnowledgeGraphEdge[] {
    const stmt = this.db.prepare("SELECT * FROM knowledge_graph_edges WHERE source_id = ?");
    const rows = stmt.all(sourceId) as RawEdgeRow[];
    return rows.map((r) => this.rowToEdge(r));
  }

  getEdgesTo(targetId: string): KnowledgeGraphEdge[] {
    const stmt = this.db.prepare("SELECT * FROM knowledge_graph_edges WHERE target_id = ?");
    const rows = stmt.all(targetId) as RawEdgeRow[];
    return rows.map((r) => this.rowToEdge(r));
  }

  getEdgeCount(): number {
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM knowledge_graph_edges");
    const row = stmt.get() as { count: number };
    return row.count;
  }

  // --- Consolidation Log ---

  logConsolidation(result: ConsolidationResult): void {
    const id = uuidv4();
    const stmt = this.db.prepare(`
      INSERT INTO consolidation_log (id, timestamp, from_tier, to_tier, entries_processed, entries_created)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, result.timestamp, result.fromTier, result.toTier, result.entriesProcessed, result.entriesCreated);
  }

  // --- Helpers ---

  private rowToEntry(row: RawMemoryRow): MemoryEntry {
    let embedding: number[] | null = null;
    if (row.embedding) {
      const buf = row.embedding as Buffer;
      const float64 = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
      embedding = Array.from(float64);
    }

    return {
      id: row.id,
      tier: row.tier as MemoryTier,
      content: row.content,
      embedding,
      confidence: row.confidence,
      accessCount: row.access_count,
      lastAccessed: row.last_accessed,
      createdAt: row.created_at,
      decayFactor: row.decay_factor,
      metadata: JSON.parse(row.metadata) as Record<string, unknown>,
      tags: JSON.parse(row.tags) as string[],
      contentHash: row.content_hash,
    };
  }

  private rowToNode(row: RawNodeRow): KnowledgeGraphNode {
    return {
      id: row.id,
      label: row.label,
      entityType: row.entity_type,
      properties: JSON.parse(row.properties) as Record<string, unknown>,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
    };
  }

  private rowToEdge(row: RawEdgeRow): KnowledgeGraphEdge {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      relationship: row.relationship,
      weight: row.weight,
      metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    };
  }
}

interface RawMemoryRow {
  id: string;
  tier: string;
  content: string;
  embedding: Buffer | null;
  confidence: number;
  access_count: number;
  last_accessed: number;
  created_at: number;
  decay_factor: number;
  metadata: string;
  tags: string;
  content_hash: string;
}

interface RawNodeRow {
  id: string;
  label: string;
  entity_type: string;
  properties: string;
  first_seen: number;
  last_seen: number;
}

interface RawEdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  relationship: string;
  weight: number;
  metadata: string;
}
