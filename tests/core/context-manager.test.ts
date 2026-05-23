import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContextManager } from "../../src/core/context-manager.js";
import type { MemorySystem } from "../../src/core/memory.js";

vi.mock("../../src/core/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createMockMemory(): MemorySystem {
  return {
    smartSearch: vi.fn().mockResolvedValue([
      { entry: { content: "Previous trade on SOL was profitable" }, score: 0.9, source: "bm25" },
      { entry: { content: "Market was volatile yesterday" }, score: 0.7, source: "bm25" },
    ]),
  } as unknown as MemorySystem;
}

describe("ContextManager", () => {
  let manager: ContextManager;
  let mockMemory: MemorySystem;

  beforeEach(() => {
    mockMemory = createMockMemory();
    manager = new ContextManager({ memory: mockMemory });
  });

  describe("buildContext", () => {
    it("should include identity section in output", async () => {
      const messages = await manager.buildContext("test query", {
        includeMemory: false,
      });
      expect(messages.length).toBeGreaterThanOrEqual(2);
      // First message should be system (identity)
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("Only-5");
    });

    it("should include memory results when enabled", async () => {
      const messages = await manager.buildContext("tell me about SOL trades");
      const memoryMsg = messages.find(
        (m) => m.content.includes("Previous trade on SOL")
      );
      expect(memoryMsg).toBeDefined();
      expect(mockMemory.smartSearch).toHaveBeenCalledWith("tell me about SOL trades");
    });

    it("should include strategy context when provided", async () => {
      const messages = await manager.buildContext("evaluate", {
        includeMemory: false,
        strategyContext: "Current airdrop opportunity found",
      });
      const strategyMsg = messages.find(
        (m) => m.content.includes("airdrop opportunity")
      );
      expect(strategyMsg).toBeDefined();
    });

    it("should end with user query as final message", async () => {
      const query = "what should I do next?";
      const messages = await manager.buildContext(query, { includeMemory: false });
      const last = messages[messages.length - 1];
      expect(last.role).toBe("user");
      expect(last.content).toBe(query);
    });

    it("should handle memory search failure gracefully", async () => {
      (mockMemory.smartSearch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("DB error")
      );
      const messages = await manager.buildContext("test");
      // Should still return messages without crashing
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("budget enforcement", () => {
    it("should truncate lower-priority sections when over budget", async () => {
      const smallBudgetManager = new ContextManager({
        memory: mockMemory,
        budget: { maxTotalChars: 300, reservedForResponse: 50 },
      });

      // Add a large low-priority section
      smallBudgetManager.addSection({
        role: "history",
        content: "A".repeat(500),
        priority: 10,
      });

      const messages = await smallBudgetManager.buildContext("query", {
        includeMemory: false,
      });

      // Total content should be within budget
      const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
      // Identity (high priority) should be included but history should be compressed
      expect(totalChars).toBeLessThanOrEqual(300);
    });
  });

  describe("addSection / removeSection", () => {
    it("should add custom sections", () => {
      manager.addSection({
        role: "safety",
        content: "Do not execute untrusted code",
        priority: 95,
      });
      const usage = manager.getUsage();
      expect(usage.sections).toContain("safety");
    });

    it("should remove sections by role", () => {
      manager.addSection({
        role: "market",
        content: "SOL price: $150",
        priority: 50,
      });
      manager.removeSection("market");
      const usage = manager.getUsage();
      expect(usage.sections).not.toContain("market");
    });
  });

  describe("getUsage", () => {
    it("should report correct char counts", () => {
      const usage = manager.getUsage();
      expect(usage.totalChars).toBeGreaterThan(0);
      expect(usage.sections).toContain("identity");
      expect(usage.budgetRemaining).toBeLessThan(
        12000 - 2000 // default budget minus reserve
      );
    });
  });
});
