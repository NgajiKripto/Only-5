import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentController } from "../../src/core/agent.js";
import { RiskLevel, type Strategy, type StrategyResult, type ExecutionResult } from "../../src/types/index.js";

// Mock external services
vi.mock("../../src/integrations/openrouter.js", () => ({
  chat: vi.fn().mockResolvedValue({
    content: "0",
    model: "test-model",
    tokensUsed: 10,
  }),
  OpenRouterError: class extends Error {
    constructor(msg: string) {
      super(msg);
    }
  },
}));

vi.mock("@solana/web3.js", () => {
  const mockPublicKey = {
    toBase58: () => "TestWallet11111111111111111111111111111111111",
    toString: () => "TestWallet11111111111111111111111111111111111",
  };

  return {
    Connection: vi.fn().mockImplementation(() => ({
      getBalance: vi.fn().mockResolvedValue(5_000_000_000),
      getParsedTokenAccountsByOwner: vi.fn().mockResolvedValue({ value: [] }),
      getSignatureStatus: vi.fn().mockResolvedValue({ value: { confirmationStatus: "confirmed" } }),
    })),
    Keypair: {
      fromSecretKey: vi.fn().mockReturnValue({
        publicKey: mockPublicKey,
        secretKey: new Uint8Array(64),
      }),
    },
    PublicKey: vi.fn().mockImplementation((key) => ({
      toBase58: () => key ?? "mockPubkey",
      toString: () => key ?? "mockPubkey",
    })),
    LAMPORTS_PER_SOL: 1_000_000_000,
    SystemProgram: { transfer: vi.fn() },
    Transaction: vi.fn().mockImplementation(() => ({
      add: vi.fn().mockReturnThis(),
      sign: vi.fn(),
    })),
    sendAndConfirmTransaction: vi.fn().mockResolvedValue("mockSignature"),
  };
});

vi.mock("bs58", () => ({
  default: {
    decode: vi.fn().mockReturnValue(new Uint8Array(64)),
  },
}));

class MockStrategy implements Strategy {
  name: string;
  description = "Mock strategy for testing";
  enabled = true;
  riskLevel = RiskLevel.LOW;
  evaluateResult: StrategyResult | null = null;
  executeResult: ExecutionResult = { success: true, profitLoss: 0.1 };

  constructor(name: string) {
    this.name = name;
  }

  async evaluate(): Promise<StrategyResult | null> {
    return this.evaluateResult;
  }

  async execute(_opportunity: StrategyResult): Promise<ExecutionResult> {
    return this.executeResult;
  }

  getStatus(): string {
    return JSON.stringify({ name: this.name, enabled: this.enabled });
  }
}

describe("AgentController Integration", () => {
  let agent: AgentController;

  beforeEach(() => {
    agent = new AgentController({
      riskLimits: { cooldownAfterLoss: 0 },
    });
  });

  afterEach(async () => {
    try {
      await agent.stop();
    } catch {
      // Already stopped
    }
  });

  describe("startup sequence", () => {
    it("should initialize all components in order", async () => {
      const events: string[] = [];
      agent.on("started", () => events.push("started"));

      await agent.start();

      expect(events).toContain("started");
      expect(agent.getRiskManager()).toBeDefined();
      expect(agent.getLearningSystem()).toBeDefined();
      expect(agent.getScheduler()).toBeDefined();
      expect(agent.getMemory()).toBeDefined();
      expect(agent.getWallet()).toBeDefined();
    });

    it("should register scheduled tasks on start", async () => {
      await agent.start();

      const tasks = agent.getScheduler().listTasks();
      const taskNames = tasks.map((t) => t.name);

      expect(taskNames).toContain("evaluate-strategies");
      expect(taskNames).toContain("learning-cycle");
      expect(taskNames).toContain("daily-reset");
      expect(taskNames).toContain("balance-check");
      expect(taskNames).toContain("health-monitor");
    });
  });

  describe("shutdown sequence", () => {
    it("should perform graceful cleanup", async () => {
      const events: string[] = [];
      agent.on("stopped", () => events.push("stopped"));

      await agent.start();
      await agent.stop();

      expect(events).toContain("stopped");
    });

    it("should disable all strategies on shutdown", async () => {
      const strategy = new MockStrategy("test_mock");
      agent.registerStrategy(strategy);

      await agent.start();
      expect(strategy.enabled).toBe(true);

      await agent.stop();
      expect(strategy.enabled).toBe(false);
    });
  });

  describe("strategy registration", () => {
    it("should register and track strategies", async () => {
      const s1 = new MockStrategy("strategy_a");
      const s2 = new MockStrategy("strategy_b");

      agent.registerStrategy(s1);
      agent.registerStrategy(s2);

      await agent.start();
      const state = await agent.getState();

      expect(state.activeStrategies).toContain("strategy_a");
      expect(state.activeStrategies).toContain("strategy_b");
    });

    it("should handle enable/disable of strategies", async () => {
      const strategy = new MockStrategy("toggle_test");
      agent.registerStrategy(strategy);

      await agent.start();

      strategy.enabled = false;
      const state = await agent.getState();
      expect(state.activeStrategies).not.toContain("toggle_test");

      strategy.enabled = true;
      const state2 = await agent.getState();
      expect(state2.activeStrategies).toContain("toggle_test");
    });

    it("should remove strategies", async () => {
      const strategy = new MockStrategy("removable");
      agent.registerStrategy(strategy);

      await agent.start();
      let state = await agent.getState();
      expect(state.activeStrategies).toContain("removable");

      agent.removeStrategy("removable");
      state = await agent.getState();
      expect(state.activeStrategies).not.toContain("removable");
    });
  });

  describe("risk management integration", () => {
    it("should block trades when risk limits exceeded", async () => {
      await agent.start();

      const riskManager = agent.getRiskManager();

      // Record losses to trigger daily limit
      riskManager.recordTrade(0.3, -0.5);
      riskManager.recordTrade(0.3, -0.6);

      // Trade should be blocked
      const check = riskManager.canTrade(0.1);
      expect(check.allowed).toBe(false);
    });

    it("should emit alert when trade is blocked by risk manager", async () => {
      const alerts: Array<{ type: string }> = [];
      agent.on("alert", (data) => alerts.push(data));

      await agent.start();

      // Set up a strategy with high confidence that triggers
      const strategy = new MockStrategy("risky_strat");
      strategy.evaluateResult = {
        opportunity: "big trade",
        confidence: 0.9,
        expectedReward: 100, // Way over risk limits
        risk: RiskLevel.HIGH,
      };
      agent.registerStrategy(strategy);

      // Manually trigger evaluation
      await agent.evaluateStrategies();

      // Should have been blocked by risk manager
      const riskAlert = alerts.find((a) => a.type === "risk_blocked");
      expect(riskAlert).toBeDefined();
    });
  });

  describe("agent state", () => {
    it("should report correct state after startup", async () => {
      await agent.start();

      const state = await agent.getState();
      expect(state.status).toBe("idle");
      expect(state.uptime).toBeGreaterThan(0);
      expect(state.activeStrategies).toEqual([]);
    });

    it("should track uptime", async () => {
      await agent.start();

      // Small delay
      await new Promise((r) => setTimeout(r, 50));

      const state = await agent.getState();
      expect(state.uptime).toBeGreaterThanOrEqual(50);
    });
  });
});
