import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BaseStrategy, type StrategyDependencies } from "../../src/strategies/base.js";
import { MemorySystem } from "../../src/core/memory.js";
import type { StrategyResult, ExecutionResult, LLMMessage, LLMResponse, RouterOptions } from "../../src/types/index.js";
import { RiskLevel } from "../../src/types/index.js";
import { createLogger } from "../../src/core/logger.js";

// Concrete test strategy
class TestArbitrageStrategy extends BaseStrategy {
  name = "test-arbitrage";
  description = "Test arbitrage strategy for integration testing";
  riskLevel = RiskLevel.MEDIUM;
  minBalance = 0.1;

  async evaluate(): Promise<StrategyResult | null> {
    const response = await this.askLLM("Analyze SOL/USDC for arbitrage opportunities");

    if (response.content.includes("opportunity")) {
      return {
        opportunity: "SOL/USDC arbitrage detected",
        confidence: 0.85,
        expectedReward: 0.5,
        risk: RiskLevel.MEDIUM,
      };
    }

    return null;
  }

  async execute(opportunity: StrategyResult): Promise<ExecutionResult> {
    // Simulate checking wallet balance
    const balance = await this.wallet.getBalance();

    if (balance < this.minBalance) {
      return {
        success: false,
        profitLoss: 0,
        notes: "Insufficient balance",
      };
    }

    // Record the decision
    this.memory.recordDecision({
      strategy: this.name,
      action: "execute",
      reasoning: `Executing: ${opportunity.opportunity}`,
    });

    return {
      success: true,
      profitLoss: opportunity.expectedReward * 0.8,
      txHash: "mock-tx-hash-123",
      notes: "Arbitrage executed successfully",
    };
  }
}

describe("Strategy Execution Integration", () => {
  let memory: MemorySystem;
  let mockLLM: ReturnType<typeof vi.fn>;
  let mockWallet: { getBalance: ReturnType<typeof vi.fn>; getTokenBalances: ReturnType<typeof vi.fn>; publicKey: { toBase58: () => string } };
  let strategy: TestArbitrageStrategy;

  beforeEach(() => {
    memory = new MemorySystem(":memory:");

    mockLLM = vi.fn<[LLMMessage[], (RouterOptions | { temperature?: number; maxTokens?: number; model?: string })?], Promise<LLMResponse>>()
      .mockResolvedValue({
        content: "Analysis shows a 2% arbitrage opportunity on SOL/USDC pair.",
        model: "test-model-tier2",
        tokensUsed: 45,
      });

    mockWallet = {
      getBalance: vi.fn<[], Promise<number>>().mockResolvedValue(5.0),
      getTokenBalances: vi.fn().mockResolvedValue([]),
      publicKey: { toBase58: () => "mock-pubkey-123" },
    };

    const deps: StrategyDependencies = {
      llm: mockLLM,
      memory,
      wallet: mockWallet as unknown as StrategyDependencies["wallet"],
      logger: createLogger("test-strategy"),
    };

    strategy = new TestArbitrageStrategy(deps);
  });

  afterEach(() => {
    memory.close();
  });

  it("should evaluate and find an opportunity", async () => {
    const result = await strategy.evaluate();

    expect(result).not.toBeNull();
    expect(result!.opportunity).toBe("SOL/USDC arbitrage detected");
    expect(result!.confidence).toBe(0.85);
    expect(result!.risk).toBe(RiskLevel.MEDIUM);
    expect(mockLLM).toHaveBeenCalledTimes(1);
  });

  it("should return null when no opportunity is found", async () => {
    mockLLM.mockResolvedValueOnce({
      content: "No significant price differences detected.",
      model: "test-model-tier2",
      tokensUsed: 30,
    });

    const result = await strategy.evaluate();
    expect(result).toBeNull();
  });

  it("should execute a strategy successfully", async () => {
    const opportunity: StrategyResult = {
      opportunity: "SOL/USDC arbitrage detected",
      confidence: 0.85,
      expectedReward: 0.5,
      risk: RiskLevel.MEDIUM,
    };

    const result = await strategy.execute(opportunity);

    expect(result.success).toBe(true);
    expect(result.profitLoss).toBe(0.4); // 0.5 * 0.8
    expect(result.txHash).toBe("mock-tx-hash-123");
    expect(mockWallet.getBalance).toHaveBeenCalledTimes(1);
  });

  it("should fail execution with insufficient balance", async () => {
    mockWallet.getBalance.mockResolvedValueOnce(0.05); // Below minBalance

    const opportunity: StrategyResult = {
      opportunity: "SOL/USDC arbitrage detected",
      confidence: 0.85,
      expectedReward: 0.5,
      risk: RiskLevel.MEDIUM,
    };

    const result = await strategy.execute(opportunity);

    expect(result.success).toBe(false);
    expect(result.profitLoss).toBe(0);
    expect(result.notes).toBe("Insufficient balance");
  });

  it("should complete a full evaluate-then-execute cycle", async () => {
    // Evaluate
    const opportunity = await strategy.evaluate();
    expect(opportunity).not.toBeNull();

    // Execute
    const result = await strategy.execute(opportunity!);
    expect(result.success).toBe(true);
    expect(result.profitLoss).toBeGreaterThan(0);

    // Verify decision was recorded in memory
    const decisions = memory.getRecentDecisions(10);
    expect(decisions.length).toBe(1);
    expect(decisions[0].strategy).toBe("test-arbitrage");
    expect(decisions[0].action).toBe("execute");
  });

  it("should track strategy status and performance", async () => {
    // Run multiple cycles, tracking decision count to find new decisions
    for (let i = 0; i < 3; i++) {
      const prevDecisions = memory.getRecentDecisions(50);
      const prevCount = prevDecisions.length;

      const opp = await strategy.evaluate();
      if (opp) {
        const result = await strategy.execute(opp);
        const allDecisions = memory.getRecentDecisions(50);
        // Find the new decision (not present before)
        const newDecision = allDecisions.find(
          (d) => !prevDecisions.some((p) => p.id === d.id)
        );
        if (newDecision) {
          memory.recordOutcome(
            newDecision.id,
            result.success ? "success" : "failure",
            result.profitLoss
          );
        }
      }
    }

    const perf = memory.getStrategyPerformance("test-arbitrage");
    expect(perf.totalActions).toBe(3);
    expect(perf.successRate).toBe(1);
    expect(perf.totalReward).toBeGreaterThan(0);

    // Check status JSON
    const status = strategy.getStatus();
    const parsed = JSON.parse(status);
    expect(parsed.name).toBe("test-arbitrage");
    expect(parsed.enabled).toBe(true);
    expect(parsed.riskLevel).toBe(RiskLevel.MEDIUM);
  });

  it("should support enable/disable toggling", () => {
    expect(strategy.enabled).toBe(true);

    strategy.disable();
    expect(strategy.enabled).toBe(false);

    strategy.enable();
    expect(strategy.enabled).toBe(true);
  });
});
