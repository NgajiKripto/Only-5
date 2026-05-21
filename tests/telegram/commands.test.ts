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
import { authPassphrase } from "../../src/config.js";

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
    it("should not auto-authorize first user without passphrase", () => {
      const telegramBot = new TelegramBot(agent as any);
      expect(telegramBot.isAuthorized(12345)).toBe(false);
    });

    it("should authorize user via passphrase", () => {
      const telegramBot = new TelegramBot(agent as any);
      const result = telegramBot.tryAuthorizeWithPassphrase(12345, authPassphrase);
      expect(result).toBe(true);
      expect(telegramBot.isAuthorized(12345)).toBe(true);
      expect(telegramBot.getAuthorizedChatIds().has(12345)).toBe(true);
    });

    it("should reject unauthorized users when chats are set", () => {
      const telegramBot = new TelegramBot(agent as any, [99999]);
      expect(telegramBot.isAuthorized(12345)).toBe(false);
      expect(telegramBot.isAuthorized(99999)).toBe(true);
    });
  });

  describe("/scan command", () => {
    it("should show usage when no URL provided", async () => {
      const { registerSecurityCommands } = await import("../../src/telegram/commands/security.js");

      const ctx = createMockContext();
      ctx.message.text = "/scan";
      let scanHandler: ((ctx: any) => Promise<void>) | null = null;

      const mockBot = {
        command: (cmd: string, handler: (ctx: any) => Promise<void>) => {
          if (cmd === "scan") scanHandler = handler;
        },
      };

      registerSecurityCommands(mockBot as any, agent);
      expect(scanHandler).not.toBeNull();

      await scanHandler!(ctx);

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const message = ctx.reply.mock.calls[0][0] as string;
      expect(message).toContain("Usage: /scan <url>");
      expect(message).toContain("0.1 SOL per scan");
    });

    it("should reject invalid URL", async () => {
      const { registerSecurityCommands } = await import("../../src/telegram/commands/security.js");

      const ctx = createMockContext();
      ctx.message.text = "/scan not-a-url";
      let scanHandler: ((ctx: any) => Promise<void>) | null = null;

      const mockBot = {
        command: (cmd: string, handler: (ctx: any) => Promise<void>) => {
          if (cmd === "scan") scanHandler = handler;
        },
      };

      registerSecurityCommands(mockBot as any, agent);
      await scanHandler!(ctx);

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const message = ctx.reply.mock.calls[0][0] as string;
      expect(message).toContain("Invalid URL");
    });

    it("should queue a valid scan request", async () => {
      const { registerSecurityCommands } = await import("../../src/telegram/commands/security.js");

      // Add security-service mock to strategies
      const mockSecurityService = {
        addScanRequest: vi.fn(),
        getPricePerScan: vi.fn().mockReturnValue(0.1),
        getScanQueue: vi.fn().mockReturnValue([{ target: "https://example.com" }]),
      };
      agent.strategies.set("security-service", mockSecurityService);

      const ctx = createMockContext();
      ctx.message.text = "/scan https://example.com";
      let scanHandler: ((ctx: any) => Promise<void>) | null = null;

      const mockBot = {
        command: (cmd: string, handler: (ctx: any) => Promise<void>) => {
          if (cmd === "scan") scanHandler = handler;
        },
      };

      registerSecurityCommands(mockBot as any, agent);
      await scanHandler!(ctx);

      expect(mockSecurityService.addScanRequest).toHaveBeenCalledWith(12345, "https://example.com", "url");
      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const message = ctx.reply.mock.calls[0][0] as string;
      expect(message).toContain("Scan queued for: https://example.com");
      expect(message).toContain("0.1 SOL");
      expect(message).toContain("Position in queue: 1");
    });
  });

  describe("/bounties command", () => {
    it("should show bounty monitoring status", async () => {
      const { registerSecurityCommands } = await import("../../src/telegram/commands/security.js");

      // Add security-bounty mock to strategies
      const mockSecBounty = {
        enabled: true,
        getPerformance: vi.fn().mockReturnValue({ totalActions: 3, successRate: 0.67, totalReward: 1.5 }),
      };
      agent.strategies.set("security-bounty", mockSecBounty);

      // Add a submission to memory
      memory.remember("security_bounty_submissions", JSON.stringify({
        platform: "HackerOne",
        title: "XSS in login form",
      }));

      const ctx = createMockContext();
      let bountiesHandler: ((ctx: any) => Promise<void>) | null = null;

      const mockBot = {
        command: (cmd: string, handler: (ctx: any) => Promise<void>) => {
          if (cmd === "bounties") bountiesHandler = handler;
        },
      };

      registerSecurityCommands(mockBot as any, agent);
      await bountiesHandler!(ctx);

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const message = ctx.reply.mock.calls[0][0] as string;
      expect(message).toContain("Bug Bounty Monitoring");
      expect(message).toContain("Active");
      expect(message).toContain("Total Submissions: 3");
      expect(message).toContain("67%");
      expect(message).toContain("1.5000 SOL");
      expect(message).toContain("HackerOne");
      expect(message).toContain("XSS in login form");
    });
  });

  describe("/security command", () => {
    it("should show combined security stats", async () => {
      const { registerSecurityCommands } = await import("../../src/telegram/commands/security.js");

      const mockSecBounty = {
        enabled: true,
        getPerformance: vi.fn().mockReturnValue({ totalActions: 5, successRate: 0.6, totalReward: 2.0 }),
      };
      const mockSecService = {
        enabled: true,
        getPerformance: vi.fn().mockReturnValue({ totalActions: 10, successRate: 0.9, totalReward: 1.0 }),
        getScanQueue: vi.fn().mockReturnValue([{ target: "https://pending.com" }]),
        getCompletedScans: vi.fn().mockReturnValue([]),
      };
      agent.strategies.set("security-bounty", mockSecBounty);
      agent.strategies.set("security-service", mockSecService);

      const ctx = createMockContext();
      let securityHandler: ((ctx: any) => Promise<void>) | null = null;

      const mockBot = {
        command: (cmd: string, handler: (ctx: any) => Promise<void>) => {
          if (cmd === "security") securityHandler = handler;
        },
      };

      registerSecurityCommands(mockBot as any, agent);
      await securityHandler!(ctx);

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const message = ctx.reply.mock.calls[0][0] as string;
      expect(message).toContain("Security Strategies Overview");
      expect(message).toContain("Bug Bounty Hunting:");
      expect(message).toContain("Submissions: 5");
      expect(message).toContain("2.0000 SOL");
      expect(message).toContain("Scans Completed: 10");
      expect(message).toContain("1 pending");
      expect(message).toContain("1.0000 SOL");
      expect(message).toContain("Total Security Revenue: 3.0000 SOL");
    });
  });
});
