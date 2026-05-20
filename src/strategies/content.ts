// TODO: Connect to publishing platform (e.g., mirror.xyz, Substack API) to monetize content
import { BaseStrategy, type StrategyDependencies } from "./base.js";
import { RiskLevel, type StrategyResult, type ExecutionResult } from "../types/index.js";
import { getTokenPrice } from "../integrations/jupiter.js";

type ContentType = "market_analysis" | "protocol_deep_dive" | "yield_guide" | "technical_tutorial";

const SOL_MINT = "So11111111111111111111111111111111111111112";

const CONTENT_TYPES: ContentType[] = [
  "market_analysis",
  "protocol_deep_dive",
  "yield_guide",
  "technical_tutorial",
];

export class ContentStrategy extends BaseStrategy {
  name = "content";
  description = "Generate crypto market analysis and DeFi content for monetization";
  riskLevel = RiskLevel.LOW;
  minBalance = 0; // No balance needed - this is content work

  private contentTypes: ContentType[];

  constructor(deps: StrategyDependencies) {
    super(deps);
    this.contentTypes =
      (deps.config?.contentTypes as ContentType[]) ?? CONTENT_TYPES;
  }

  async evaluate(): Promise<StrategyResult | null> {
    try {
      // Get current market data to inform content
      const solPrice = await getTokenPrice(SOL_MINT);

      // Check what content we've generated recently
      const recentContent = this.memory.recall("content_generated", 10);
      const recentTypes = new Set<string>();
      for (const record of recentContent) {
        try {
          const data = JSON.parse(record.content) as { type: string };
          recentTypes.add(data.type);
        } catch {
          // Skip malformed
        }
      }

      // Find a content type we haven't done recently
      const nextType = this.contentTypes.find((t) => !recentTypes.has(t));
      const contentType = nextType ?? this.contentTypes[0];

      // Use LLM to identify trending topic
      const topicResponse = await this.askLLM(
        `What is a trending topic in crypto/DeFi right now that would make good ${contentType.replace("_", " ")} content? SOL price: ${solPrice ?? "unknown"}. Respond with just the topic in one sentence.`
      );

      return {
        opportunity: `Generate ${contentType.replace("_", " ")}: ${topicResponse.content.substring(0, 100)}`,
        confidence: 0.7,
        expectedReward: 0, // Revenue depends on platform/audience
        risk: RiskLevel.LOW,
      };
    } catch (error) {
      this.logger.error("Content evaluation failed", {
        error: (error as Error).message,
      });
      return null;
    }
  }

  async execute(opportunity: StrategyResult): Promise<ExecutionResult> {
    try {
      // Determine content type from opportunity
      const contentType = this.detectContentType(opportunity.opportunity);

      // Gather market data for context
      const solPrice = await getTokenPrice(SOL_MINT);

      // Generate content using LLM
      const prompt = this.buildContentPrompt(
        contentType,
        opportunity.opportunity,
        solPrice
      );
      const response = await this.askLLM(prompt);

      // Record the generated content
      this.memory.remember(
        "content_generated",
        JSON.stringify({
          type: contentType,
          topic: opportunity.opportunity.substring(0, 200),
          length: response.content.length,
          timestamp: Date.now(),
        })
      );

      this.logger.info(`Generated ${contentType} content`, {
        length: response.content.length,
      });

      return {
        success: true,
        profitLoss: 0,
        notes: `Content generated but not yet published - awaiting platform integration. Preview:\n${response.content.substring(0, 500)}`,
      };
    } catch (error) {
      this.logger.error("Content execution failed", {
        error: (error as Error).message,
      });
      return {
        success: false,
        profitLoss: 0,
        notes: `Content generation failed: ${(error as Error).message}`,
      };
    }
  }

  private detectContentType(opportunity: string): ContentType {
    const lower = opportunity.toLowerCase();
    if (lower.includes("market analysis") || lower.includes("market_analysis")) {
      return "market_analysis";
    }
    if (lower.includes("protocol") || lower.includes("deep dive") || lower.includes("deep_dive")) {
      return "protocol_deep_dive";
    }
    if (lower.includes("yield") || lower.includes("guide")) {
      return "yield_guide";
    }
    if (lower.includes("tutorial") || lower.includes("technical")) {
      return "technical_tutorial";
    }
    return "market_analysis";
  }

  private buildContentPrompt(
    contentType: ContentType,
    topic: string,
    solPrice: number | null
  ): string {
    const marketContext = solPrice
      ? `Current SOL price: $${solPrice.toFixed(2)}.`
      : "";

    switch (contentType) {
      case "market_analysis":
        return `Write a concise crypto market analysis (300-500 words) on: ${topic}. ${marketContext} Include key data points, trends, and actionable insights.`;
      case "protocol_deep_dive":
        return `Write a protocol deep-dive (400-600 words) on: ${topic}. ${marketContext} Cover mechanics, risks, and opportunities for users.`;
      case "yield_guide":
        return `Write a DeFi yield strategy guide (300-500 words) on: ${topic}. ${marketContext} Include step-by-step instructions, risks, and expected returns.`;
      case "technical_tutorial":
        return `Write a technical tutorial (400-600 words) on: ${topic}. ${marketContext} Include code examples where relevant and clear explanations.`;
    }
  }
}
