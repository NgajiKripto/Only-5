import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

// Mock grammy before anything else
vi.mock("grammy", () => {
  return {
    Bot: vi.fn().mockImplementation(() => ({
      command: vi.fn(),
      use: vi.fn(),
      catch: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      api: {
        sendMessage: vi.fn().mockResolvedValue({}),
      },
    })),
    GrammyError: class GrammyError extends Error {},
    HttpError: class HttpError extends Error {},
  };
});

import { MemorySystem } from "../../src/core/memory.js";
import { AlertManager, AlertType } from "../../src/telegram/alerts.js";
import { TelegramBot } from "../../src/telegram/bot.js";

// Helper to create a mock AgentController
function createMockAgent(dbPath: string) {
  const memory = new MemorySystem(dbPath);

  const mockScheduler = {
    listTasks: vi.fn().mockReturnValue([
      { name: "evaluate-strategies", expression: "*/30 * * * * *", lastRun: null, nextRun: null, running: false },
    ]),
    startAll: vi.fn(),
    stopAll: vi.fn(),
  };

  const mockWallet = {
    getBalance: vi.fn().mockResolvedValue(5.2345),
    getTokenBalances: vi.fn().mockResolvedValue([
      { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: 100.5, decimals: 6 },
    ]),
  };

  const strategies = new Map();
  strategies.set("airdrop-hunter", {
    name: "airdrop-hunter",
    description: "Hunts for airdrops",
    riskLevel: "LOW",
    enabled: true,
    getPerformance: () => ({ totalActions: 5, successRate: 0.8, totalReward: 0.5 }),
  });
  strategies.set("content-creator", {
    name: "content-creator",
    description: "Creates content for tips",
    riskLevel: "MEDIUM",
    enabled: false,
    getPerformance: () => ({ totalActions: 2, successRate: 0.5, totalReward: 0.1 }),
  });

  const agent = {
    getState: vi.fn().mockResolvedValue({
      status: "idle",
      uptime: 3600000, // 1 hour
      balance: 5.2345,
      activeStrategies: ["airdrop-hunter"],
      lastAction: "Claimed airdrop from protocol X",
    }),
    getMemory: () => memory,
    getWallet: () => mockWallet,
    getScheduler: () => mockScheduler,
    strategies,
    on: vi.fn(),
    emit: vi.fn(),
  };

  return { agent, memory, mockWallet, mockScheduler };
}

function createMockContext() {
  return {
    chat: { id: 12345 },
    message: { text: "" },
    reply: vi.fn().mockResolvedValue({}),
  };
}

