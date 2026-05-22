import { v4 as uuidv4 } from "uuid";
import { createLogger } from "../logger.js";
import type { MemoryStorage } from "./storage.js";
import type { KnowledgeGraphNode } from "./types.js";

const logger = createLogger("knowledge-graph");

const KNOWN_TOKENS = [
  "SOL", "USDC", "USDT", "BTC", "ETH", "RAY", "SRM", "MNGO",
  "BONK", "JTO", "JUP", "WIF", "ORCA", "MSOL", "JSOL",
];

export class KnowledgeGraph {
  private storage: MemoryStorage;

  constructor(storage: MemoryStorage) {
    this.storage = storage;
  }

  addEntity(label: string, entityType: string, properties?: Record<string, unknown>): string {
    // Check if entity already exists
    const existing = this.storage.getNodeByLabel(label);
    if (existing) {
      this.storage.updateNodeLastSeen(existing.id, Date.now());
      return existing.id;
    }

    const id = uuidv4();
    const now = Date.now();
    this.storage.insertNode({
      id,
      label,
      entityType,
      properties: properties ?? {},
      firstSeen: now,
      lastSeen: now,
    });
    return id;
  }

  addRelationship(sourceId: string, targetId: string, relationship: string, weight?: number): string {
    const id = uuidv4();
    this.storage.insertEdge({
      id,
      sourceId,
      targetId,
      relationship,
      weight: weight ?? 1.0,
      metadata: {},
    });
    return id;
  }

  findRelated(entityId: string, maxDepth: number = 2): KnowledgeGraphNode[] {
    const visited = new Set<string>();
    const result: KnowledgeGraphNode[] = [];
    const queue: Array<{ id: string; depth: number }> = [{ id: entityId, depth: 0 }];

    visited.add(entityId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;

      // Get outgoing edges
      const outEdges = this.storage.getEdgesFrom(current.id);
      for (const edge of outEdges) {
        if (!visited.has(edge.targetId)) {
          visited.add(edge.targetId);
          const node = this.storage.getNode(edge.targetId);
          if (node) {
            result.push(node);
            queue.push({ id: edge.targetId, depth: current.depth + 1 });
          }
        }
      }

      // Get incoming edges
      const inEdges = this.storage.getEdgesTo(current.id);
      for (const edge of inEdges) {
        if (!visited.has(edge.sourceId)) {
          visited.add(edge.sourceId);
          const node = this.storage.getNode(edge.sourceId);
          if (node) {
            result.push(node);
            queue.push({ id: edge.sourceId, depth: current.depth + 1 });
          }
        }
      }
    }

    return result;
  }

  extractEntities(text: string): {
    entities: Array<{ label: string; type: string }>;
    relationships: Array<{ source: string; target: string; relation: string }>;
  } {
    const entities: Array<{ label: string; type: string }> = [];
    const relationships: Array<{ source: string; target: string; relation: string }> = [];
    const seenLabels = new Set<string>();

    // Extract known crypto tokens
    for (const token of KNOWN_TOKENS) {
      const regex = new RegExp(`\\b${token}\\b`, "g");
      if (regex.test(text)) {
        if (!seenLabels.has(token)) {
          entities.push({ label: token, type: "token" });
          seenLabels.add(token);
        }
      }
    }

    // Extract capitalized multi-word phrases (potential entity names)
    const capitalizedPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
    let match: RegExpExecArray | null;
    while ((match = capitalizedPattern.exec(text)) !== null) {
      const phrase = match[1];
      if (!seenLabels.has(phrase)) {
        entities.push({ label: phrase, type: "entity" });
        seenLabels.add(phrase);
      }
    }

    // Extract strategy names (known patterns)
    const strategyPattern = /\b(arbitrage|staking|airdrop|bounty|microtask|onchain|security[\s-]?bounty|security[\s-]?service|content)\b/gi;
    while ((match = strategyPattern.exec(text)) !== null) {
      const name = match[1].toLowerCase();
      if (!seenLabels.has(name)) {
        entities.push({ label: name, type: "strategy" });
        seenLabels.add(name);
      }
    }

    // Extract simple relationships from patterns like "X to Y" or "X -> Y"
    const relPattern = /(\w+)\s+(?:to|->|=>)\s+(\w+)/gi;
    while ((match = relPattern.exec(text)) !== null) {
      const source = match[1];
      const target = match[2];
      if (seenLabels.has(source) || seenLabels.has(target)) {
        relationships.push({ source, target, relation: "relates_to" });
      }
    }

    return { entities, relationships };
  }

  searchByLabel(label: string): KnowledgeGraphNode[] {
    return this.storage.searchNodesByLabel(label);
  }
}
