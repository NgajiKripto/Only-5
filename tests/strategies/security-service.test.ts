import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SecurityServiceStrategy } from "../../src/strategies/security-service.js";
import type { StrategyDependencies } from "../../src/strategies/base.js";
import { RiskLevel } from "../../src/types/index.js";
import { MemorySystem } from "../../src/core/memory.js";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

describe("SecurityServiceStrategy", () => {
  let strategy: SecurityServiceStrategy;
  let memory: MemorySystem;
  let mockLLM: ReturnType<typeof vi.fn>;
  let mockWallet: {
    getBalance: ReturnType<typeof vi.fn>;
    publicKey: { toBase58: () => string };
  };
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const dir = join(tmpdir(), "only5-test-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "test.db");
    memory = new MemorySystem(dbPath);

    mockLLM = vi.fn().mockResolvedValue({
      content: "Professional scan report summary with recommendations.",
      model: "test-model",
      tokensUsed: 50,
    });

    mockWallet = {
      getBalance: vi.fn().mockResolvedValue(1.0),
      publicKey: { toBase58: () => "TestKey123" },
    };

    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 404,
      headers: new Headers({}),
    });
    vi.stubGlobal("fetch", mockFetch);

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

    strategy = new SecurityServiceStrategy(deps);
  });

  afterEach(() => {
    memory.close();
    vi.unstubAllGlobals();
  });

  describe("properties", () => {
    it("should have correct name", () => {
      expect(strategy.name).toBe("security-service");
    });

    it("should have correct risk level", () => {
      expect(strategy.riskLevel).toBe(RiskLevel.LOW);
    });

    it("should have minBalance of 0", () => {
      expect(strategy.minBalance).toBe(0);
    });

    it("should have default price per scan of 0.1", () => {
      expect(strategy.getPricePerScan()).toBe(0.1);
    });
  });

  describe("addScanRequest", () => {
    it("should add a scan request to the queue", () => {
      strategy.addScanRequest(123, "https://example.com", "url");
      const queue = strategy.getScanQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].chatId).toBe(123);
      expect(queue[0].target).toBe("https://example.com");
      expect(queue[0].type).toBe("url");
      expect(queue[0].requestedAt).toBeGreaterThan(0);
    });

    it("should add multiple requests to the queue", () => {
      strategy.addScanRequest(1, "https://a.com", "url");
      strategy.addScanRequest(2, "contract_source_code", "contract");
      expect(strategy.getScanQueue()).toHaveLength(2);
    });
  });

  describe("evaluate", () => {
    it("should return null with empty queue", async () => {
      const result = await strategy.evaluate();
      expect(result).toBeNull();
    });

    it("should return StrategyResult with pending scans", async () => {
      strategy.addScanRequest(42, "https://target.com", "url");

      const result = await strategy.evaluate();
      expect(result).not.toBeNull();
      expect(result!.confidence).toBe(0.9);
      expect(result!.expectedReward).toBe(0.1);
      expect(result!.risk).toBe(RiskLevel.LOW);
      expect(result!.opportunity).toContain("https://target.com");
      expect(result!.opportunity).toContain("url scan");
    });
  });

  describe("execute", () => {
    it("should return failure when queue is empty", async () => {
      const opportunity = {
        opportunity: "Security scan request: url scan of https://target.com",
        confidence: 0.9,
        expectedReward: 0.1,
        risk: RiskLevel.LOW,
      };

      const result = await strategy.execute(opportunity);
      expect(result.success).toBe(false);
      expect(result.notes).toContain("No scan request in queue");
    });

    it("should process a URL scan request", async () => {
      strategy.addScanRequest(42, "https://target.com", "url");

      const opportunity = {
        opportunity:
          "Security scan request: url scan of https://target.com (chat 42)",
        confidence: 0.9,
        expectedReward: 0.1,
        risk: RiskLevel.LOW,
      };

      const result = await strategy.execute(opportunity);
      expect(result.success).toBe(true);
      expect(result.profitLoss).toBe(0.1);
      expect(result.notes).toContain("Scan complete for https://target.com");
    });

    it("should process a contract scan request", async () => {
      strategy.addScanRequest(
        99,
        "use anchor_lang::prelude::*; pub fn transfer() {}",
        "contract"
      );

      mockLLM.mockResolvedValue({
        content: "[]",
        model: "test-model",
        tokensUsed: 50,
      });

      const opportunity = {
        opportunity: "Security scan request: contract scan",
        confidence: 0.9,
        expectedReward: 0.1,
        risk: RiskLevel.LOW,
      };

      const result = await strategy.execute(opportunity);
      expect(result.success).toBe(true);
      expect(result.profitLoss).toBe(0.1);
    });

    it("should store completed scans", async () => {
      strategy.addScanRequest(42, "https://target.com", "url");

      const opportunity = {
        opportunity:
          "Security scan request: url scan of https://target.com (chat 42)",
        confidence: 0.9,
        expectedReward: 0.1,
        risk: RiskLevel.LOW,
      };

      await strategy.execute(opportunity);

      const completed = strategy.getCompletedScans();
      expect(completed).toHaveLength(1);
      expect(completed[0].chatId).toBe(42);
      expect(completed[0].target).toBe("https://target.com");
      expect(completed[0].result).toBeDefined();
      expect(completed[0].completedAt).toBeGreaterThan(0);
    });

    it("should store scan results in memory", async () => {
      strategy.addScanRequest(42, "https://target.com", "url");

      const opportunity = {
        opportunity:
          "Security scan request: url scan of https://target.com (chat 42)",
        confidence: 0.9,
        expectedReward: 0.1,
        risk: RiskLevel.LOW,
      };

      await strategy.execute(opportunity);

      const observations = memory.recall("security_service_scans", 10);
      expect(observations.length).toBeGreaterThan(0);
      const scanObs = observations.find(
        (o) => o.category === "security_service_scans"
      );
      expect(scanObs).toBeDefined();
      expect(scanObs!.content).toContain("https://target.com");
    });

    it("should remove processed request from queue", async () => {
      strategy.addScanRequest(42, "https://target.com", "url");
      expect(strategy.getScanQueue()).toHaveLength(1);

      const opportunity = {
        opportunity: "Security scan request",
        confidence: 0.9,
        expectedReward: 0.1,
        risk: RiskLevel.LOW,
      };

      await strategy.execute(opportunity);
      expect(strategy.getScanQueue()).toHaveLength(0);
    });

    it("should handle scan errors gracefully", async () => {
      strategy.addScanRequest(42, "not-a-valid-url", "url");

      const opportunity = {
        opportunity: "Security scan request",
        confidence: 0.9,
        expectedReward: 0.1,
        risk: RiskLevel.LOW,
      };

      const result = await strategy.execute(opportunity);
      expect(result.success).toBe(false);
      expect(result.notes).toContain("Scan failed");
    });
  });

  describe("getCompletedScans", () => {
    it("should return empty array initially", () => {
      expect(strategy.getCompletedScans()).toEqual([]);
    });

    it("should respect the limit parameter", async () => {
      // Process multiple scans using contract type to avoid port scanning timeouts
      for (let i = 0; i < 3; i++) {
        strategy.addScanRequest(i, `contract_source_${i}`, "contract");
      }

      mockLLM.mockResolvedValue({
        content: "[]",
        model: "test-model",
        tokensUsed: 50,
      });

      for (let i = 0; i < 3; i++) {
        const opportunity = {
          opportunity: "scan",
          confidence: 0.9,
          expectedReward: 0.1,
          risk: RiskLevel.LOW,
        };
        await strategy.execute(opportunity);
      }

      const limited = strategy.getCompletedScans(2);
      expect(limited).toHaveLength(2);
    });
  });
});
