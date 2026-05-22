import type { MemorySystem, StrategyPerformance } from "../core/memory.js";
import type { WalletManager } from "../core/wallet.js";
import type { LLMMessage, LLMResponse, Strategy, StrategyResult, ExecutionResult, RiskLevel, RouterOptions } from "../types/index.js";
import { TaskComplexity } from "../types/index.js";
import { createLogger } from "../core/logger.js";

export interface StrategyDependencies {
  llm: (messages: LLMMessage[], options?: RouterOptions | { temperature?: number; maxTokens?: number; model?: string }) => Promise<LLMResponse>;
  memory: MemorySystem;
  wallet: WalletManager;
  logger: ReturnType<typeof createLogger>;
  config?: Record<string, unknown>;
}

export abstract class BaseStrategy implements Strategy {
  abstract name: string;
  abstract description: string;
  abstract riskLevel: RiskLevel;
  abstract minBalance: number;

  enabled: boolean = true;

  protected llm: StrategyDependencies["llm"];
  protected memory: MemorySystem;
  protected wallet: WalletManager;
  protected logger: ReturnType<typeof createLogger>;
  protected strategyConfig: Record<string, unknown>;

  constructor(deps: StrategyDependencies) {
    this.llm = deps.llm;
    this.memory = deps.memory;
    this.wallet = deps.wallet;
    this.logger = deps.logger;
    this.strategyConfig = deps.config ?? {};
  }

  abstract evaluate(): Promise<StrategyResult | null>;
  abstract execute(opportunity: StrategyResult): Promise<ExecutionResult>;

  getStatus(): string {
    const perf = this.memory.getStrategyPerformance(this.name);
    return JSON.stringify({
      name: this.name,
      enabled: this.enabled,
      riskLevel: this.riskLevel,
      totalActions: perf.totalActions,
      successRate: perf.successRate,
      totalReward: perf.totalReward,
    });
  }

  enable(): void {
    this.enabled = true;
    this.logger.info(`Strategy "${this.name}" enabled`);
  }

  disable(): void {
    this.enabled = false;
    this.logger.info(`Strategy "${this.name}" disabled`);
  }

  getPerformance(): StrategyPerformance {
    return this.memory.getStrategyPerformance(this.name);
  }

  protected async askLLM(prompt: string): Promise<LLMResponse> {
    const messages: LLMMessage[] = [
      {
        role: "system",
        content: `You are an AI assistant helping the "${this.name}" strategy of an autonomous agent. ${this.description}. Be concise and actionable.`,
      },
      {
        role: "user",
        content: prompt,
      },
    ];

    return this.llm(messages, { temperature: 0.5, taskComplexity: TaskComplexity.STANDARD });
  }
}
