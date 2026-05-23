import { describe, it, expect, beforeEach, vi } from "vitest";
import { SubconsciousEngine } from "../../src/core/subconscious.js";
import type { HealthMonitor } from "../../src/core/health-monitor.js";
import type { MemorySystem } from "../../src/core/memory.js";
import type { LLMMessage, LLMResponse } from "../../src/types/index.js";

// Mock config
vi.mock("../../src/config.js", () => ({
  config: {
    OPENROUTER_API_KEY: "test-key",
    SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com",
    SOLANA_PRIVATE_KEY: "test-key",
    TELEGRAM_BOT_TOKEN: "test-token",
    DB_PATH: ":memory:",
    AGENT_NAME: "Test-Agent",
    LOG_LEVEL: "error",
  },
}));

function createMockMemory(): MemorySystem {
  return {
    getRecentDecisions: vi.fn().mockReturnValue([]),
    recall: vi.fn().mockReturnValue([]),
  } as unknown as MemorySystem;
}

function createMockHealthMonitor(): HealthMonitor {
  return {
    getSnapshot: vi.fn().mockReturnValue({
      pid: 1,
      uptimeMs: 1000,
      updatedAt: Date.now(),
      components: {},
    }),
    getUnhealthyComponents: vi.fn().mockReturnValue([]),
    markOk: vi.fn(),
    markError: vi.fn(),
    isHealthy: vi.fn().mockReturnValue(true),
  } as unknown as HealthMonitor;
}

function createMockLLM(): (messages: LLMMessage[], options?: { temperature?: number; maxTokens?: number }) => Promise<LLMResponse> {
  return vi.fn().mockResolvedValue({
    content: "none",
    model: "test-model",
    tokensUsed: 10,
  });
}

describe("SubconsciousEngine", () => {
  let engine: SubconsciousEngine;
  let mockMemory: MemorySystem;
  let mockHealthMonitor: HealthMonitor;
  let mockLLM: ReturnType<typeof createMockLLM>;

  beforeEach(() => {
    mockMemory = createMockMemory();
    mockHealthMonitor = createMockHealthMonitor();
    mockLLM = createMockLLM();
    engine = new SubconsciousEngine({
      memory: mockMemory,
      llm: mockLLM,
      healthMonitor: mockHealthMonitor,
    });
  });

  describe("registerTask", () => {
    it("should register a custom task and return its ID", () => {
      const id = engine.registerTask({
        name: "test-task",
        handler: async () => ({ insights: ["test"], actions: [], escalations: [] }),
        intervalMs: 1000,
        enabled: true,
      });

      expect(id).toMatch(/^sub-task-/);
    });
  });

  describe("tick()", () => {
    it("should run handler when intervalMs has elapsed", async () => {
      const handler = vi.fn().mockResolvedValue({
        insights: ["found pattern"],
        actions: [],
        escalations: [],
      });

      engine.registerTask({
        name: "due-task",
        handler,
        intervalMs: 0, // always due
        enabled: true,
      });

      const result = await engine.tick();

      expect(handler).toHaveBeenCalled();
      expect(result.insights).toContain("found pattern");
    });

    it("should skip tasks that are not yet due", async () => {
      const handler = vi.fn().mockResolvedValue({
        insights: [],
        actions: [],
        escalations: [],
      });

      engine.registerTask({
        name: "not-due-task",
        handler,
        intervalMs: 999999999, // far in the future
        enabled: true,
      });

      // First tick runs (lastRun = 0, so it's always due first time)
      await engine.tick();
      handler.mockClear();

      // Second tick should NOT run the task since intervalMs hasn't elapsed
      const result = await engine.tick();

      expect(handler).not.toHaveBeenCalled();
      expect(result.insights).toHaveLength(0);
    });

    it("should skip disabled tasks", async () => {
      const handler = vi.fn().mockResolvedValue({
        insights: ["should not appear"],
        actions: [],
        escalations: [],
      });

      engine.registerTask({
        name: "disabled-task",
        handler,
        intervalMs: 0,
        enabled: false,
      });

      const result = await engine.tick();

      expect(handler).not.toHaveBeenCalled();
      expect(result.insights).toHaveLength(0);
    });

    it("should aggregate results from multiple tasks", async () => {
      engine.registerTask({
        name: "task-a",
        handler: async () => ({ insights: ["insight-a"], actions: ["action-a"], escalations: [] }),
        intervalMs: 0,
        enabled: true,
      });

      engine.registerTask({
        name: "task-b",
        handler: async () => ({ insights: ["insight-b"], actions: [], escalations: [] }),
        intervalMs: 0,
        enabled: true,
      });

      const result = await engine.tick();

      expect(result.insights).toContain("insight-a");
      expect(result.insights).toContain("insight-b");
      expect(result.actions).toContain("action-a");
    });

    it("should handle task errors gracefully and record escalation", async () => {
      engine.registerTask({
        name: "failing-task",
        handler: async () => { throw new Error("task exploded"); },
        intervalMs: 0,
        enabled: true,
      });

      const result = await engine.tick();

      expect(result.escalations).toHaveLength(1);
      expect(result.escalations[0].level).toBe("warning");
      expect(result.escalations[0].message).toContain("task exploded");
      expect(result.escalations[0].source).toBe("failing-task");
    });
  });

  describe("getEscalations()", () => {
    it("should return all escalations when no since parameter", async () => {
      engine.registerTask({
        name: "escalation-task",
        handler: async () => ({
          insights: [],
          actions: [],
          escalations: [
            { level: "critical", message: "high failure rate", source: "test", timestamp: 100 },
          ],
        }),
        intervalMs: 0,
        enabled: true,
      });

      await engine.tick();
      const escalations = engine.getEscalations();

      expect(escalations.length).toBeGreaterThanOrEqual(1);
      expect(escalations.some((e) => e.message === "high failure rate")).toBe(true);
    });

    it("should filter escalations by timestamp when since is provided", async () => {
      engine.registerTask({
        name: "time-escalation",
        handler: async () => ({
          insights: [],
          actions: [],
          escalations: [
            { level: "info", message: "old event", source: "test", timestamp: 50 },
            { level: "info", message: "new event", source: "test", timestamp: 200 },
          ],
        }),
        intervalMs: 0,
        enabled: true,
      });

      await engine.tick();
      const escalations = engine.getEscalations(100);

      expect(escalations.every((e) => e.timestamp >= 100)).toBe(true);
      expect(escalations.some((e) => e.message === "new event")).toBe(true);
      expect(escalations.some((e) => e.message === "old event")).toBe(false);
    });
  });

  describe("built-in tasks", () => {
    it("should have built-in tasks registered on construction", async () => {
      // The built-in tasks are registered but have large intervals.
      // They run on first tick since lastRun starts at 0.
      (mockMemory.getRecentDecisions as ReturnType<typeof vi.fn>).mockReturnValue([
        { strategy: "test", action: "buy", outcome: "success" },
        { strategy: "test", action: "sell", outcome: "failure" },
        { strategy: "test", action: "hold", outcome: "success" },
      ]);
      (mockMemory.recall as ReturnType<typeof vi.fn>).mockReturnValue([
        { category: "market", content: "BTC pumping" },
        { category: "market", content: "ETH stable" },
      ]);

      const result = await engine.tick();

      // The LLM should have been called by the built-in tasks
      expect(mockLLM).toHaveBeenCalled();
      // Results should exist (even if just empty from mock returning "none")
      expect(result).toBeDefined();
    });
  });
});
