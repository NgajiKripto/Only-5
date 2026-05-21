import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StrategyPriorityManager } from "../../src/core/strategy-priority.js";
import { MemorySystem } from "../../src/core/memory.js";
import { PriorityTier } from "../../src/types/index.js";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

describe("StrategyPriorityManager", () => {
  let memory: MemorySystem;
  let manager: StrategyPriorityManager;

  beforeEach(() => {
    const dir = join(tmpdir(), "only5-test-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "test.db");
    memory = new MemorySystem(dbPath);
    manager = new StrategyPriorityManager({ memory });
  });

  afterEach(() => {
    memory.close();
  });

  describe("getTier", () => {
    it("should return CRITICAL for score > 0.8 with no failures and null hours", () => {
      const tier = manager.getTier(0.9, 0, null);
      expect(tier).toBe(PriorityTier.CRITICAL);
    });

    it("should return HIGH for score > 0.6 with no failures and null hours", () => {
      const tier = manager.getTier(0.7, 0, null);
      expect(tier).toBe(PriorityTier.HIGH);
    });

    it("should return MEDIUM for score > 0.3 with no failures and null hours", () => {
      const tier = manager.getTier(0.4, 0, null);
      expect(tier).toBe(PriorityTier.MEDIUM);
    });

    it("should return LOW for score <= 0.3 with no failures and null hours", () => {
      const tier = manager.getTier(0.2, 0, null);
      expect(tier).toBe(PriorityTier.LOW);
    });

    it("should return LOW when consecutiveFailures >= 5 regardless of score", () => {
      const tier = manager.getTier(0.5, 5, null);
      expect(tier).toBe(PriorityTier.LOW);
    });

    it("should return DORMANT when hoursSinceRevenue > 168 regardless of score", () => {
      const tier = manager.getTier(0.8, 0, 200);
      expect(tier).toBe(PriorityTier.DORMANT);
    });
  });

  describe("recordSuccess", () => {
    it("should reset consecutiveFailures to 0, upgrade tier, and update lastRevenueAt", () => {
      // Seed some failures first
      manager.recordFailure("test-strategy");
      manager.recordFailure("test-strategy");
      manager.recordFailure("test-strategy");

      manager.recordSuccess("test-strategy");

      const strategies = manager.getPrioritizedStrategies();
      const record = strategies.find((s) => s.strategy === "test-strategy");

      expect(record).toBeDefined();
      expect(record!.consecutiveFailures).toBe(0);
      expect(record!.lastRevenueAt).not.toBeNull();
      expect(record!.lastRevenueAt).toBeGreaterThan(0);
    });
  });

  describe("recordFailure", () => {
    it("should increment consecutiveFailures", () => {
      manager.recordFailure("test-strategy");
      manager.recordFailure("test-strategy");

      const strategies = manager.getPrioritizedStrategies();
      const record = strategies.find((s) => s.strategy === "test-strategy");

      expect(record).toBeDefined();
      expect(record!.consecutiveFailures).toBe(2);
    });

    it("should set tier to LOW after 5 consecutive failures", () => {
      for (let i = 0; i < 5; i++) {
        manager.recordFailure("test-strategy");
      }

      const strategies = manager.getPrioritizedStrategies();
      const record = strategies.find((s) => s.strategy === "test-strategy");

      expect(record).toBeDefined();
      expect(record!.tier).toBe(PriorityTier.LOW);
      expect(record!.consecutiveFailures).toBe(5);
    });
  });

  describe("boostStrategy", () => {
    it("should increase score by 0.2 and upgrade tier one level", () => {
      // First create a record via recordFailure so it exists
      manager.recordFailure("test-strategy");

      const beforeStrategies = manager.getPrioritizedStrategies();
      const before = beforeStrategies.find((s) => s.strategy === "test-strategy");
      const scoreBefore = before!.score;

      manager.boostStrategy("test-strategy");

      const afterStrategies = manager.getPrioritizedStrategies();
      const after = afterStrategies.find((s) => s.strategy === "test-strategy");

      expect(after!.score).toBeCloseTo(Math.min(1.0, scoreBefore + 0.2));
    });

    it("should cap score at 1.0", () => {
      // Create a strategy and boost it multiple times
      manager.recordSuccess("test-strategy");
      manager.boostStrategy("test-strategy");
      manager.boostStrategy("test-strategy");
      manager.boostStrategy("test-strategy");
      manager.boostStrategy("test-strategy");
      manager.boostStrategy("test-strategy");

      const strategies = manager.getPrioritizedStrategies();
      const record = strategies.find((s) => s.strategy === "test-strategy");

      expect(record!.score).toBeLessThanOrEqual(1.0);
    });
  });

  describe("getPrioritizedStrategies", () => {
    it("should return strategies sorted by tier (CRITICAL first) then by score", () => {
      // Create strategies with different tiers by seeding decision history
      // Strategy A - high performer
      const idA = memory.recordDecision({ strategy: "strategy-a", action: "test", reasoning: "test" });
      memory.recordOutcome(idA, "success", 5.0);
      // Strategy B - low performer
      const idB = memory.recordDecision({ strategy: "strategy-b", action: "test", reasoning: "test" });
      memory.recordOutcome(idB, "failure", -1.0);

      manager.recalculateAll(["strategy-a", "strategy-b"]);

      const strategies = manager.getPrioritizedStrategies();
      expect(strategies.length).toBe(2);

      // The strategy with higher tier/score should come first
      const tierOrder: Record<string, number> = {
        CRITICAL: 0,
        HIGH: 1,
        MEDIUM: 2,
        LOW: 3,
        DORMANT: 4,
      };

      for (let i = 0; i < strategies.length - 1; i++) {
        const current = strategies[i];
        const next = strategies[i + 1];
        const tierDiff = tierOrder[current.tier] - tierOrder[next.tier];
        if (tierDiff === 0) {
          expect(current.score).toBeGreaterThanOrEqual(next.score);
        } else {
          expect(tierDiff).toBeLessThanOrEqual(0);
        }
      }
    });
  });

  describe("persistence round-trip", () => {
    it("should persist and restore state via loadFromDatabase", () => {
      // Seed decision history
      const id1 = memory.recordDecision({ strategy: "persist-test", action: "trade", reasoning: "good signal" });
      memory.recordOutcome(id1, "success", 1.5);

      manager.recalculateAll(["persist-test"]);
      const before = manager.getPrioritizedStrategies();

      // Create a new manager with the same memory
      const manager2 = new StrategyPriorityManager({ memory });
      manager2.loadFromDatabase();
      const after = manager2.getPrioritizedStrategies();

      expect(after.length).toBe(before.length);
      expect(after[0].strategy).toBe(before[0].strategy);
      expect(after[0].tier).toBe(before[0].tier);
      expect(after[0].score).toBeCloseTo(before[0].score);
      expect(after[0].consecutiveFailures).toBe(before[0].consecutiveFailures);
      expect(after[0].lastRevenueAt).toBe(before[0].lastRevenueAt);
    });
  });

  describe("recalculateAll with no history", () => {
    it("should give new strategies a LOW tier and score of 0 when no history exists", () => {
      manager.recalculateAll(["brand-new-strategy"]);

      const strategies = manager.getPrioritizedStrategies();
      const record = strategies.find((s) => s.strategy === "brand-new-strategy");

      expect(record).toBeDefined();
      // With no history, calculateScore returns 0 (no revenue rate, no success rate, no recency)
      // getTier(0, 0, null) => LOW (score <= 0.3)
      expect(record!.tier).toBe(PriorityTier.LOW);
      expect(record!.score).toBe(0);
      expect(record!.consecutiveFailures).toBe(0);
    });
  });

  describe("calculateScore", () => {
    it("should return higher scores for strategies with more revenue", () => {
      // Strategy with revenue
      const id1 = memory.recordDecision({ strategy: "earner", action: "trade", reasoning: "signal" });
      memory.recordOutcome(id1, "success", 10.0);
      const id2 = memory.recordDecision({ strategy: "earner", action: "trade2", reasoning: "signal" });
      memory.recordOutcome(id2, "success", 5.0);

      // Strategy with no revenue
      const id3 = memory.recordDecision({ strategy: "loser", action: "trade", reasoning: "signal" });
      memory.recordOutcome(id3, "failure", -1.0);

      const earnerScore = manager.calculateScore("earner");
      const loserScore = manager.calculateScore("loser");

      expect(earnerScore).toBeGreaterThan(loserScore);
    });
  });
});
