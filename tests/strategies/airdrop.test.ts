import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AirdropStrategy } from "../../src/strategies/airdrop.js";
import type { StrategyDependencies } from "../../src/strategies/base.js";
import { RiskLevel } from "../../src/types/index.js";
import { MemorySystem } from "../../src/core/memory.js";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

describe("AirdropStrategy", () => {
  let strategy: AirdropStrategy;
  let memory: MemorySystem;
  let mockLLM: ReturnType<typeof vi.fn>;
  let mockWallet: {
    getBalance: ReturnType<typeof vi.fn>;
    publicKey: { toBase58: () => string };
  };

  beforeEach(() => {
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
    });

    it("should limit exposure to max fraction of balance", async () => {
      mockWallet.getBalance.mockResolvedValue(2.0);

      const result = await strategy.execute({
        opportunity: "Interact with jupiter (Jupiter - DEX aggregator) for potential airdrop eligibility",
        confidence: 0.6,
        expectedReward: 0,
        risk: RiskLevel.LOW,
      });

      expect(result.success).toBe(true);
      // With 2.0 SOL balance and 5% max exposure, max amount is 0.1 SOL
      expect(result.notes).toContain("0.1");
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
  });
});
