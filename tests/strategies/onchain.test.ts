import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OnchainStrategy } from "../../src/strategies/onchain.js";
import type { StrategyDependencies } from "../../src/strategies/base.js";
import { RiskLevel } from "../../src/types/index.js";
import { MemorySystem } from "../../src/core/memory.js";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

// Mock Jupiter module
vi.mock("../../src/integrations/jupiter.js", () => ({
  getQuote: vi.fn(),
  getTokenPrice: vi.fn(),
  executeSwap: vi.fn(),
  signAndSendSwap: vi.fn(),
}));

import { getQuote, executeSwap, signAndSendSwap } from "../../src/integrations/jupiter.js";

const mockGetQuote = vi.mocked(getQuote);
const mockExecuteSwap = vi.mocked(executeSwap);
const mockSignAndSendSwap = vi.mocked(signAndSendSwap);

describe("OnchainStrategy", () => {
  let strategy: OnchainStrategy;
  let memory: MemorySystem;
  let mockLLM: ReturnType<typeof vi.fn>;
  let mockWallet: {
    getBalance: ReturnType<typeof vi.fn>;
    publicKey: { toBase58: () => string };
    getKeypair: ReturnType<typeof vi.fn>;
    getConnection: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    const dir = join(tmpdir(), "only5-test-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "test.db");
    memory = new MemorySystem(dbPath);

    mockLLM = vi.fn().mockResolvedValue({
      content: "Proceed with the trade, conditions look favorable.",
      model: "test-model",
      tokensUsed: 10,
    });

    mockWallet = {
      getBalance: vi.fn().mockResolvedValue(1.0),
      publicKey: { toBase58: () => "TestPublicKey123" },
      getKeypair: vi.fn().mockReturnValue({}),
      getConnection: vi.fn().mockReturnValue({}),
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

    strategy = new OnchainStrategy(deps);
  });

  afterEach(() => {
    memory.close();
  });

  describe("properties", () => {
    it("should have correct name", () => {
      expect(strategy.name).toBe("onchain");
    });

    it("should have MEDIUM risk level", () => {
      expect(strategy.riskLevel).toBe(RiskLevel.MEDIUM);
    });

    it("should have minimum balance of 0.1", () => {
      expect(strategy.minBalance).toBe(0.1);
    });
  });

  describe("profit calculation", () => {
    it("should calculate positive profit correctly", () => {
      const profit = strategy.calculateProfit(1000000, 1010000);
      expect(profit).toBeCloseTo(0.01); // 1% profit
    });

    it("should calculate negative profit correctly", () => {
      const profit = strategy.calculateProfit(1000000, 990000);
      expect(profit).toBeCloseTo(-0.01); // -1% loss
    });

    it("should return 0 for no change", () => {
      const profit = strategy.calculateProfit(1000000, 1000000);
      expect(profit).toBe(0);
    });
  });

  describe("evaluate", () => {
    it("should return null when balance is too low", async () => {
      mockWallet.getBalance.mockResolvedValue(0.05); // Below minBalance of 0.1

      const result = await strategy.evaluate();
      expect(result).toBeNull();
    });

    it("should return null when no arbitrage opportunity exists", async () => {
      // Forward: 100000000 (0.1 SOL) -> 15000000 USDC
      mockGetQuote.mockResolvedValueOnce({
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        inAmount: "100000000",
        outAmount: "15000000",
        otherAmountThreshold: "14900000",
        swapMode: "ExactIn",
        slippageBps: 50,
        routePlan: [],
      });

      // Reverse: 15000000 USDC -> 99000000 (less than we started with - no profit)
      mockGetQuote.mockResolvedValueOnce({
        inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        outputMint: "So11111111111111111111111111111111111111112",
        inAmount: "15000000",
        outAmount: "99000000",
        otherAmountThreshold: "98500000",
        swapMode: "ExactIn",
        slippageBps: 50,
        routePlan: [],
      });

      // For subsequent pairs that also show no profit
      mockGetQuote.mockResolvedValue({
        inputMint: "mock",
        outputMint: "mock",
        inAmount: "100000000",
        outAmount: "99000000",
        otherAmountThreshold: "98500000",
        swapMode: "ExactIn",
        slippageBps: 50,
        routePlan: [],
      });

      const result = await strategy.evaluate();
      expect(result).toBeNull();
    });

    it("should return opportunity when profit exceeds threshold", async () => {
      // Forward: 100000000 -> 15000000
      mockGetQuote.mockResolvedValueOnce({
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        inAmount: "100000000",
        outAmount: "15000000",
        otherAmountThreshold: "14900000",
        swapMode: "ExactIn",
        slippageBps: 50,
        routePlan: [],
      });

      // Reverse: 15000000 -> 101000000 (1% profit)
      mockGetQuote.mockResolvedValueOnce({
        inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        outputMint: "So11111111111111111111111111111111111111112",
        inAmount: "15000000",
        outAmount: "101000000",
        otherAmountThreshold: "100500000",
        swapMode: "ExactIn",
        slippageBps: 50,
        routePlan: [],
      });

      const result = await strategy.evaluate();
      expect(result).not.toBeNull();
      expect(result!.opportunity).toContain("SOL/USDC");
      expect(result!.risk).toBe(RiskLevel.MEDIUM);
      expect(result!.confidence).toBeGreaterThan(0.5);
    });
  });

  describe("execute", () => {
    it("should not execute when balance is too low", async () => {
      mockWallet.getBalance.mockResolvedValue(0.05);

      const result = await strategy.execute({
        opportunity: "Arbitrage on SOL/USDC: 1% profit",
        confidence: 0.8,
        expectedReward: 0.01,
        risk: RiskLevel.MEDIUM,
      });

      expect(result.success).toBe(false);
      expect(result.notes).toContain("Insufficient balance");
    });

    it("should not execute when LLM advises against", async () => {
      mockLLM.mockResolvedValueOnce({
        content: "Do not execute this trade - the market is too volatile",
        model: "test-model",
        tokensUsed: 10,
      });

      const result = await strategy.execute({
        opportunity: "Arbitrage on SOL/USDC: 1% profit",
        confidence: 0.8,
        expectedReward: 0.01,
        risk: RiskLevel.MEDIUM,
      });

      expect(result.success).toBe(false);
      expect(result.notes).toContain("LLM advised against");
    });

    it("should execute trade when conditions are met", async () => {
      mockGetQuote.mockResolvedValueOnce({
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        inAmount: "100000000",
        outAmount: "15000000",
        otherAmountThreshold: "14900000",
        swapMode: "ExactIn",
        slippageBps: 50,
        routePlan: [],
      });

      mockExecuteSwap.mockResolvedValueOnce({
        swapTransaction: "abc123def456789012345678901234567890123456789012345678901234567890",
        lastValidBlockHeight: 12345,
      });

      mockSignAndSendSwap.mockResolvedValueOnce(
        "5wHu1qwD7q3f7YFzxmLk8TkvZabKoxh3r2mEpYfXgm9kDfLqfwA6G7PXYB8nReqs6NXCFr8Wnz7aJhSvJkrM8Ri"
      );

      // First call is pre-trade balance, second call is post-trade balance
      mockWallet.getBalance
        .mockResolvedValueOnce(1.0)
        .mockResolvedValueOnce(1.01);

      const result = await strategy.execute({
        opportunity: "Arbitrage on SOL/USDC: 1% profit via route inefficiency",
        confidence: 0.8,
        expectedReward: 0.01,
        risk: RiskLevel.MEDIUM,
      });

      expect(result.success).toBe(true);
      expect(result.txHash).toBe("5wHu1qwD7q3f7YFzxmLk8TkvZabKoxh3r2mEpYfXgm9kDfLqfwA6G7PXYB8nReqs6NXCFr8Wnz7aJhSvJkrM8Ri");
      expect(result.profitLoss).toBeCloseTo(0.01);
      expect(mockSignAndSendSwap).toHaveBeenCalledTimes(1);
    });

    it("should return failure when pair cannot be identified", async () => {
      const result = await strategy.execute({
        opportunity: "Arbitrage on UNKNOWN/PAIR: 1% profit",
        confidence: 0.8,
        expectedReward: 0.01,
        risk: RiskLevel.MEDIUM,
      });

      expect(result.success).toBe(false);
      expect(result.notes).toContain("Could not identify");
    });
  });
});
