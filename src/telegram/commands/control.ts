import type { Context } from "grammy";
import type { AgentController } from "../../core/agent.js";
import { config } from "../../config.js";

export function registerControlCommands(
  bot: { command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void },
  agent: AgentController
): void {
  bot.command("pause", async (ctx: Context) => {
    const scheduler = agent.getScheduler();
    scheduler.stopAll();
    await ctx.reply("\u23F8 Agent paused. All scheduled tasks stopped.\n\nUse /resume to continue.");
  });

  bot.command("resume", async (ctx: Context) => {
    const scheduler = agent.getScheduler();
    scheduler.startAll();
    await ctx.reply("\u25B6\uFE0F Agent resumed. All scheduled tasks restarted.");
  });

  bot.command("config", async (ctx: Context) => {
    const sanitized = {
      AGENT_NAME: config.AGENT_NAME,
      SOLANA_RPC_URL: config.SOLANA_RPC_URL,
      LOG_LEVEL: config.LOG_LEVEL,
      DB_PATH: config.DB_PATH,
      TELEGRAM_BOT_TOKEN: "***" + config.TELEGRAM_BOT_TOKEN.slice(-4),
      OPENROUTER_API_KEY: "***" + config.OPENROUTER_API_KEY.slice(-4),
      SOLANA_PRIVATE_KEY: "[HIDDEN]",
      GITHUB_TOKEN: config.GITHUB_TOKEN ? "***" + config.GITHUB_TOKEN.slice(-4) : "Not set",
    };

    const lines = Object.entries(sanitized).map(
      ([key, val]) => `  <code>${key}</code>: ${val}`
    );

    const message = [
      `\u2699\uFE0F <b>Configuration</b>`,
      "",
      ...lines,
    ].join("\n");

    await ctx.reply(message, { parse_mode: "HTML" });
  });

  bot.command("help", async (ctx: Context) => {
    const message = [
      `\uD83E\uDD16 <b>Only-5 Agent Commands</b>`,
      "",
      `<b>Monitoring:</b>`,
      `  /status - Agent status and overview`,
      `  /balance - Wallet and token balances`,
      `  /pnl - Profit & loss summary`,
      "",
      `<b>Strategies:</b>`,
      `  /strategies - List all strategies`,
      `  /strategy &lt;name&gt; - Strategy details`,
      `  /enable &lt;name&gt; - Enable a strategy`,
      `  /disable &lt;name&gt; - Disable a strategy`,
      "",
      `<b>Reports:</b>`,
      `  /report - Full daily report`,
      `  /pnl - Quick P&L summary`,
      "",
      `<b>Control:</b>`,
      `  /pause - Pause agent activity`,
      `  /resume - Resume agent activity`,
      `  /config - Show configuration`,
      "",
      `<b>Logs:</b>`,
      `  /logs [N] - Show last N log entries`,
      `  /errors - Show recent errors`,
    ].join("\n");

    await ctx.reply(message, { parse_mode: "HTML" });
  });
}
