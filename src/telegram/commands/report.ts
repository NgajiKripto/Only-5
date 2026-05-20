import type { Context } from "grammy";
import type { AgentController } from "../../core/agent.js";

export function registerReportCommands(
  bot: { command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void },
  agent: AgentController
): void {
  bot.command("report", async (ctx: Context) => {
    const memory = agent.getMemory();

    // Get recent decisions
    const decisions = memory.recall("decisions", 20);
    const pnlRecords = memory.recall("pnl", 50);
    const learnings = memory.recall("learning", 5);

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let dailyPnl = 0;
    let actionsToday = 0;

    for (const record of pnlRecords) {
      try {
        const data = JSON.parse(record.content);
        if (data.timestamp >= oneDayAgo) {
          dailyPnl += data.pnl || 0;
          actionsToday++;
        }
      } catch {
        // skip
      }
    }

    const pnlIcon = dailyPnl >= 0 ? "\uD83D\uDCC8" : "\uD83D\uDCC9";
    const pnlSign = dailyPnl >= 0 ? "+" : "";

    // Strategy breakdown from decisions
    const strategyBreakdown: Record<string, number> = {};
    for (const d of decisions) {
      try {
        const data = JSON.parse(d.content);
        const strat = data.strategy || "unknown";
        strategyBreakdown[strat] = (strategyBreakdown[strat] || 0) + 1;
      } catch {
        // skip
      }
    }

    const breakdownLines = Object.entries(strategyBreakdown).map(
      ([name, count]) => `  \u2022 ${name}: ${count} actions`
    );

    const latestLearning =
      learnings.length > 0
        ? learnings[0].content.slice(0, 200)
        : "No learnings yet";

    const message = [
      `\uD83D\uDCCB <b>Daily Report</b>`,
      "",
      `${pnlIcon} <b>P&L Today:</b> ${pnlSign}${dailyPnl.toFixed(4)} SOL`,
      `\uD83D\uDD04 Actions Today: ${actionsToday}`,
      "",
      `\uD83C\uDFAF <b>Strategy Breakdown:</b>`,
      ...(breakdownLines.length > 0
        ? breakdownLines
        : ["  No actions recorded"]),
      "",
      `\uD83E\uDDE0 <b>Latest Learning:</b>`,
      `${latestLearning}`,
    ].join("\n");

    await ctx.reply(message, { parse_mode: "HTML" });
  });

  bot.command("pnl", async (ctx: Context) => {
    const memory = agent.getMemory();
    const pnlRecords = memory.recall("pnl", 200);

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    let todayPnl = 0;
    let weekPnl = 0;
    let monthPnl = 0;
    let allTimePnl = 0;

    for (const record of pnlRecords) {
      try {
        const data = JSON.parse(record.content);
        const pnl = data.pnl || 0;
        const ts = data.timestamp || record.timestamp;

        allTimePnl += pnl;
        if (ts >= thirtyDaysAgo) monthPnl += pnl;
        if (ts >= sevenDaysAgo) weekPnl += pnl;
        if (ts >= oneDayAgo) todayPnl += pnl;
      } catch {
        // skip
      }
    }

    const formatPnl = (val: number) => {
      const sign = val >= 0 ? "+" : "";
      const icon = val >= 0 ? "\uD83D\uDCC8" : "\uD83D\uDCC9";
      return `${icon} ${sign}${val.toFixed(4)} SOL`;
    };

    const message = [
      `\uD83D\uDCB5 <b>Profit & Loss</b>`,
      "",
      `Today:    ${formatPnl(todayPnl)}`,
      `7 Days:   ${formatPnl(weekPnl)}`,
      `30 Days:  ${formatPnl(monthPnl)}`,
      `All Time: ${formatPnl(allTimePnl)}`,
    ].join("\n");

    await ctx.reply(message, { parse_mode: "HTML" });
  });
}
