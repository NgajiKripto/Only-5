import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { MemoryStorage } from "../../../src/core/memory/storage.js";
import { KnowledgeGraph } from "../../../src/core/memory/knowledge-graph.js";

describe("KnowledgeGraph", () => {
  let db: Database.Database;
  let storage: MemoryStorage;
  let graph: KnowledgeGraph;

  beforeEach(() => {
    const dir = join(tmpdir(), "only5-test-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "test.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    storage = new MemoryStorage(db);
    storage.initialize();
    graph = new KnowledgeGraph(storage);
  });

  afterEach(() => {
    db.close();
  });

  describe("addEntity", () => {
    it("should create and return an ID", () => {
      const id = graph.addEntity("SOL", "token");
      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    it("should store entity with properties", () => {
      const id = graph.addEntity("Jupiter", "protocol", { type: "dex" });
      const node = storage.getNode(id);
      expect(node).not.toBeNull();
      expect(node!.label).toBe("Jupiter");
      expect(node!.entityType).toBe("protocol");
      expect(node!.properties).toEqual({ type: "dex" });
    });

    it("should return existing entity ID for duplicate label", () => {
      const id1 = graph.addEntity("SOL", "token");
      const id2 = graph.addEntity("SOL", "token");
      expect(id1).toBe(id2);
    });
  });

  describe("addRelationship", () => {
    it("should create edge between nodes", () => {
      const solId = graph.addEntity("SOL", "token");
      const jupId = graph.addEntity("Jupiter", "protocol");

      const edgeId = graph.addRelationship(solId, jupId, "trades_on");
      expect(edgeId).toBeDefined();

      const edges = storage.getEdgesFrom(solId);
      expect(edges).toHaveLength(1);
      expect(edges[0].targetId).toBe(jupId);
      expect(edges[0].relationship).toBe("trades_on");
    });

    it("should respect custom weight", () => {
      const a = graph.addEntity("A", "entity");
      const b = graph.addEntity("B", "entity");

      graph.addRelationship(a, b, "related", 0.75);

      const edges = storage.getEdgesFrom(a);
      expect(edges[0].weight).toBe(0.75);
    });
  });

  describe("findRelated", () => {
    it("should return connected nodes via BFS", () => {
      const sol = graph.addEntity("SOL", "token");
      const jup = graph.addEntity("Jupiter", "protocol");
      const usdc = graph.addEntity("USDC", "token");

      graph.addRelationship(sol, jup, "trades_on");
      graph.addRelationship(jup, usdc, "supports");

      const related = graph.findRelated(sol, 2);
      const labels = related.map((n) => n.label);
      expect(labels).toContain("Jupiter");
      expect(labels).toContain("USDC");
    });

    it("should respect maxDepth", () => {
      const a = graph.addEntity("A", "entity");
      const b = graph.addEntity("B", "entity");
      const c = graph.addEntity("C", "entity");
      const d = graph.addEntity("D", "entity");

      graph.addRelationship(a, b, "r");
      graph.addRelationship(b, c, "r");
      graph.addRelationship(c, d, "r");

      // maxDepth 1: only direct neighbors
      const depth1 = graph.findRelated(a, 1);
      const labels1 = depth1.map((n) => n.label);
      expect(labels1).toContain("B");
      expect(labels1).not.toContain("C");
      expect(labels1).not.toContain("D");
    });

    it("should return empty for isolated nodes", () => {
      const isolated = graph.addEntity("Isolated", "entity");
      const related = graph.findRelated(isolated);
      expect(related).toEqual([]);
    });

    it("should follow both incoming and outgoing edges", () => {
      const a = graph.addEntity("A", "entity");
      const b = graph.addEntity("B", "entity");
      const c = graph.addEntity("C", "entity");

      // b -> a (a has incoming), a -> c (a has outgoing)
      graph.addRelationship(b, a, "points_to");
      graph.addRelationship(a, c, "links_to");

      const related = graph.findRelated(a, 1);
      const labels = related.map((n) => n.label);
      expect(labels).toContain("B");
      expect(labels).toContain("C");
    });
  });

  describe("extractEntities", () => {
    it("should identify known crypto tokens", () => {
      const result = graph.extractEntities("I swapped SOL for USDC on Jupiter and also have BTC and ETH");
      const labels = result.entities.map((e) => e.label);
      expect(labels).toContain("SOL");
      expect(labels).toContain("USDC");
      expect(labels).toContain("BTC");
      expect(labels).toContain("ETH");
    });

    it("should identify capitalized multi-word phrases", () => {
      const result = graph.extractEntities("I used Magic Eden to trade NFTs on Solana Network");
      const labels = result.entities.map((e) => e.label);
      expect(labels).toContain("Magic Eden");
      expect(labels).toContain("Solana Network");
    });

    it("should identify strategy names", () => {
      const result = graph.extractEntities("The airdrop strategy worked well but staking had issues");
      const labels = result.entities.map((e) => e.label);
      expect(labels).toContain("airdrop");
      expect(labels).toContain("staking");
    });

    it("should not duplicate entities", () => {
      const result = graph.extractEntities("SOL SOL SOL price is going up for SOL");
      const solEntities = result.entities.filter((e) => e.label === "SOL");
      expect(solEntities).toHaveLength(1);
    });
  });

  describe("searchByLabel", () => {
    it("should find nodes by label substring", () => {
      graph.addEntity("Solana Token", "token");
      graph.addEntity("Solana DeFi", "protocol");
      graph.addEntity("Ethereum", "chain");

      const results = graph.searchByLabel("Solana");
      expect(results).toHaveLength(2);
      const labels = results.map((n) => n.label);
      expect(labels).toContain("Solana Token");
      expect(labels).toContain("Solana DeFi");
    });

    it("should return empty for no matches", () => {
      graph.addEntity("SOL", "token");
      const results = graph.searchByLabel("NonExistent");
      expect(results).toEqual([]);
    });
  });
});
