import type { Context } from "grammy";
import type { AgentController } from "../../core/agent.js";

export function registerStreamCommand(
  bot: { command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void },
  agent: AgentController
): void {
  bot.command("stream", async (ctx: Context) => {
    const streamManager = agent.getStreamManager();
    if (!streamManager) {
      await ctx.reply("Stream manager not initialized.");
      return;
    }
    const activeStreams = streamManager.getActiveStreams();
    if (activeStreams.length === 0) {
      await ctx.reply("No active streaming sessions.");
      return;
    }
    const totalEvents = activeStreams.reduce((sum, s) => sum + s.events, 0);
    const lines = activeStreams.map(
      (s) => `- Session <code>${s.id.slice(0, 8)}</code>: ${s.events} events (started ${new Date(s.startedAt).toLocaleTimeString()})`
    );
    const message = [
      `<b>Active Streams</b>`,
      "",
      `Sessions: ${activeStreams.length}`,
      `Total events: ${totalEvents}`,
      "",
      ...lines,
    ].join("\n");
    await ctx.reply(message, { parse_mode: "HTML" });
  });
}
