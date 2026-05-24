import type { Context } from "grammy";
import type { AgentController } from "../../core/agent.js";

export function registerAgentsCommand(
  bot: { command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void },
  agent: AgentController
): void {
  bot.command("agents", async (ctx: Context) => {
    const orchestrator = agent.getOrchestrator();
    if (!orchestrator) {
      await ctx.reply("Orchestrator not initialized.");
      return;
    }
    const agents = orchestrator.getRegistry().listAgents();
    if (agents.length === 0) {
      await ctx.reply("No agents registered.");
      return;
    }
    const lines = agents.map(
      (a) => `- <b>${a.name}</b>: ${a.capabilities.join(', ')} (priority: ${a.priority})`
    );
    const message = [`<b>Registered Sub-Agents</b>`, "", ...lines].join("\n");
    await ctx.reply(message, { parse_mode: "HTML" });
  });
}
