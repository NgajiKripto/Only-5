import { readFileSync, existsSync } from "fs";
import type { Context } from "grammy";
import type { AgentController } from "../../core/agent.js";

const MAX_TELEGRAM_MESSAGE = 4096;
const LOG_FILE = "logs/agent.log";

export function registerLogsCommands(
  bot: { command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void },
  _agent: AgentController
): void {
  bot.command("logs", async (ctx: Context) => {
    const text = ctx.message?.text || "";
    const parts = text.split(" ");
    let count = 10;

    if (parts.length > 1) {
      const parsed = parseInt(parts[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        count = Math.min(parsed, 50);
      }
    }

    const lines = readLogLines(count);

    if (lines.length === 0) {
      await ctx.reply("\uD83D\uDCDC No log entries found.");
      return;
    }

    let message = `\uD83D\uDCDC <b>Last ${lines.length} Log Entries</b>\n\n`;
    message += `<pre>${escapeHtml(lines.join("\n"))}</pre>`;

    if (message.length > MAX_TELEGRAM_MESSAGE) {
      message = message.slice(0, MAX_TELEGRAM_MESSAGE - 20) + "\n...</pre>";
    }

    await ctx.reply(message, { parse_mode: "HTML" });
  });

  bot.command("errors", async (ctx: Context) => {
    const lines = readLogLines(200);
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    const errorLines = lines.filter((line) => {
      // Filter for error-level entries from last 24h
      const isError = line.toLowerCase().includes('"level":"error"') ||
        line.includes("[ERROR]") ||
        line.includes("error");
      if (!isError) return false;

      // Try to extract timestamp
      try {
        const match = line.match(/"timestamp":"([^"]+)"/);
        if (match) {
          const ts = new Date(match[1]).getTime();
          return ts >= oneDayAgo;
        }
      } catch {
        // include it if we cannot parse timestamp
      }
      return true;
    });

    if (errorLines.length === 0) {
      await ctx.reply("\u2705 No errors in the last 24 hours.");
      return;
    }

    const recentErrors = errorLines.slice(-20);
    let message = `\u26A0\uFE0F <b>Recent Errors (${recentErrors.length})</b>\n\n`;
    message += `<pre>${escapeHtml(recentErrors.join("\n"))}</pre>`;

    if (message.length > MAX_TELEGRAM_MESSAGE) {
      message = message.slice(0, MAX_TELEGRAM_MESSAGE - 20) + "\n...</pre>";
    }

    await ctx.reply(message, { parse_mode: "HTML" });
  });
}

function readLogLines(count: number): string[] {
  if (!existsSync(LOG_FILE)) {
    return [];
  }

  try {
    const content = readFileSync(LOG_FILE, "utf-8");
    const allLines = content.trim().split("\n").filter((l) => l.length > 0);
    return allLines.slice(-count);
  } catch {
    return [];
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
