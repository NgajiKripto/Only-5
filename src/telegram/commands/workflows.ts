import type { Context } from "grammy";
import type { AgentController } from "../../core/agent.js";

export function registerWorkflowsCommand(
  bot: { command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void },
  agent: AgentController
): void {
  bot.command("workflows", async (ctx: Context) => {
    const registry = agent.getWorkflowRegistry();
    if (!registry) {
      await ctx.reply("Workflow registry not initialized.");
      return;
    }
    const workflows = registry.listWorkflows();
    if (workflows.length === 0) {
      await ctx.reply("No workflows registered.");
      return;
    }
    const lines = workflows.map(
      (w) => `- <b>${w.name}</b>: ${w.description} (${w.steps} steps)`
    );
    const message = [`<b>Available Workflows</b>`, "", ...lines].join("\n");
    await ctx.reply(message, { parse_mode: "HTML" });
  });
}
