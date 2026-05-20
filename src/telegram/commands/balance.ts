import type { Context } from "grammy";
import type { AgentController } from "../../core/agent.js";

export function registerBalanceCommand(
  bot: { command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void },
  agent: AgentController
): void {
  bot.command("balance", async (ctx: Context) => {
    const wallet = agent.getWallet();
    const memory = agent.getMemory();

    let solBalance = 0;
    try {
      solBalance = await wallet.getBalance();
    } catch {
      await ctx.reply("\u274C Failed to fetch balance. RPC may be unavailable.");
      return;
    }

    let tokenLines: string[] = [];
    try {
      const tokens = await wallet.getTokenBalances();
      tokenLines = tokens.map(
        (t) => `  \u2022 ${t.mint.slice(0, 8)}...: ${t.amount.toFixed(4)}`
      );
    } catch {
      tokenLines = ["  \u2022 Unable to fetch token balances"];
    }

    // Estimate USD (rough estimate, SOL price not available without oracle)
    const estimatedUsd = solBalance * 150; // placeholder multiplier

    // Check for 24h P&L from memory
    const pnlRecords = memory.recall("pnl", 50);
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let dailyPnl = 0;
    for (const record of pnlRecords) {
      try {
        const data = JSON.parse(record.content);
        if (data.timestamp >= oneDayAgo) {
          dailyPnl += data.pnl || 0;
        }
      } catch {
        // skip malformed records
      }
    }

    const pnlIcon = dailyPnl >= 0 ? "\uD83D\uDCC8" : "\uD83D\uDCC9";
    const pnlSign = dailyPnl >= 0 ? "+" : "";

    const message = [
      `\uD83D\uDCB0 <b>Wallet Balance</b>`,
      "",
      `\u25C6 SOL: <b>${solBalance.toFixed(4)}</b> (~$${estimatedUsd.toFixed(2)})`,
      "",
      `\uD83E\uDE99 <b>Token Balances:</b>`,
      ...(tokenLines.length > 0 ? tokenLines : ["  No tokens found"]),
      "",
      `\uD83D\uDCCA Total Portfolio: ~$${estimatedUsd.toFixed(2)}`,
      `${pnlIcon} 24h P&L: ${pnlSign}${dailyPnl.toFixed(4)} SOL`,
    ].join("\n");

    await ctx.reply(message, { parse_mode: "HTML" });
  });
}
