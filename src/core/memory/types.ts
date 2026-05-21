export enum MemoryTier {
  WORKING = "WORKING",
  EPISODIC = "EPISODIC",
  SEMANTIC = "SEMANTIC",
  PROCEDURAL = "PROCEDURAL",
}

export interface MemoryEntry {
  id: string;
  tier: MemoryTier;
  content: string;
  embedding: number[] | null;
  confidence: number;
  accessCount: number;
  lastAccessed: number;
  createdAt: number;
  decayFactor: number;
  metadata: Record<string, unknown>;
  tags: string[];
  contentHash: string;
}

export interface SearchResult {
  entry: MemoryEntry;
  score: number;
  source: "bm25" | "vector" | "graph" | "fused";
}

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  entityType: string;
  properties: Record<string, unknown>;
  firstSeen: number;
  lastSeen: number;
}

export interface KnowledgeGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  weight: number;
  metadata: Record<string, unknown>;
}

export interface ConsolidationResult {
  fromTier: MemoryTier;
  toTier: MemoryTier;
  entriesProcessed: number;
  entriesCreated: number;
  timestamp: number;
}

export interface HybridSearchOptions {
  limit?: number;
  tiers?: MemoryTier[];
  bm25Weight?: number;
  vectorWeight?: number;
  includeGraph?: boolean;
}
