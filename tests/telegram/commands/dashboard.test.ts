import { describe, it, expect, vi } from "vitest";
import { registerDashboardCommand } from "../../../src/telegram/commands/dashboard.js";

function createMockBot() {
  const handlers: Record<string, (ctx: unknown) => Promise<void>> = {};
  return {
    command(cmd: string, handler: (ctx: unknown) => Promise<void>) {
      handlers[cmd] = handler;
    },
    getHandler(cmd: string) {
      return handlers[cmd];
    },
  };
}

function createMockContext() {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockDashboard(running: boolean, port = 8080, connections = 3) {
  return {
    isRunning: () => running,
    getPort: () => port,
    getConnectionCount: () => connections,
    start: vi.fn(),
    stop: vi.fn(),
    setStatusProvider: vi.fn(),
    setMetricsProvider: vi.fn(),
    setStrategiesProvider: vi.fn(),
    setMemoryStatsProvider: vi.fn(),
    getWebSocketServer: vi.fn(),
  };
}

describe("registerDashboardCommand", () => {
  it("should register the dashboard command", () => {
    const bot = createMockBot();
    const dashboard = createMockDashboard(true);
    registerDashboardCommand(bot, dashboard as never);
    expect(bot.getHandler("dashboard")).toBeDefined();
  });

  it("should reply with URL when dashboard is running", async () => {
    const bot = createMockBot();
    const dashboard = createMockDashboard(true, 9090, 5);
    registerDashboardCommand(bot, dashboard as never);

    const ctx = createMockContext();
    await bot.getHandler("dashboard")!(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const message = ctx.reply.mock.calls[0][0] as string;
    expect(message).toContain("9090");
    expect(message).toContain("Running");
    expect(message).toContain("5");
    expect(message).toContain("Dashboard");
  });

  it("should reply with not running when dashboard is null", async () => {
    const bot = createMockBot();
    registerDashboardCommand(bot, null);

    const ctx = createMockContext();
    await bot.getHandler("dashboard")!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith("Dashboard is not currently running.");
  });

  it("should reply with not running when dashboard is stopped", async () => {
    const bot = createMockBot();
    const dashboard = createMockDashboard(false);
    registerDashboardCommand(bot, dashboard as never);

    const ctx = createMockContext();
    await bot.getHandler("dashboard")!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith("Dashboard is not currently running.");
  });

  it("should include port number in the message", async () => {
    const bot = createMockBot();
    const dashboard = createMockDashboard(true, 4567, 0);
    registerDashboardCommand(bot, dashboard as never);

    const ctx = createMockContext();
    await bot.getHandler("dashboard")!(ctx);

    const message = ctx.reply.mock.calls[0][0] as string;
    expect(message).toContain("4567");
  });

  it("should include connection count in the message", async () => {
    const bot = createMockBot();
    const dashboard = createMockDashboard(true, 3000, 12);
    registerDashboardCommand(bot, dashboard as never);

    const ctx = createMockContext();
    await bot.getHandler("dashboard")!(ctx);

    const message = ctx.reply.mock.calls[0][0] as string;
    expect(message).toContain("12");
  });

  it("should use HTML parse mode", async () => {
    const bot = createMockBot();
    const dashboard = createMockDashboard(true);
    registerDashboardCommand(bot, dashboard as never);

    const ctx = createMockContext();
    await bot.getHandler("dashboard")!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.any(String), { parse_mode: "HTML" });
  });
});
