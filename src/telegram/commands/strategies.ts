import type { Context } from "grammy";
import type { AgentController } from "../../core/agent.js";

export function registerStrategiesCommands(
  bot: { command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void },
  agent: AgentController
): void {
  bot.command("strategies", async (ctx: Context) => {
    const strategies = getStrategies(agent);

    if (strategies.length === 0) {
      await ctx.reply("\uD83D\uDCCB No strategies registered.");
      return;
    }

    const lines = strategies.map((s) => {
      const icon = s.enabled ? "\uD83D\uDFE2" : "\uD83D\uDD34";
      const perf = s.performance;
      return `${icon} <b>${s.name}</b>\n   Actions: ${perf.totalActions} | Success: ${(perf.successRate * 100).toFixed(0)}% | Reward: ${perf.totalReward.toFixed(4)} SOL`;
    });

    const message = [`\uD83C\uDFAF <b>Strategies</b>`, "", ...lines].join("\n");
    await ctx.reply(message, { parse_mode: "HTML" });
  });

  bot.command("enable", async (ctx: Context) => {
    const text = ctx.message?.text || "";
    const name = text.replace("/enable", "").trim();

    if (!name) {
      await ctx.reply("Usage: /enable <strategy_name>");
      return;
    }

    const strategies = getStrategies(agent);
    const strategy = strategies.find(
      (s) => s.name.toLowerCase() === name.toLowerCase()
    );

    if (!strategy) {
      await ctx.reply(`\u274C Strategy "${name}" not found.`);
      return;
    }

    strategy.ref.enabled = true;
    await ctx.reply(`\uD83D\uDFE2 Strategy "<b>${strategy.name}</b>" enabled.`, {
      parse_mode: "HTML",
    });
  });

  bot.command("disable", async (ctx: Context) => {
    const text = ctx.message?.text || "";
    const name = text.replace("/disable", "").trim();

    if (!name) {
      await ctx.reply("Usage: /disable <strategy_name>");
      return;
    }

    const strategies = getStrategies(agent);
    const strategy = strategies.find(
      (s) => s.name.toLowerCase() === name.toLowerCase()
    );

    if (!strategy) {
      await ctx.reply(`\u274C Strategy "${name}" not found.`);
      return;
    }

    strategy.ref.enabled = false;
    await ctx.reply(`\uD83D\uDD34 Strategy "<b>${strategy.name}</b>" disabled.`, {
      parse_mode: "HTML",
    });
  });

  bot.command("strategy", async (ctx: Context) => {
    const text = ctx.message?.text || "";
    const name = text.replace("/strategy", "").trim();

    if (!name) {
      await ctx.reply("Usage: /strategy <strategy_name>");
      return;
    }

    const strategies = getStrategies(agent);
    const strategy = strategies.find(
      (s) => s.name.toLowerCase() === name.toLowerCase()
    );

    if (!strategy) {
      await ctx.reply(`\u274C Strategy "${name}" not found.`);
      return;
    }

    const perf = strategy.performance;
    const statusIcon = strategy.enabled ? "\uD83D\uDFE2" : "\uD83D\uDD34";

    const message = [
      `${statusIcon} <b>${strategy.name}</b>`,
      "",
      `\uD83D\uDCDD ${strategy.description}`,
      `\u26A0\uFE0F Risk: ${strategy.riskLevel}`,
      "",
      `\uD83D\uDCCA <b>Performance:</b>`,
      `  Total Actions: ${perf.totalActions}`,
      `  Success Rate: ${(perf.successRate * 100).toFixed(1)}%`,
      `  Total Reward: ${perf.totalReward.toFixed(4)} SOL`,
      "",
      `Status: ${strategy.enabled ? "Enabled" : "Disabled"}`,
    ].join("\n");

    await ctx.reply(message, { parse_mode: "HTML" });
  });
}

function getStrategies(agent: AgentController) {
  // Access strategies via getState to get strategy names, then get details
  const state = agent as any;
  const strategiesMap: Map<string, any> = state.strategies;

  return Array.from(strategiesMap.entries()).map(([name, strategy]) => ({
    name,
    description: strategy.description || "No description",
    riskLevel: strategy.riskLevel || "UNKNOWN",
    enabled: strategy.enabled,
    performance: strategy.getPerformance
      ? strategy.getPerformance()
      : { totalActions: 0, successRate: 0, totalReward: 0 },
    ref: strategy,
  }));
}
