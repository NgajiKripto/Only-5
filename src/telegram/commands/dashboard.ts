import type { Context } from "grammy";
import type { DashboardServer } from "../../dashboard/server.js";

export function registerDashboardCommand(
  bot: { command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void },
  dashboard: DashboardServer | null
): void {
  bot.command("dashboard", async (ctx: Context) => {
    if (!dashboard || !dashboard.isRunning()) {
      await ctx.reply("Dashboard is not currently running.");
      return;
    }

    const port = dashboard.getPort();
    const message = [
      "\uD83D\uDCCA <b>Dashboard</b>",
      "",
      `\uD83C\uDF10 URL: <code>http://localhost:${port}</code>`,
      `\u2705 Status: Running`,
      `\uD83D\uDD0C WebSocket Clients: ${dashboard.getConnectionCount()}`,
    ].join("\n");

    await ctx.reply(message, { parse_mode: "HTML" });
  });
}
