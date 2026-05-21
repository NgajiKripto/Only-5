import type { Context } from "grammy";
import type { AgentController } from "../../core/agent.js";
import { PriorityTier } from "../../types/index.js";

const TIER_ICONS: Record<PriorityTier, string> = {
  [PriorityTier.CRITICAL]: "\uD83D\uDD25",
  [PriorityTier.HIGH]: "\uD83D\uDFE2",
  [PriorityTier.MEDIUM]: "\uD83D\uDFE1",
  [PriorityTier.LOW]: "\uD83D\uDD34",
  [PriorityTier.DORMANT]: "\uD83C\uDF19",
};

export function registerPriorityCommands(
  bot: {
    command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void;
  },
  agent: AgentController
): void {
  bot.command("priority", async (ctx: Context) => {
    const priorities = agent.getPriorityManager().getPrioritizedStrategies();

    if (priorities.length === 0) {
      await ctx.reply("\uD83D\uDCCB No strategy priorities recorded yet.");
      return;
    }

    const lines = priorities.map((p) => {
      const icon = TIER_ICONS[p.tier];
      const scorePercent = (p.score * 100).toFixed(0);
      let lastRevenue: string;
      if (p.lastRevenueAt === null) {
        lastRevenue = "never";
      } else {
        const hoursSince =
          (Date.now() - p.lastRevenueAt) / (1000 * 60 * 60);
        if (hoursSince < 1) {
          lastRevenue = `${Math.floor(hoursSince * 60)}m ago`;
        } else if (hoursSince < 24) {
          lastRevenue = `${Math.floor(hoursSince)}h ago`;
        } else {
          lastRevenue = `${Math.floor(hoursSince / 24)}d ago`;
        }
      }
      return `${icon} <b>${p.strategy}</b>\n   Score: ${scorePercent}% | Failures: ${p.consecutiveFailures} | Revenue: ${lastRevenue}`;
    });

    const message = [
      "\uD83C\uDFAF <b>Strategy Priorities</b>",
      "",
      ...lines,
    ].join("\n");
    await ctx.reply(message, { parse_mode: "HTML" });
  });

  bot.command("boost", async (ctx: Context) => {
    const text = ctx.message?.text || "";
    const name = text.replace("/boost", "").trim();

    if (!name) {
      await ctx.reply("Usage: /boost <strategy_name>");
      return;
    }

    try {
      agent.getPriorityManager().boostStrategy(name);
      await ctx.reply(
        `\u2B06\uFE0F Strategy "<b>${name}</b>" boosted successfully.`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      await ctx.reply(
        `\u274C Failed to boost strategy: ${(error as Error).message}`
      );
    }
  });

  bot.command("mode", async (ctx: Context) => {
    const fallback = agent.getFallbackSystem();
    const state = fallback.getState();
    const description = fallback.getDescription();
    const threshold = fallback.getConfidenceThreshold();
    const interval = fallback.getEvaluationIntervalSeconds();

    const timeInMode = Date.now() - state.enteredAt;
    const hoursInMode = (timeInMode / (1000 * 60 * 60)).toFixed(1);

    const message = [
      "\uD83D\uDEA6 <b>Operating Mode</b>",
      "",
      `Mode: <b>${state.mode}</b>`,
      `Status: ${description}`,
      `Time in mode: ${hoursInMode}h`,
      "",
      `Confidence threshold: ${(threshold * 100).toFixed(0)}%`,
      `Evaluation interval: ${interval}s`,
    ].join("\n");

    await ctx.reply(message, { parse_mode: "HTML" });
  });
}
