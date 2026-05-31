import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemorySystem } from "../../src/core/memory.js";
import type { StrategyResult, ExecutionResult, LLMResponse } from "../../src/types/index.js";
import { RiskLevel } from "../../src/types/index.js";

describe("Agent Loop Integration", () => {
  let memory: MemorySystem;

  beforeEach(() => {
    memory = new MemorySystem(":memory:");
  });

  afterEach(() => {
    memory.close();
  });

  it("should evaluate strategies and store results in memory", () => {
    // Simulate a strategy evaluation that finds an opportunity
    const mockResult: StrategyResult = {
      opportunity: "DEX arbitrage on SOL/USDC",
      confidence: 0.85,
      expectedReward: 0.5,
      risk: RiskLevel.MEDIUM,
    };

    // Record the decision in memory
    const decisionId = memory.recordDecision({
      strategy: "onchain",
      action: "evaluate",
      reasoning: `Found opportunity: ${mockResult.opportunity} with confidence ${mockResult.confidence}`,
    });

    expect(decisionId).toBeTruthy();

    // Verify the decision was stored
    const decisions = memory.getRecentDecisions(10);
    expect(decisions.length).toBe(1);
    expect(decisions[0].strategy).toBe("onchain");
    expect(decisions[0].reasoning).toContain("DEX arbitrage");
  });

  it("should track strategy performance across multiple evaluations", () => {
    // Simulate multiple strategy evaluations
    const strategies = ["onchain", "airdrop", "bounty"];

    for (const strategy of strategies) {
      const id = memory.recordDecision({
        strategy,
        action: "evaluate",
        reasoning: `Evaluating ${strategy} strategy`,
      });
      // Simulate outcome
      const reward = strategy === "onchain" ? 1.5 : strategy === "airdrop" ? 0.3 : 0;
      memory.recordOutcome(id, reward > 0 ? "success" : "failure", reward);
    }

    // Check performance tracking
    const onchainPerf = memory.getStrategyPerformance("onchain");
    expect(onchainPerf.totalActions).toBe(1);
    expect(onchainPerf.successRate).toBe(1);
    expect(onchainPerf.totalReward).toBe(1.5);

    const bountyPerf = memory.getStrategyPerformance("bounty");
    expect(bountyPerf.totalActions).toBe(1);
    expect(bountyPerf.successRate).toBe(0);
    expect(bountyPerf.totalReward).toBe(0);
  });

  it("should complete a full evaluate-execute-record cycle", () => {
    // Step 1: Strategy evaluates and finds opportunity
    const opportunity: StrategyResult = {
      opportunity: "Content creation bounty on GitHub",
      confidence: 0.9,
      expectedReward: 2.0,
      risk: RiskLevel.LOW,
    };

    // Step 2: Record evaluation decision
    const evalId = memory.recordDecision({
      strategy: "content",
      action: "evaluate",
      reasoning: `Found: ${opportunity.opportunity}`,
    });
    memory.recordOutcome(evalId, "opportunity_found", 0);

    // Step 3: Execute and record execution
    const execResult: ExecutionResult = {
      success: true,
      profitLoss: 1.8,
      notes: "Completed bounty submission",
    };

    const execId = memory.recordDecision({
      strategy: "content",
      action: "execute",
      reasoning: `Executing opportunity: ${opportunity.opportunity}`,
    });
    memory.recordOutcome(execId, "success", execResult.profitLoss);

    // Step 4: Store observation about the result
    memory.remember("execution", `Strategy content earned ${execResult.profitLoss} SOL from bounty`);

    // Verify full cycle
    const allDecisions = memory.getRecentDecisions(50);
    expect(allDecisions.length).toBe(2);

    const observations = memory.recall("execution", 10);
    expect(observations.length).toBe(1);
    expect(observations[0].content).toContain("1.8 SOL");

    const perf = memory.getStrategyPerformance("content");
    expect(perf.totalReward).toBe(1.8);
  });

  it("should handle mock LLM integration for strategy reasoning", async () => {
    const mockLLM = vi.fn<[], Promise<LLMResponse>>().mockResolvedValue({
      content: "Based on current market conditions, the SOL/USDC pair shows a 2% arbitrage opportunity.",
      model: "test-model",
      tokensUsed: 50,
    });

    // Simulate asking LLM for strategy reasoning
    const response = await mockLLM();

    // Record the LLM-assisted decision
    const id = memory.recordDecision({
      strategy: "onchain",
      action: "llm-analysis",
      reasoning: response.content,
    });
    memory.recordOutcome(id, "success", 0.02);

    expect(mockLLM).toHaveBeenCalledTimes(1);

    const decisions = memory.getRecentDecisions(10);
    expect(decisions[0].reasoning).toContain("arbitrage opportunity");
  });
});
