import type { Context } from "grammy";
import type { AgentController } from "../../core/agent.js";

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function registerStatusCommand(
  bot: { command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void },
  agent: AgentController
): void {
  bot.command("status", async (ctx: Context) => {
    const state = await agent.getState();
    const scheduler = agent.getScheduler();
    const tasks = scheduler.listTasks();

    const statusIcon = state.status === "idle" ? "\uD83D\uDFE2" : state.status === "executing" ? "\u26A1" : state.status === "evaluating" ? "\uD83D\uDD0D" : "\uD83D\uDD34";

    const nextTask = tasks.find((t) => !t.running);
    const nextAction = nextTask ? nextTask.name : "None scheduled";

    const message = [
      `${statusIcon} <b>Agent Status</b>`,
      "",
      `\uD83D\uDCCA Status: <b>${state.status}</b>`,
      `\u23F1 Uptime: ${formatUptime(state.uptime)}`,
      `\uD83D\uDCB0 Balance: ${state.balance.toFixed(4)} SOL`,
      `\uD83C\uDFAF Active Strategies: ${state.activeStrategies.length}`,
      `\uD83D\uDD04 Last Action: ${state.lastAction || "None"}`,
      `\u23ED Next Action: ${nextAction}`,
    ].join("\n");

    await ctx.reply(message, { parse_mode: "HTML" });
  });
}
