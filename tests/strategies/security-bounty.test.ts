import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SecurityBountyStrategy } from "../../src/strategies/security-bounty.js";
import type { StrategyDependencies } from "../../src/strategies/base.js";
import { RiskLevel } from "../../src/types/index.js";
import { MemorySystem } from "../../src/core/memory.js";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

describe("SecurityBountyStrategy", () => {
  let strategy: SecurityBountyStrategy;
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
      content: "0",
      model: "test-model",
      tokensUsed: 10,
    });

    mockWallet = {
      getBalance: vi.fn().mockResolvedValue(1.0),
      publicKey: { toBase58: () => "TestKey123" },
    };

    mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
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

    strategy = new SecurityBountyStrategy(deps);
  });

  afterEach(() => {
    memory.close();
    vi.unstubAllGlobals();
  });

  describe("properties", () => {
    it("should have correct name", () => {
      expect(strategy.name).toBe("security-bounty");
    });

    it("should have correct risk level", () => {
      expect(strategy.riskLevel).toBe(RiskLevel.LOW);
    });

    it("should have minBalance of 0", () => {
      expect(strategy.minBalance).toBe(0);
    });
  });

  describe("evaluate", () => {
    it("should return null when no bounty programs are available", async () => {
      // All fetches fail by default (mockFetch rejects)
      const result = await strategy.evaluate();
      expect(result).toBeNull();
    });

    it("should return null due to rate limiting on subsequent calls", async () => {
      // First call
      await strategy.evaluate();
      // Second call within 5 minutes
      const result = await strategy.evaluate();
      expect(result).toBeNull();
    });

    it("should return StrategyResult when programs are found from HackerOne", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (
          typeof url === "string" &&
          url.includes("hackerone.com")
        ) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                results: [
                  {
                    name: "TestProgram",
                    url: "https://hackerone.com/testprogram",
                  },
                ],
              }),
          });
        }
        return Promise.reject(new Error("Network error"));
      });

      const result = await strategy.evaluate();
      expect(result).not.toBeNull();
      expect(result!.opportunity).toContain("TestProgram");
      expect(result!.opportunity).toContain("HackerOne");
      expect(result!.risk).toBe(RiskLevel.LOW);
      expect(result!.confidence).toBeGreaterThanOrEqual(0.6);
      expect(result!.confidence).toBeLessThanOrEqual(0.8);
    });

    it("should return StrategyResult when programs are found from Immunefi", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("immunefi.com")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  project: "DeFiProtocol",
                  maximum_reward: 50000,
                  url: "https://immunefi.com/bounty/defi",
                },
              ]),
          });
        }
        return Promise.reject(new Error("Network error"));
      });

      const result = await strategy.evaluate();
      expect(result).not.toBeNull();
      expect(result!.opportunity).toContain("DeFiProtocol");
      expect(result!.opportunity).toContain("Immunefi");
    });

    it("should return StrategyResult when programs are found from Code4rena", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("code4rena.com")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  title: "Audit Contest #42",
                  url: "https://code4rena.com/contests/42",
                  amount: 100000,
                },
              ]),
          });
        }
        return Promise.reject(new Error("Network error"));
      });

      const result = await strategy.evaluate();
      expect(result).not.toBeNull();
      expect(result!.opportunity).toContain("Audit Contest #42");
      expect(result!.opportunity).toContain("Code4rena");
    });
  });

  describe("execute", () => {
    it("should generate a vulnerability report", async () => {
      mockLLM.mockResolvedValue({
        content:
          "## Title: Missing Security Headers\n## Severity: Medium\n## Description: ...",
        model: "test-model",
        tokensUsed: 100,
      });

      // Mock fetch for header analysis and vulnerability detection
      mockFetch.mockResolvedValue({
        ok: true,
        status: 404,
        headers: new Headers({
          "content-security-policy": "default-src 'self'",
        }),
      });

      const opportunity = {
        opportunity:
          "Security bounty: TestProgram on HackerOne (https://hackerone.com/testprogram)",
        confidence: 0.7,
        expectedReward: 0,
        risk: RiskLevel.LOW,
      };

      const result = await strategy.execute(opportunity);
      expect(result.success).toBe(true);
      expect(result.notes).toContain("Generated vulnerability report");
      expect(result.notes).toContain("hackerone.com/testprogram");
    });

    it("should store the report in memory", async () => {
      mockLLM.mockResolvedValue({
        content: "Report content here",
        model: "test-model",
        tokensUsed: 50,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 404,
        headers: new Headers({}),
      });

      const opportunity = {
        opportunity:
          "Security bounty: TestProgram on HackerOne (https://hackerone.com/test)",
        confidence: 0.7,
        expectedReward: 0,
        risk: RiskLevel.LOW,
      };

      await strategy.execute(opportunity);

      // Verify memory was written
      const observations = memory.recall("security_bounty_submissions", 10);
      expect(observations.length).toBeGreaterThan(0);
      const securityObs = observations.find(
        (o) => o.category === "security_bounty_submissions"
      );
      expect(securityObs).toBeDefined();
      expect(securityObs!.content).toContain("hackerone.com/test");
    });

    it("should return failure on error", async () => {
      mockLLM.mockRejectedValue(new Error("LLM unavailable"));
      mockFetch.mockRejectedValue(new Error("Network failed"));

      const opportunity = {
        opportunity: "Security bounty: Bad target (https://example.com)",
        confidence: 0.7,
        expectedReward: 0,
        risk: RiskLevel.LOW,
      };

      const result = await strategy.execute(opportunity);
      expect(result.success).toBe(false);
      expect(result.notes).toContain("Failed to execute security bounty");
    });
  });
});
