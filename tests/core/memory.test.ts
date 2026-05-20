import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemorySystem } from "../../src/core/memory.js";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

describe("MemorySystem", () => {
  let memory: MemorySystem;
  let dbPath: string;

  beforeEach(() => {
    const dir = join(tmpdir(), "only5-test-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    dbPath = join(dir, "test.db");
    memory = new MemorySystem(dbPath);
  });

  afterEach(() => {
    memory.close();
  });

  describe("database initialization", () => {
    it("should create database and tables without error", () => {
      expect(memory).toBeDefined();
    });

    it("should allow creating a second instance on the same path", () => {
      memory.close();
      const memory2 = new MemorySystem(dbPath);
      expect(memory2).toBeDefined();
      memory2.close();
      // re-create memory to avoid afterEach error
      memory = new MemorySystem(dbPath);
    });
  });

  describe("remember and recall", () => {
    it("should store and retrieve observations", () => {
      memory.remember("market", "BTC price is rising");
      memory.remember("market", "ETH volume increasing");
      memory.remember("alert", "Low SOL balance");

      const marketObs = memory.recall("market");
      expect(marketObs).toHaveLength(2);
      // Both should be present (order depends on timestamp granularity)
      const contents = marketObs.map((o) => o.content);
      expect(contents).toContain("BTC price is rising");
      expect(contents).toContain("ETH volume increasing");
    });

    it("should respect limit parameter", () => {
      for (let i = 0; i < 20; i++) {
        memory.remember("test", `observation ${i}`);
      }

      const results = memory.recall("test", 5);
      expect(results).toHaveLength(5);
    });

    it("should return empty array for unknown category", () => {
      const results = memory.recall("nonexistent");
      expect(results).toHaveLength(0);
    });

    it("should return id when storing observation", () => {
      const id = memory.remember("test", "hello");
      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe("recordDecision and recordOutcome", () => {
    it("should record a decision and return an id", () => {
      const id = memory.recordDecision({
        strategy: "arbitrage",
        action: "buy SOL on Jupiter",
        reasoning: "Price discrepancy detected",
      });

      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
    });

    it("should update decision with outcome and reward", () => {
      const id = memory.recordDecision({
        strategy: "arbitrage",
        action: "buy SOL",
        reasoning: "Discount found",
      });

      memory.recordOutcome(id, "success", 0.5);

      const perf = memory.getStrategyPerformance("arbitrage");
      expect(perf.totalActions).toBe(1);
      expect(perf.successRate).toBe(1);
      expect(perf.totalReward).toBe(0.5);
    });

    it("should handle negative rewards", () => {
      const id = memory.recordDecision({
        strategy: "trading",
        action: "sell token",
        reasoning: "Stop loss triggered",
      });

      memory.recordOutcome(id, "failure", -0.2);

      const perf = memory.getStrategyPerformance("trading");
      expect(perf.totalActions).toBe(1);
      expect(perf.successRate).toBe(0);
      expect(perf.totalReward).toBe(-0.2);
    });
  });

  describe("getStrategyPerformance", () => {
    it("should calculate correct performance metrics", () => {
      // Create multiple decisions
      const id1 = memory.recordDecision({
        strategy: "staking",
        action: "stake SOL",
        reasoning: "Good APY",
      });
      const id2 = memory.recordDecision({
        strategy: "staking",
        action: "stake more SOL",
        reasoning: "APY still good",
      });
      const id3 = memory.recordDecision({
        strategy: "staking",
        action: "unstake",
        reasoning: "APY dropped",
      });

      memory.recordOutcome(id1, "success", 1.0);
      memory.recordOutcome(id2, "success", 0.5);
      memory.recordOutcome(id3, "failure", -0.3);

      const perf = memory.getStrategyPerformance("staking");
      expect(perf.totalActions).toBe(3);
      expect(perf.successRate).toBeCloseTo(2 / 3);
      expect(perf.totalReward).toBeCloseTo(1.2);
    });

    it("should return zero stats for unknown strategy", () => {
      const perf = memory.getStrategyPerformance("unknown");
      expect(perf.totalActions).toBe(0);
      expect(perf.successRate).toBe(0);
      expect(perf.totalReward).toBe(0);
    });

    it("should only count decisions with outcomes", () => {
      memory.recordDecision({
        strategy: "test",
        action: "do something",
        reasoning: "why not",
      });

      const perf = memory.getStrategyPerformance("test");
      expect(perf.totalActions).toBe(0); // no outcome recorded yet
    });
  });

  describe("skills", () => {
    it("should save and retrieve skills", () => {
      memory.saveSkill({
        name: "price-check",
        description: "Check token prices on Jupiter",
        code: "async function checkPrice() {}",
        success_rate: 0.9,
        uses: 10,
      });

      const skills = memory.getSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("price-check");
      expect(skills[0].success_rate).toBe(0.9);
      expect(skills[0].uses).toBe(10);
    });

    it("should update existing skill on name conflict", () => {
      memory.saveSkill({
        name: "swap",
        description: "v1",
        code: "code v1",
        success_rate: 0.5,
        uses: 5,
      });

      memory.saveSkill({
        name: "swap",
        description: "v2",
        code: "code v2",
        success_rate: 0.8,
        uses: 15,
      });

      const skills = memory.getSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].description).toBe("v2");
      expect(skills[0].success_rate).toBe(0.8);
    });

    it("should return empty array when no skills exist", () => {
      const skills = memory.getSkills();
      expect(skills).toHaveLength(0);
    });
  });
});
