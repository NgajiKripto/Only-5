import type { MemorySystem, DecisionRecord } from "./memory.js";
import { createLogger } from "./logger.js";
import type { LLMMessage, LLMResponse } from "../types/index.js";

const logger = createLogger("learning");

export interface LearningInsight {
  strategy: string;
  pattern: string;
  recommendation: string;
  confidence: number;
}

export interface LearningDependencies {
  llm: (messages: LLMMessage[], options?: { temperature?: number; maxTokens?: number }) => Promise<LLMResponse>;
  memory: MemorySystem;
}

export class LearningSystem {
  private llm: LearningDependencies["llm"];
  private memory: MemorySystem;
  private confidenceScores: Map<string, number> = new Map();

  constructor(deps: LearningDependencies) {
    this.llm = deps.llm;
    this.memory = deps.memory;
  }

  async runLearningCycle(): Promise<LearningInsight[]> {
    logger.info("Starting learning cycle");

    try {
      const decisions = this.getRecentDecisions();

      if (decisions.length === 0) {
        logger.info("No recent decisions to analyze");
        return [];
      }

      const grouped = this.groupByStrategy(decisions);

      const messages: LLMMessage[] = [
        {
          role: "system",
          content:
            "You are an AI analyzing trading/task decisions for an autonomous agent. " +
            "Analyze the decisions and outcomes below. Identify patterns: what worked, what failed. " +
            "Respond in JSON format: {\"insights\": [{\"strategy\": \"name\", \"pattern\": \"description\", \"recommendation\": \"action\", \"confidence\": 0.0-1.0}]}",
        },
        {
          role: "user",
          content: `Analyze these recent decisions grouped by strategy:\n${JSON.stringify(grouped, null, 2)}`,
        },
      ];

      const response = await this.llm(messages, { temperature: 0.4, maxTokens: 1024 });
      const insights = this.parseInsights(response.content);

      await this.persistLearnings(insights);

      // Trigger consolidation after persisting insights
      try {
        await this.memory.runConsolidation();
      } catch (consolidationError) {
        logger.warn("Consolidation during learning cycle failed", { error: (consolidationError as Error).message });
      }

      logger.info(`Learning cycle complete: ${insights.length} insights extracted`);
      return insights;
    } catch (error) {
      logger.error("Learning cycle failed", { error: (error as Error).message });
      return [];
    }
  }

  extractPatterns(decisions: DecisionRecord[]): Map<string, { successes: number; failures: number; avgReward: number }> {
    const patterns = new Map<string, { successes: number; failures: number; avgReward: number }>();

    for (const decision of decisions) {
      const key = decision.strategy;
      const existing = patterns.get(key) ?? { successes: 0, failures: 0, avgReward: 0 };

      if (decision.outcome === "success") {
        existing.successes++;
      } else if (decision.outcome === "failure") {
        existing.failures++;
      }

      if (decision.reward !== undefined && decision.reward !== null) {
        const total = existing.successes + existing.failures;
        existing.avgReward =
          (existing.avgReward * (total - 1) + decision.reward) / total;
      }

      patterns.set(key, existing);
    }

    return patterns;
  }

  updateConfidence(strategy: string, direction: "up" | "down"): number {
    const current = this.confidenceScores.get(strategy) ?? 0.5;
    const step = 0.05;
    const updated = direction === "up"
      ? Math.min(1.0, current + step)
      : Math.max(0.0, current - step);

    this.confidenceScores.set(strategy, updated);
    logger.debug(`Confidence for "${strategy}" updated: ${current} -> ${updated}`);
    return updated;
  }

  getConfidence(strategy: string): number {
    return this.confidenceScores.get(strategy) ?? 0.5;
  }

  async triggerConsolidation(): Promise<void> {
    await this.memory.runConsolidation();
  }

  getInsights(strategy?: string): LearningInsight[] {
    const observations = this.memory.recall("learning_insights", 50);

    const insights: LearningInsight[] = [];
    for (const obs of observations) {
      try {
        const parsed = JSON.parse(obs.content) as LearningInsight;
        if (!strategy || parsed.strategy === strategy) {
          insights.push(parsed);
        }
      } catch {
        // Skip malformed entries
      }
    }

    return insights;
  }

  async persistLearnings(insights: LearningInsight[]): Promise<void> {
    for (const insight of insights) {
      // Store as observation for retrieval
      this.memory.remember("learning_insights", JSON.stringify(insight));

      // Update confidence based on insight
      if (insight.confidence > 0.7) {
        this.updateConfidence(insight.strategy, "up");
      } else if (insight.confidence < 0.3) {
        this.updateConfidence(insight.strategy, "down");
      }

      // Store as a skill for the strategy
      this.memory.saveSkill({
        name: `insight_${insight.strategy}_${Date.now()}`,
        description: insight.pattern,
        code: insight.recommendation,
        success_rate: insight.confidence,
        uses: 0,
      });
    }

    logger.debug(`Persisted ${insights.length} learning insights`);
  }

  private getRecentDecisions(): DecisionRecord[] {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // last 24 hours
    const decisions = this.memory.getRecentDecisions(50);

    return decisions.filter((d) => d.timestamp >= cutoff);
  }

  private groupByStrategy(decisions: DecisionRecord[]): Record<string, DecisionRecord[]> {
    const grouped: Record<string, DecisionRecord[]> = {};

    for (const decision of decisions) {
      const key = decision.strategy;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(decision);
    }

    return grouped;
  }

  private parseInsights(content: string): LearningInsight[] {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]) as { insights?: LearningInsight[] };
      if (!parsed.insights || !Array.isArray(parsed.insights)) return [];

      return parsed.insights.filter(
        (i) =>
          typeof i.strategy === "string" &&
          typeof i.pattern === "string" &&
          typeof i.recommendation === "string" &&
          typeof i.confidence === "number"
      );
    } catch {
      logger.warn("Failed to parse LLM insights response");
      return [];
    }
  }
}
