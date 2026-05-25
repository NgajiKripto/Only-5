import type { Context } from "grammy";
import { ServiceManager } from "../../services/index.js";

export function registerServicesCommand(
  bot: { command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void },
): void {
  bot.command("services", async (ctx: Context) => {
    const manager = new ServiceManager();
    const statuses = await manager.healthCheck();

    const lines = statuses.map((s) => {
      const icon = s.healthy ? "\u2705" : "\u274C";
      const status = s.healthy ? "connected" : "disconnected";
      return `${icon} <b>${s.name}</b>\n   URL: ${s.url}\n   Status: ${status}${s.error ? ` (${s.error})` : ""}`;
    });

    const allHealthy = statuses.every((s) => s.healthy);
    const summaryIcon = allHealthy ? "\u2705" : "\u26A0\uFE0F";
    const summary = allHealthy
      ? "All services operational"
      : `${statuses.filter((s) => !s.healthy).length} service(s) unavailable`;

    const message = [
      `\uD83D\uDD27 <b>Service Status</b>`,
      "",
      ...lines,
      "",
      `${summaryIcon} ${summary}`,
    ].join("\n");

    await ctx.reply(message, { parse_mode: "HTML" });
  });
}
