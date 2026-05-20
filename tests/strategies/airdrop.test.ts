import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AirdropStrategy } from "../../src/strategies/airdrop.js";
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
  executeSwap: vi.fn(),
  signAndSendSwap: vi.fn(),
}));

import { getQuote, executeSwap, signAndSendSwap } from "../../src/integrations/jupiter.js";

const mockGetQuote = vi.mocked(getQuote);
const mockExecuteSwap = vi.mocked(executeSwap);
const mockSignAndSendSwap = vi.mocked(signAndSendSwap);

describe("AirdropStrategy", () => {
  let strategy: AirdropStrategy;
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
      content: "I recommend interacting with marinade as it has strong airdrop potential.",
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

    strategy = new AirdropStrategy(deps);
  });

  afterEach(() => {
    memory.close();
  });

  describe("properties", () => {
    it("should have correct name", () => {
      expect(strategy.name).toBe("airdrop");
    });

    it("should have LOW risk level", () => {
      expect(strategy.riskLevel).toBe(RiskLevel.LOW);
    });

    it("should enforce max 5% exposure per interaction", () => {
      expect(strategy.getMaxExposure()).toBe(0.05);
    });
  });

  describe("protocol interaction tracking", () => {
    it("should list all protocols as due when no interactions recorded", async () => {
      const due = await strategy.getProtocolsDueForInteraction();
      expect(due.length).toBeGreaterThan(0);
    });

    it("should skip recently interacted protocols", async () => {
      // Record a recent interaction with marinade
      memory.remember(
        "airdrop_interaction",
        JSON.stringify({
          protocol: "marinade",
          type: "stake",
          amount: 0.05,
          timestamp: Date.now(), // Just now - within cooldown
        })
      );

      const due = await strategy.getProtocolsDueForInteraction();
      const names = due.map((p) => p.name);
      expect(names).not.toContain("marinade");
    });

    it("should include protocols past their cooldown period", async () => {
      // Record an old interaction (beyond 24h cooldown)
      memory.remember(
        "airdrop_interaction",
        JSON.stringify({
          protocol: "marinade",
          type: "stake",
          amount: 0.05,
          timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        })
      );

      const due = await strategy.getProtocolsDueForInteraction();
      const names = due.map((p) => p.name);
      expect(names).toContain("marinade");
    });
  });

  describe("evaluate", () => {
    it("should return null when balance is too low", async () => {
      mockWallet.getBalance.mockResolvedValue(0.01); // Below 0.05 minBalance

      const result = await strategy.evaluate();
      expect(result).toBeNull();
    });

    it("should return opportunity when protocols are due", async () => {
      const result = await strategy.evaluate();
      expect(result).not.toBeNull();
      expect(result!.risk).toBe(RiskLevel.LOW);
      expect(result!.opportunity).toContain("airdrop eligibility");
    });

    it("should return null when all protocols recently interacted", async () => {
      // Record recent interactions for all default protocols
      const defaultProtocols = [
        "marinade", "jito", "jupiter", "tensor",
        "drift", "marginfi", "kamino", "raydium",
      ];

      for (const protocol of defaultProtocols) {
        memory.remember(
          "airdrop_interaction",
          JSON.stringify({
            protocol,
            type: "swap",
            amount: 0.05,
            timestamp: Date.now(),
          })
        );
      }

      const result = await strategy.evaluate();
      expect(result).toBeNull();
    });
  });

  describe("execute", () => {
    beforeEach(() => {
      mockGetQuote.mockResolvedValue({
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        inAmount: "1000000",
        outAmount: "150000",
        otherAmountThreshold: "148500",
        swapMode: "ExactIn",
        slippageBps: 100,
        routePlan: [],
      });

      mockExecuteSwap.mockResolvedValue({
        swapTransaction: "base64encodedtx",
        lastValidBlockHeight: 99999,
      });

      mockSignAndSendSwap.mockResolvedValue(
        "5FakeSignature123456789012345678901234567890123456789012345678901234"
      );
    });

    it("should record interaction in memory", async () => {
      const result = await strategy.execute({
        opportunity: "Interact with marinade (Marinade Finance - liquid staking) for potential airdrop eligibility",
        confidence: 0.6,
        expectedReward: 0,
        risk: RiskLevel.LOW,
      });

      expect(result.success).toBe(true);

      // Check that interaction was recorded
      const interactions = memory.recall("airdrop_interaction", 10);
      expect(interactions.length).toBe(1);
      const data = JSON.parse(interactions[0].content);
      expect(data.protocol).toBe("marinade");
      expect(data.signature).toBeDefined();
    });

    it("should perform a Jupiter swap for on-chain activity", async () => {
      const result = await strategy.execute({
        opportunity: "Interact with jupiter (Jupiter - DEX aggregator) for potential airdrop eligibility",
        confidence: 0.6,
        expectedReward: 0,
        risk: RiskLevel.LOW,
      });

      expect(result.success).toBe(true);
      expect(result.txHash).toBeDefined();
      expect(mockGetQuote).toHaveBeenCalled();
      expect(mockExecuteSwap).toHaveBeenCalled();
      expect(mockSignAndSendSwap).toHaveBeenCalled();
    });

    it("should return failure when protocol cannot be identified", async () => {
      const result = await strategy.execute({
        opportunity: "Interact with unknownprotocol for potential airdrop eligibility",
        confidence: 0.6,
        expectedReward: 0,
        risk: RiskLevel.LOW,
      });

      expect(result.success).toBe(false);
      expect(result.notes).toContain("Could not identify");
    });

    it("should return failure when balance is insufficient", async () => {
      mockWallet.getBalance.mockResolvedValue(0.001);

      const result = await strategy.execute({
        opportunity: "Interact with marinade (Marinade Finance - liquid staking) for potential airdrop eligibility",
        confidence: 0.6,
        expectedReward: 0,
        risk: RiskLevel.LOW,
      });

      expect(result.success).toBe(false);
      expect(result.notes).toContain("Insufficient balance");
    });
  });
});