describe("Telegram Commands", () => {
  let dbPath: string;
  let agent: any;
  let memory: MemorySystem;

  beforeEach(() => {
    const dir = join(tmpdir(), "only5-telegram-test-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    dbPath = join(dir, "test.db");
    const result = createMockAgent(dbPath);
    agent = result.agent;
    memory = result.memory;
  });

  describe("/status command", () => {
    it("should return formatted status message", async () => {
      const { registerStatusCommand } = await import("../../src/telegram/commands/status.js");

      const ctx = createMockContext();
      let statusHandler: ((ctx: any) => Promise<void>) | null = null;

      const mockBot = {
        command: (cmd: string, handler: (ctx: any) => Promise<void>) => {
          if (cmd === "status") statusHandler = handler;
        },
      };

      registerStatusCommand(mockBot as any, agent);
      expect(statusHandler).not.toBeNull();

      await statusHandler!(ctx);

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const message = ctx.reply.mock.calls[0][0] as string;
      expect(message).toContain("Agent Status");
      expect(message).toContain("idle");
      expect(message).toContain("5.2345 SOL");
      expect(message).toContain("1h 0m");
      expect(message).toContain("Claimed airdrop");
    });
  });

  describe("/balance command", () => {
    it("should show correct balance values", async () => {
      const { registerBalanceCommand } = await import("../../src/telegram/commands/balance.js");

      const ctx = createMockContext();
      let balanceHandler: ((ctx: any) => Promise<void>) | null = null;

      const mockBot = {
        command: (cmd: string, handler: (ctx: any) => Promise<void>) => {
          if (cmd === "balance") balanceHandler = handler;
        },
      };

      registerBalanceCommand(mockBot as any, agent);
      expect(balanceHandler).not.toBeNull();

      await balanceHandler!(ctx);

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const message = ctx.reply.mock.calls[0][0] as string;
      expect(message).toContain("Wallet Balance");
      expect(message).toContain("5.2345");
      expect(message).toContain("Token Balances");
      expect(message).toContain("EPjFWdd5");
    });
  });

  describe("/strategies command", () => {
    it("should list all strategies with status", async () => {
      const { registerStrategiesCommands } = await import("../../src/telegram/commands/strategies.js");

      const ctx = createMockContext();
      let strategiesHandler: ((ctx: any) => Promise<void>) | null = null;

      const mockBot = {
        command: (cmd: string, handler: (ctx: any) => Promise<void>) => {
          if (cmd === "strategies") strategiesHandler = handler;
        },
      };

      registerStrategiesCommands(mockBot as any, agent);
      expect(strategiesHandler).not.toBeNull();

      await strategiesHandler!(ctx);

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const message = ctx.reply.mock.calls[0][0] as string;
      expect(message).toContain("Strategies");
      expect(message).toContain("airdrop-hunter");
      expect(message).toContain("content-creator");
    });
  });

  describe("/enable and /disable commands", () => {
    it("should enable a strategy", async () => {
      const { registerStrategiesCommands } = await import("../../src/telegram/commands/strategies.js");

      let enableHandler: ((ctx: any) => Promise<void>) | null = null;
      const mockBot = {
        command: (cmd: string, handler: (ctx: any) => Promise<void>) => {
          if (cmd === "enable") enableHandler = handler;
        },
      };

      registerStrategiesCommands(mockBot as any, agent);
      expect(enableHandler).not.toBeNull();

      const ctx = createMockContext();
      ctx.message.text = "/enable content-creator";
      await enableHandler!(ctx);

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const message = ctx.reply.mock.calls[0][0] as string;
      expect(message).toContain("enabled");
      expect(agent.strategies.get("content-creator").enabled).toBe(true);
    });

    it("should disable a strategy", async () => {
      const { registerStrategiesCommands } = await import("../../src/telegram/commands/strategies.js");

      let disableHandler: ((ctx: any) => Promise<void>) | null = null;
      const mockBot = {
        command: (cmd: string, handler: (ctx: any) => Promise<void>) => {
          if (cmd === "disable") disableHandler = handler;
        },
      };

      registerStrategiesCommands(mockBot as any, agent);
      expect(disableHandler).not.toBeNull();

      const ctx = createMockContext();
      ctx.message.text = "/disable airdrop-hunter";
      await disableHandler!(ctx);

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const message = ctx.reply.mock.calls[0][0] as string;
      expect(message).toContain("disabled");
      expect(agent.strategies.get("airdrop-hunter").enabled).toBe(false);
    });
  });

  describe("/pause and /resume commands", () => {
    it("should pause the agent", async () => {
      const { registerControlCommands } = await import("../../src/telegram/commands/control.js");

      let pauseHandler: ((ctx: any) => Promise<void>) | null = null;
      const mockBot = {
        command: (cmd: string, handler: (ctx: any) => Promise<void>) => {
          if (cmd === "pause") pauseHandler = handler;
        },
      };

      registerControlCommands(mockBot as any, agent);
      expect(pauseHandler).not.toBeNull();

      const ctx = createMockContext();
      await pauseHandler!(ctx);

      expect(agent.getScheduler().stopAll).toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const message = ctx.reply.mock.calls[0][0] as string;
      expect(message).toContain("paused");
    });

    it("should resume the agent", async () => {
      const { registerControlCommands } = await import("../../src/telegram/commands/control.js");

      let resumeHandler: ((ctx: any) => Promise<void>) | null = null;
      const mockBot = {
        command: (cmd: string, handler: (ctx: any) => Promise<void>) => {
          if (cmd === "resume") resumeHandler = handler;
        },
      };

      registerControlCommands(mockBot as any, agent);
      expect(resumeHandler).not.toBeNull();

      const ctx = createMockContext();
      await resumeHandler!(ctx);

      expect(agent.getScheduler().startAll).toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const message = ctx.reply.mock.calls[0][0] as string;
      expect(message).toContain("resumed");
    });
  });

  describe("AlertManager", () => {
    it("should send alerts to all authorized chats", async () => {
      const telegramBot = new TelegramBot(agent as any, [111, 222]);
      const alertManager = new AlertManager(telegramBot);

      const spy = vi.spyOn(telegramBot, "sendAlert");

      await alertManager.sendAlert(AlertType.INFO, "Test alert");

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("Test alert"));

      alertManager.stop();
    });

    it("should rate limit alerts of the same type", async () => {
      const telegramBot = new TelegramBot(agent as any, [111]);
      const alertManager = new AlertManager(telegramBot);

      const spy = vi.spyOn(telegramBot, "sendAlert");

      await alertManager.sendAlert(AlertType.ERROR, "First error");
      await alertManager.sendAlert(AlertType.ERROR, "Second error");

      // Only first should be sent immediately
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("First error"));

      alertManager.stop();
    });

    it("should allow different alert types without rate limiting", async () => {
      const telegramBot = new TelegramBot(agent as any, [111]);
      const alertManager = new AlertManager(telegramBot);

      const spy = vi.spyOn(telegramBot, "sendAlert");

      await alertManager.sendAlert(AlertType.ERROR, "Error msg");
      await alertManager.sendAlert(AlertType.PROFIT, "Profit msg");
      await alertManager.sendAlert(AlertType.WARNING, "Warning msg");

      expect(spy).toHaveBeenCalledTimes(3);

      alertManager.stop();
    });

    it("should format profit alerts correctly", async () => {
      const telegramBot = new TelegramBot(agent as any, [111]);
      const alertManager = new AlertManager(telegramBot);

      const spy = vi.spyOn(telegramBot, "sendAlert");

      await alertManager.onProfit(0.5);

      expect(spy).toHaveBeenCalledWith(expect.stringContaining("+0.5000 SOL"));

      alertManager.stop();
    });

    it("should format loss alerts correctly", async () => {
      const telegramBot = new TelegramBot(agent as any, [111]);
      const alertManager = new AlertManager(telegramBot);

      const spy = vi.spyOn(telegramBot, "sendAlert");

      await alertManager.onLoss(0.3);

      expect(spy).toHaveBeenCalledWith(expect.stringContaining("0.3000 SOL"));

      alertManager.stop();
    });
  });

  describe("TelegramBot", () => {
    it("should authorize first user if no authorized chats set", () => {
      const telegramBot = new TelegramBot(agent as any);
      expect(telegramBot.isAuthorized(12345)).toBe(true);
      expect(telegramBot.getAuthorizedChatIds().has(12345)).toBe(true);
    });

    it("should reject unauthorized users when chats are set", () => {
      const telegramBot = new TelegramBot(agent as any, [99999]);
      expect(telegramBot.isAuthorized(12345)).toBe(false);
      expect(telegramBot.isAuthorized(99999)).toBe(true);
    });
  });
});
