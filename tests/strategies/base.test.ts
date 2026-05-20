import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BaseStrategy, type StrategyDependencies } from "../../src/strategies/base.js";
import { RiskLevel, type StrategyResult, type ExecutionResult } from "../../src/types/index.js";
import { MemorySystem } from "../../src/core/memory.js";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

// Concrete implementation for testing
class TestStrategy extends BaseStrategy {
  name = "test_strategy";
  description = "A test strategy for unit testing";
  riskLevel = RiskLevel.LOW;
  minBalance = 0.01;

  evaluateResult: StrategyResult | null = null;
  executeResult: ExecutionResult = { success: true, profitLoss: 0.1 };

  async evaluate(): Promise<StrategyResult | null> {
    return this.evaluateResult;
  }

  async execute(_opportunity: StrategyResult): Promise<ExecutionResult> {
    return this.executeResult;
  }

  // Expose protected method for testing
  async testAskLLM(prompt: string) {
    return this.askLLM(prompt);
  }
}

describe("BaseStrategy", () => {
  let strategy: TestStrategy;
  let memory: MemorySystem;
  let mockLLM: ReturnType<typeof vi.fn>;
  let mockWallet: { getBalance: ReturnType<typeof vi.fn>; publicKey: { toBase58: () => string } };

  beforeEach(() => {
    const dir = join(tmpdir(), "only5-test-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "test.db");
    memory = new MemorySystem(dbPath);

    mockLLM = vi.fn().mockResolvedValue({
      content: "test response",
      model: "test-model",
      tokensUsed: 10,
    });

    mockWallet = {
      getBalance: vi.fn().mockResolvedValue(1.5),
      publicKey: { toBase58: () => "TestPublicKey123" },
    };

    const deps: StrategyDependencies = {
      llm: mockLLM as unknown as StrategyDependencies["llm"],
      memory,
      wallet: mockWallet as unknown as StrategyDependencies["wallet"],
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as StrategyDependencies["logger"],
    };

    strategy = new TestStrategy(deps);
  });

  afterEach(() => {
    memory.close();
  });

  describe("enable/disable", () => {
    it("should be enabled by default", () => {
      expect(strategy.enabled).toBe(true);
    });

    it("should disable the strategy", () => {
      strategy.disable();
      expect(strategy.enabled).toBe(false);
    });

    it("should enable the strategy after disabling", () => {
      strategy.disable();
      expect(strategy.enabled).toBe(false);
      strategy.enable();
      expect(strategy.enabled).toBe(true);
    });
  });

  describe("getStatus", () => {
    it("should return correct status shape", () => {
      const status = strategy.getStatus();
      const parsed = JSON.parse(status);

      expect(parsed).toHaveProperty("name", "test_strategy");
      expect(parsed).toHaveProperty("enabled", true);
      expect(parsed).toHaveProperty("riskLevel", "LOW");
      expect(parsed).toHaveProperty("totalActions");
      expect(parsed).toHaveProperty("successRate");
      expect(parsed).toHaveProperty("totalReward");
    });

    it("should reflect disabled state in status", () => {
      strategy.disable();
      const status = strategy.getStatus();
      const parsed = JSON.parse(status);
      expect(parsed.enabled).toBe(false);
    });

    it("should include performance data from memory", () => {
      // Record some decisions for this strategy
      const id = memory.recordDecision({
        strategy: "test_strategy",
        action: "test action",
        reasoning: "test reason",
      });
      memory.recordOutcome(id, "success", 0.5);

      const status = strategy.getStatus();
      const parsed = JSON.parse(status);
      expect(parsed.totalActions).toBe(1);
      expect(parsed.successRate).toBe(1);
      expect(parsed.totalReward).toBe(0.5);
    });
  });

  describe("getPerformance", () => {
    it("should delegate to memory.getStrategyPerformance", () => {
      const perf = strategy.getPerformance();
      expect(perf).toEqual({
        totalActions: 0,
        successRate: 0,
        totalReward: 0,
      });
    });

    it("should return updated performance after decisions", () => {
      const id1 = memory.recordDecision({
        strategy: "test_strategy",
        action: "action1",
        reasoning: "reason1",
      });
      memory.recordOutcome(id1, "success", 1.0);

      const id2 = memory.recordDecision({
        strategy: "test_strategy",
        action: "action2",
        reasoning: "reason2",
      });
      memory.recordOutcome(id2, "failure", -0.5);

      const perf = strategy.getPerformance();
      expect(perf.totalActions).toBe(2);
      expect(perf.successRate).toBe(0.5);
      expect(perf.totalReward).toBe(0.5);
    });
  });

  describe("askLLM", () => {
    it("should call LLM with strategy context", async () => {
      await strategy.testAskLLM("test prompt");

      expect(mockLLM).toHaveBeenCalledTimes(1);
      const call = mockLLM.mock.calls[0];
      const messages = call[0];

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("test_strategy");
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toBe("test prompt");
    });

    it("should return LLM response", async () => {
      const result = await strategy.testAskLLM("hello");
      expect(result.content).toBe("test response");
      expect(result.model).toBe("test-model");
    });
  });

  describe("properties", () => {
    it("should have correct name", () => {
      expect(strategy.name).toBe("test_strategy");
    });

    it("should have correct description", () => {
      expect(strategy.description).toBe("A test strategy for unit testing");
    });

    it("should have correct riskLevel", () => {
      expect(strategy.riskLevel).toBe(RiskLevel.LOW);
    });

    it("should have correct minBalance", () => {
      expect(strategy.minBalance).toBe(0.01);
    });
  });
});
