// TODO: Connect to microtask marketplace (e.g., Effect Network, Microworkers API) to submit and earn from tasks
import { BaseStrategy, type StrategyDependencies } from "./base.js";
import { RiskLevel, type StrategyResult, type ExecutionResult } from "../types/index.js";

type TaskCategory = "writing" | "coding" | "data_analysis" | "research";

interface TaskSource {
  name: string;
  url: string;
  categories: TaskCategory[];
}

const DEFAULT_TASK_SOURCES: TaskSource[] = [
  {
    name: "generic_writing",
    url: "https://tasks.example.com/writing",
    categories: ["writing"],
  },
  {
    name: "generic_coding",
    url: "https://tasks.example.com/coding",
    categories: ["coding"],
  },
  {
    name: "generic_research",
    url: "https://tasks.example.com/research",
    categories: ["research", "data_analysis"],
  },
];

const DEFAULT_MIN_REWARD = 0.01; // Minimum 0.01 SOL reward

export class MicrotaskStrategy extends BaseStrategy {
  name = "microtask";
  description = "Complete micro-tasks for crypto rewards including writing, coding, and research";
  riskLevel = RiskLevel.LOW;
  minBalance = 0; // No balance needed

  private taskSources: TaskSource[];
  private minReward: number;
  private categories: TaskCategory[];

  constructor(deps: StrategyDependencies) {
    super(deps);
    this.taskSources =
      (deps.config?.taskSources as TaskSource[]) ?? DEFAULT_TASK_SOURCES;
    this.minReward =
      (deps.config?.minReward as number) ?? DEFAULT_MIN_REWARD;
    this.categories =
      (deps.config?.categories as TaskCategory[]) ?? [
        "writing",
        "coding",
        "data_analysis",
        "research",
      ];
  }

  async evaluate(): Promise<StrategyResult | null> {
    try {
      // Check recent task completions to avoid overloading
      const recentTasks = this.memory.recall("microtask_completed", 10);
      const recentCount = recentTasks.filter((t) => {
        try {
          const data = JSON.parse(t.content) as { timestamp: number };
          return Date.now() - data.timestamp < 60 * 60 * 1000; // Last hour
        } catch {
          return false;
        }
      }).length;

      // Don't do more than 5 tasks per hour
      if (recentCount >= 5) {
        this.logger.debug("Task rate limit reached");
        return null;
      }

      // Use LLM to identify best task category given current market conditions
      const response = await this.askLLM(
        `Given your capabilities (writing, coding, data analysis, research), which type of micro-task would be most valuable to complete right now in the crypto/web3 space? Pick one category and suggest a specific task. Keep it brief.`
      );

      const category = this.detectCategory(response.content);

      return {
        opportunity: `Micro-task (${category}): ${response.content.substring(0, 150)}`,
        confidence: 0.65,
        expectedReward: this.minReward,
        risk: RiskLevel.LOW,
      };
    } catch (error) {
      this.logger.error("Microtask evaluation failed", {
        error: (error as Error).message,
      });
      return null;
    }
  }

  async execute(opportunity: StrategyResult): Promise<ExecutionResult> {
    try {
      const category = this.detectCategory(opportunity.opportunity);

      // Use LLM to generate the task solution
      const prompt = this.buildTaskPrompt(category, opportunity.opportunity);
      const response = await this.askLLM(prompt);

      // Record completion
      this.memory.remember(
        "microtask_completed",
        JSON.stringify({
          category,
          opportunity: opportunity.opportunity.substring(0, 200),
          outputLength: response.content.length,
          timestamp: Date.now(),
        })
      );

      // Track performance
      const perf = this.getPerformance();
      this.logger.info(`Microtask completed`, {
        category,
        totalCompleted: perf.totalActions + 1,
      });

      return {
        success: false,
        profitLoss: 0,
        notes: `Analysis only - no submission endpoint configured. Task completed locally but not submitted (${category}):\n${response.content.substring(0, 1000)}`,
      };
    } catch (error) {
      this.logger.error("Microtask execution failed", {
        error: (error as Error).message,
      });
      return {
        success: false,
        profitLoss: 0,
        notes: `Task execution failed: ${(error as Error).message}`,
      };
    }
  }

  private detectCategory(text: string): TaskCategory {
    const lower = text.toLowerCase();
    if (lower.includes("coding") || lower.includes("code") || lower.includes("program")) {
      return "coding";
    }
    if (lower.includes("research") || lower.includes("investigate")) {
      return "research";
    }
    if (lower.includes("data") || lower.includes("analysis") || lower.includes("analyze")) {
      return "data_analysis";
    }
    return "writing";
  }

  private buildTaskPrompt(category: TaskCategory, opportunity: string): string {
    switch (category) {
      case "writing":
        return `Complete this writing task for the crypto/web3 space. Produce high-quality, clear content:\n\n${opportunity}`;
      case "coding":
        return `Complete this coding task. Write clean, well-documented code:\n\n${opportunity}`;
      case "data_analysis":
        return `Complete this data analysis task. Provide clear findings with supporting evidence:\n\n${opportunity}`;
      case "research":
        return `Complete this research task. Provide thorough analysis with key findings:\n\n${opportunity}`;
    }
  }

  /** Get configured minimum reward threshold for testing */
  getMinReward(): number {
    return this.minReward;
  }
}
