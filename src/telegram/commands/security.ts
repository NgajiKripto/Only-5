import type { Context } from "grammy";
import type { AgentController } from "../../core/agent.js";

export function registerSecurityCommands(
  bot: { command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void },
  agent: AgentController
): void {
  // Register /scan command
  bot.command("scan", async (ctx: Context) => {
    const text = ctx.message?.text || "";
    const target = text.replace("/scan", "").trim();

    if (!target) {
      await ctx.reply("Usage: /scan <url>\nExample: /scan https://example.com\n\nPrice: 0.1 SOL per scan");
      return;
    }

    // Validate URL format
    try {
      new URL(target);
    } catch {
      await ctx.reply("Invalid URL. Please provide a valid URL starting with http:// or https://");
      return;
    }

    // Get security-service strategy from agent
    const agentAny = agent as any;
    const strategiesMap: Map<string, any> = agentAny.strategies;
    const securityService = strategiesMap?.get("security-service");

    if (!securityService || !securityService.addScanRequest) {
      await ctx.reply("Security scanning service is not available.");
      return;
    }

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Queue the scan
    securityService.addScanRequest(chatId, target, "url");
    const price = securityService.getPricePerScan?.() ?? 0.1;
    const queueSize = securityService.getScanQueue?.()?.length ?? 1;

    await ctx.reply(
      `Scan queued for: ${target}\nPrice: ${price} SOL\nPosition in queue: ${queueSize}\n\nYou will receive results when the scan completes.`,
      { parse_mode: "HTML" }
    );
  });

  // Register /bounties command
  bot.command("bounties", async (ctx: Context) => {
    const agentAny = agent as any;
    const strategiesMap: Map<string, any> = agentAny.strategies;
    const secBounty = strategiesMap?.get("security-bounty");

    if (!secBounty) {
      await ctx.reply("Security bounty strategy is not active.");
      return;
    }

    // Get performance data
    const perf = secBounty.getPerformance?.() ?? { totalActions: 0, successRate: 0, totalReward: 0 };

    // Get recent submissions from memory
    const memory = agent.getMemory();
    const submissions = memory.recall("security_bounty_submissions", 5);

    const recentList = submissions.length > 0
      ? submissions.map((s: any) => {
          try {
            const data = JSON.parse(s.content);
            return `  - ${data.platform || "Unknown"}: ${data.title || data.opportunity || "Untitled"}`;
          } catch {
            return `  - ${s.content.substring(0, 50)}...`;
          }
        }).join("\n")
      : "  No recent submissions";

    const message = [
      "<b>Bug Bounty Monitoring</b>",
      "",
      `Status: ${secBounty.enabled ? "Active" : "Paused"}`,
      `Total Submissions: ${perf.totalActions}`,
      `Success Rate: ${(perf.successRate * 100).toFixed(0)}%`,
      `Total Rewards: ${perf.totalReward.toFixed(4)} SOL`,
      "",
      "<b>Recent Activity:</b>",
      recentList,
      "",
      "Platforms: HackerOne, Immunefi, Code4rena"
    ].join("\n");

    await ctx.reply(message, { parse_mode: "HTML" });
  });

  // Register /security command
  bot.command("security", async (ctx: Context) => {
    const agentAny = agent as any;
    const strategiesMap: Map<string, any> = agentAny.strategies;

    const secBounty = strategiesMap?.get("security-bounty");
    const secService = strategiesMap?.get("security-service");

    const bountyPerf = secBounty?.getPerformance?.() ?? { totalActions: 0, successRate: 0, totalReward: 0 };
    const servicePerf = secService?.getPerformance?.() ?? { totalActions: 0, successRate: 0, totalReward: 0 };

    const queueSize = secService?.getScanQueue?.()?.length ?? 0;

    const message = [
      "<b>Security Strategies Overview</b>",
      "",
      "<b>Bug Bounty Hunting:</b>",
      `  Status: ${secBounty?.enabled ? "Active" : "Inactive"}`,
      `  Submissions: ${bountyPerf.totalActions}`,
      `  Rewards: ${bountyPerf.totalReward.toFixed(4)} SOL`,
      "",
      "<b>Security Scanning Service:</b>",
      `  Status: ${secService?.enabled ? "Active" : "Inactive"}`,
      `  Scans Completed: ${servicePerf.totalActions}`,
      `  Queue: ${queueSize} pending`,
      `  Revenue: ${servicePerf.totalReward.toFixed(4)} SOL`,
      "",
      `<b>Total Security Revenue: ${(bountyPerf.totalReward + servicePerf.totalReward).toFixed(4)} SOL</b>`,
    ].join("\n");

    await ctx.reply(message, { parse_mode: "HTML" });
  });
}
