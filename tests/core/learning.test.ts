import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LearningSystem, type LearningInsight } from "../../src/core/learning.js";
import { MemorySystem } from "../../src/core/memory.js";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

describe("LearningSystem", () => {
  let learning: LearningSystem;
  let memory: MemorySystem;
  let mockLLM: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const dir = join(tmpdir(), "only5-test-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "test.db");
    memory = new MemorySystem(dbPath);

    mockLLM = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        insights: [
          {
            strategy: "onchain",
            pattern: "Small trades in low-volume periods tend to succeed",
            recommendation: "Focus on off-peak hours for small trades",
            confidence: 0.8,
          },
          {
            strategy: "bounty",
            pattern: "Documentation bounties have higher completion rate",
            recommendation: "Prioritize documentation-related bounties",
            confidence: 0.7,
          },
        ],
      }),
      model: "test-model",
      tokensUsed: 100,
    });

    learning = new LearningSystem({
      llm: mockLLM,
      memory,
    });
  });

  afterEach(() => {
    memory.close();
  });

  describe("runLearningCycle", () => {
    it("should return empty array when no decisions exist", async () => {
      const insights = await learning.runLearningCycle();
      expect(insights).toEqual([]);
      expect(mockLLM).not.toHaveBeenCalled();
    });

    it("should extract insights from mock decisions", async () => {
      // Add decisions to the decisions table via recordDecision
      const id1 = memory.recordDecision({
        strategy: "onchain",
        action: "swap SOL to USDC",
        reasoning: "Price dip detected",
      });
      memory.recordOutcome(id1, "success", 0.5);

      const id2 = memory.recordDecision({
        strategy: "bounty",
        action: "claim docs bounty",
        reasoning: "Easy task",
      });
      memory.recordOutcome(id2, "success", 1.0);

      const insights = await learning.runLearningCycle();

      expect(mockLLM).toHaveBeenCalledTimes(1);
      expect(insights).toHaveLength(2);
      expect(insights[0].strategy).toBe("onchain");
      expect(insights[1].strategy).toBe("bounty");
    });

    it("should handle LLM failure gracefully", async () => {
      memory.recordDecision({
        strategy: "test",
        action: "test action",
        reasoning: "testing",
      });

      mockLLM.mockRejectedValueOnce(new Error("API timeout"));

      const insights = await learning.runLearningCycle();
      expect(insights).toEqual([]);
    });

    it("should handle malformed LLM response", async () => {
      memory.recordDecision({
        strategy: "test",
        action: "test",
        reasoning: "test",
      });

      mockLLM.mockResolvedValueOnce({
        content: "This is not JSON at all",
        model: "test",
        tokensUsed: 10,
      });

      const insights = await learning.runLearningCycle();
      expect(insights).toEqual([]);
    });
  });

  describe("persistLearnings", () => {
    it("should store insights in memory", async () => {
      const insights: LearningInsight[] = [
        {
          strategy: "onchain",
          pattern: "Morning trades perform better",
          recommendation: "Trade in the morning",
          confidence: 0.85,
        },
      ];

      await learning.persistLearnings(insights);

      const stored = memory.recall("learning_insights", 10);
      expect(stored).toHaveLength(1);

      const parsed = JSON.parse(stored[0].content);
      expect(parsed.strategy).toBe("onchain");
      expect(parsed.pattern).toBe("Morning trades perform better");
    });

    it("should save insights as skills", async () => {
      const insights: LearningInsight[] = [
        {
          strategy: "bounty",
          pattern: "Focus on TypeScript issues",
          recommendation: "Filter for TypeScript bounties",
          confidence: 0.9,
        },
      ];

      await learning.persistLearnings(insights);

      const skills = memory.getSkills();
      expect(skills.length).toBeGreaterThanOrEqual(1);
      expect(skills[0].description).toBe("Focus on TypeScript issues");
      expect(skills[0].code).toBe("Filter for TypeScript bounties");
    });

    it("should update confidence scores based on insights", async () => {
      const insights: LearningInsight[] = [
        {
          strategy: "good_strategy",
          pattern: "Works well",
          recommendation: "Keep going",
          confidence: 0.9, // high confidence -> increase
        },
        {
          strategy: "bad_strategy",
          pattern: "Keeps failing",
          recommendation: "Reduce usage",
          confidence: 0.2, // low confidence -> decrease
        },
      ];

      await learning.persistLearnings(insights);

      expect(learning.getConfidence("good_strategy")).toBeGreaterThan(0.5);
      expect(learning.getConfidence("bad_strategy")).toBeLessThan(0.5);
    });
  });

  describe("updateConfidence", () => {
    it("should increase confidence on up direction", () => {
      const score = learning.updateConfidence("test", "up");
      expect(score).toBe(0.55);
    });

    it("should decrease confidence on down direction", () => {
      const score = learning.updateConfidence("test", "down");
      expect(score).toBe(0.45);
    });

    it("should not exceed 1.0", () => {
      for (let i = 0; i < 20; i++) {
        learning.updateConfidence("max_test", "up");
      }
      expect(learning.getConfidence("max_test")).toBe(1.0);
    });

    it("should not go below 0.0", () => {
      for (let i = 0; i < 20; i++) {
        learning.updateConfidence("min_test", "down");
      }
      expect(learning.getConfidence("min_test")).toBe(0.0);
    });
  });

  describe("getInsights", () => {
    it("should retrieve insights for a specific strategy", async () => {
      memory.remember(
        "learning_insights",
        JSON.stringify({
          strategy: "onchain",
          pattern: "test pattern",
          recommendation: "test rec",
          confidence: 0.7,
        })
      );
      memory.remember(
        "learning_insights",
        JSON.stringify({
          strategy: "bounty",
          pattern: "other pattern",
          recommendation: "other rec",
          confidence: 0.6,
        })
      );

      const onchainInsights = learning.getInsights("onchain");
      expect(onchainInsights).toHaveLength(1);
      expect(onchainInsights[0].strategy).toBe("onchain");
    });

    it("should retrieve all insights when no strategy specified", async () => {
      memory.remember(
        "learning_insights",
        JSON.stringify({
          strategy: "onchain",
          pattern: "p1",
          recommendation: "r1",
          confidence: 0.7,
        })
      );
      memory.remember(
        "learning_insights",
        JSON.stringify({
          strategy: "bounty",
          pattern: "p2",
          recommendation: "r2",
          confidence: 0.6,
        })
      );

      const allInsights = learning.getInsights();
      expect(allInsights).toHaveLength(2);
    });

    it("should return empty array when no insights exist", () => {
      const insights = learning.getInsights("nonexistent");
      expect(insights).toEqual([]);
    });
  });

  describe("extractPatterns", () => {
    it("should find correlations between conditions and outcomes", () => {
      const decisions = [
        {
          id: "1",
          timestamp: Date.now(),
          strategy: "onchain",
          action: "swap",
          reasoning: "test",
          outcome: "success",
          reward: 0.5,
        },
        {
          id: "2",
          timestamp: Date.now(),
          strategy: "onchain",
          action: "swap",
          reasoning: "test",
          outcome: "failure",
          reward: -0.2,
        },
        {
          id: "3",
          timestamp: Date.now(),
          strategy: "bounty",
          action: "claim",
          reasoning: "test",
          outcome: "success",
          reward: 1.0,
        },
      ];

      const patterns = learning.extractPatterns(decisions);

      expect(patterns.get("onchain")).toEqual({
        successes: 1,
        failures: 1,
        avgReward: expect.closeTo(0.15, 1),
      });
      expect(patterns.get("bounty")).toEqual({
        successes: 1,
        failures: 0,
        avgReward: 1.0,
      });
    });

    it("should return empty map for empty decisions", () => {
      const patterns = learning.extractPatterns([]);
      expect(patterns.size).toBe(0);
    });
  });
});
