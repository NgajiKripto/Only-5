import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentController } from "../../src/core/agent.js";

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

describe("Agent Integration - New Modules", () => {
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

  describe("HealthMonitor integration", () => {
    it("should create health monitor and mark OK after start", async () => {
      await agent.start();

      const healthMonitor = agent.getHealthMonitor();
      expect(healthMonitor).toBeDefined();

      const agentHealth = healthMonitor.getStatus("agent");
      expect(agentHealth).toBeDefined();
      expect(agentHealth!.status).toBe("ok");
    });

    it("should mark scheduler as OK after start", async () => {
      await agent.start();

      const healthMonitor = agent.getHealthMonitor();
      const schedulerHealth = healthMonitor.getStatus("scheduler");
      expect(schedulerHealth).toBeDefined();
      expect(schedulerHealth!.status).toBe("ok");
    });

    it("should report healthy after successful start", async () => {
      await agent.start();

      const healthMonitor = agent.getHealthMonitor();
      expect(healthMonitor.isHealthy()).toBe(true);
    });
  });

  describe("ConnectivityMonitor integration", () => {
    it("should create connectivity monitor", async () => {
      await agent.start();

      const connectivityMonitor = agent.getConnectivityMonitor();
      expect(connectivityMonitor).toBeDefined();
    });

    it("should register connectivity-check scheduled task", async () => {
      await agent.start();

      const tasks = agent.getScheduler().listTasks();
      const taskNames = tasks.map((t) => t.name);
      expect(taskNames).toContain("connectivity-check");
    });
  });

  describe("SchedulerGate integration", () => {
    it("should block evaluation when connectivity is down", async () => {
      await agent.start();

      // Mock connectivity to report offline
      const connectivityMonitor = agent.getConnectivityMonitor();
      vi.spyOn(connectivityMonitor, "isOnline").mockReturnValue(false);

      // evaluateStrategies should return early without changing status
      await agent.evaluateStrategies();

      const state = await agent.getState();
      // Status should remain idle since gate blocked evaluation
      expect(state.status).toBe("idle");
    });
  });

  describe("SubconsciousEngine integration", () => {
    it("should create subconscious engine after start", async () => {
      await agent.start();

      const subconscious = agent.getSubconscious();
      expect(subconscious).toBeDefined();
    });

    it("should register subconscious-tick scheduled task", async () => {
      await agent.start();

      const tasks = agent.getScheduler().listTasks();
      const taskNames = tasks.map((t) => t.name);
      expect(taskNames).toContain("subconscious-tick");
    });
  });
});
