import { EventEmitter } from "events";
import { config } from "../config.js";
import { createLogger } from "./logger.js";
import { MemorySystem } from "./memory.js";
import { Scheduler } from "./scheduler.js";
import { WalletManager } from "./wallet.js";
import { RiskManager, type RiskLimits, type TradeCheck } from "./risk.js";
import { LearningSystem } from "./learning.js";
import { StrategyPriorityManager } from "./strategy-priority.js";
import { FallbackSystem } from "./fallback.js";
import { routedChat } from "./llm-router.js";
import type {
  AgentState,
  Strategy,
  StrategyResult,
  LLMMessage,
} from "../types/index.js";
import { PriorityTier, TaskComplexity } from "../types/index.js";

const logger = createLogger("agent");

const LOW_BALANCE_THRESHOLD = 0.2; // SOL
const HEALTH_CHECK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export interface AgentOptions {
  riskLimits?: Partial<RiskLimits>;
  learningIntervalHours?: number;
}

export class AgentController extends EventEmitter {
  private memory: MemorySystem;
  private wallet: WalletManager;
  private scheduler: Scheduler;
  private riskManager!: RiskManager;
  private learningSystem!: LearningSystem;
  private priorityManager!: StrategyPriorityManager;
  private fallbackSystem!: FallbackSystem;
  private currentEvalIntervalSeconds: number = 30;
  private strategies: Map<string, Strategy> = new Map();
  private status: AgentState["status"] = "idle";
  private startTime: number = 0;
  private lastAction?: string;
  private lastSuccessfulCycle: number = 0;
  private running: boolean = false;
  private options: AgentOptions;

  constructor(options?: AgentOptions) {
    super();
    this.options = options ?? {};
    this.memory = new MemorySystem(undefined, routedChat);
    this.wallet = new WalletManager(this.memory);
    this.scheduler = new Scheduler();
  }

  getMemory(): MemorySystem {
    return this.memory;
  }

  getWallet(): WalletManager {
    return this.wallet;
  }

  getScheduler(): Scheduler {
    return this.scheduler;
  }

  getRiskManager(): RiskManager {
    return this.riskManager;
  }

  getLearningSystem(): LearningSystem {
    return this.learningSystem;
  }

  getPriorityManager(): StrategyPriorityManager {
    return this.priorityManager;
  }

  getFallbackSystem(): FallbackSystem {
    return this.fallbackSystem;
  }

  registerStrategy(strategy: Strategy): void {
    this.strategies.set(strategy.name, strategy);
    logger.info(`Registered strategy: ${strategy.name}`);
  }

  getStrategy(name: string): Strategy | undefined {
    return this.strategies.get(name);
  }

  removeStrategy(name: string): void {
    this.strategies.delete(name);
    logger.info(`Removed strategy: ${name}`);
  }

  async start(): Promise<void> {
    this.startTime = Date.now();
    this.running = true;
    this.status = "idle";

    logger.info(`${config.AGENT_NAME} starting...`);

    // Initialize risk manager with current balance
    let balance = 0;
    try {
      balance = await this.wallet.getBalance();
    } catch {
      balance = 5.0; // Default starting balance assumption
      logger.warn("Could not fetch balance, using default for risk manager");
    }

    this.riskManager = new RiskManager(
      balance,
      this.options.riskLimits,
      this.memory
    );

    // Initialize learning system
    this.learningSystem = new LearningSystem({
      llm: routedChat,
      memory: this.memory,
    });

    // Initialize priority manager
    this.priorityManager = new StrategyPriorityManager({
      memory: this.memory,
    });

    // Initialize fallback system
    this.fallbackSystem = new FallbackSystem({
      memory: this.memory,
      onModeChange: (oldMode, newMode) => {
        this.emit("alert", {
          type: "mode_change",
          message: `Operating mode changed: ${oldMode} -> ${newMode}`,
        });
      },
    });

    // Load priority data and set initial mode
    this.priorityManager.loadFromDatabase();
    this.fallbackSystem.checkAndUpdateMode();
    this.currentEvalIntervalSeconds =
      this.fallbackSystem.getEvaluationIntervalSeconds();

    // Register the main evaluation loop (dynamic interval)
    this.scheduler.registerTask(
      "evaluate-strategies",
      `*/${this.currentEvalIntervalSeconds} * * * * *`,
      async () => {
        if (this.status === "executing") return;
        await this.evaluateStrategies();
      }
    );

    // Register the learning loop (default every 6 hours)
    const learningHours = this.options.learningIntervalHours ?? 6;
    this.scheduler.registerTask(
      "learning-cycle",
      `0 */${learningHours} * * *`,
      async () => {
        await this.runLearningCycle();
      }
    );

    // Daily P&L reset at midnight
    this.scheduler.registerTask("daily-reset", "0 0 * * *", () => {
      this.riskManager.resetDaily();
      logger.info("Daily risk counters reset at midnight");
    });

    // Daily database pruning at 1 AM - keep last 30 days of data
    this.scheduler.registerTask("db-prune", "0 1 * * *", () => {
      try {
        this.memory.prune(30);
        logger.info("Database pruning completed (30 day retention)");
      } catch (error) {
        logger.error("Database pruning failed", {
          error: (error as Error).message,
        });
      }
    });

    // Balance check every 5 minutes
    this.scheduler.registerTask("balance-check", "*/5 * * * *", async () => {
      await this.checkBalance();
    });

    // Health monitoring every 2 minutes
    this.scheduler.registerTask("health-monitor", "*/2 * * * *", () => {
      this.checkHealth();
    });

    // Priority recalculation every 30 minutes
    this.scheduler.registerTask("priority-recalculation", "*/30 * * * *", () => {
      const strategyNames = Array.from(this.strategies.keys());
      this.priorityManager.recalculateAll(strategyNames);
    });

    // Fallback mode check every 10 minutes
    this.scheduler.registerTask("fallback-check", "*/10 * * * *", () => {
      const oldInterval = this.currentEvalIntervalSeconds;
      this.fallbackSystem.checkAndUpdateMode();
      const newInterval = this.fallbackSystem.getEvaluationIntervalSeconds();

      if (newInterval !== oldInterval) {
        this.currentEvalIntervalSeconds = newInterval;
        // Re-register evaluate-strategies with new interval
        this.scheduler.removeTask("evaluate-strategies");
        this.scheduler.registerTask(
          "evaluate-strategies",
          `*/${newInterval} * * * * *`,
          async () => {
            if (this.status === "executing") return;
            await this.evaluateStrategies();
          }
        );
        logger.info(
          `Evaluation interval changed: ${oldInterval}s -> ${newInterval}s`
        );
      }
    });

    // Memory maintenance every hour
    this.scheduler.registerTask("memory-maintenance", "0 * * * *", () => {
      try {
        const evicted = this.memory.runMaintenance();
        if (evicted > 0) {
          logger.info(`Memory maintenance: evicted ${evicted} stale memories`);
        }
      } catch (error) {
        logger.error("Memory maintenance failed", { error: (error as Error).message });
      }
    });

    this.scheduler.startAll();
    this.lastSuccessfulCycle = Date.now();
    this.emit("started");
    logger.info(`${config.AGENT_NAME} started successfully`);
  }

  async stop(): Promise<void> {
    logger.info(`${config.AGENT_NAME} shutting down...`);
    this.running = false;

    // 1. Stop scheduler (no new tasks)
    this.scheduler.stopAll();

    // 2. Stop strategies (graceful wind-down)
    for (const [name, strategy] of this.strategies) {
      try {
        strategy.enabled = false;
        logger.debug(`Strategy "${name}" disabled for shutdown`);
      } catch (error) {
        logger.error(`Error disabling strategy "${name}"`, {
          error: (error as Error).message,
        });
      }
    }

    // 3. Close database
    this.memory.close();

    this.status = "idle";
    this.emit("stopped");
    logger.info(`${config.AGENT_NAME} stopped`);
  }

  async evaluateStrategies(): Promise<void> {
    if (!this.running) return;

    this.status = "evaluating";
    this.lastSuccessfulCycle = Date.now();

    const confidenceThreshold = this.fallbackSystem.getConfidenceThreshold();
    const skipLowPriority = this.fallbackSystem.shouldSkipLowPriority();
    const prioritizedStrategies =
      this.priorityManager.getPrioritizedStrategies();

    const opportunities: Array<{
      strategy: Strategy;
      result: StrategyResult;
      priority: { tier: PriorityTier; score: number };
    }> = [];

    for (const [name, strategy] of this.strategies) {
      if (!strategy.enabled) continue;

      // Check priority tier - skip low/dormant in normal mode
      if (skipLowPriority) {
        const priorityRecord = prioritizedStrategies.find(
          (p) => p.strategy === name
        );
        if (
          priorityRecord &&
          (priorityRecord.tier === PriorityTier.LOW ||
            priorityRecord.tier === PriorityTier.DORMANT)
        ) {
          continue;
        }
      }

      try {
        const result = await strategy.evaluate();
        if (result && result.confidence > confidenceThreshold) {
          const priorityRecord = prioritizedStrategies.find(
            (p) => p.strategy === name
          );
          opportunities.push({
            strategy,
            result,
            priority: {
              tier: priorityRecord?.tier ?? PriorityTier.MEDIUM,
              score: priorityRecord?.score ?? 0.5,
            },
          });
          logger.info(`Opportunity found: ${name}`, {
            confidence: result.confidence,
            expectedReward: result.expectedReward,
            tier: priorityRecord?.tier ?? "MEDIUM",
          });
        }
      } catch (error) {
        logger.error(`Strategy "${name}" evaluation failed`, {
          error: (error as Error).message,
        });
      }
    }

    if (opportunities.length > 0) {
      // Sort by priority tier then score before execution
      opportunities.sort((a, b) => {
        const tierOrder: Record<PriorityTier, number> = {
          [PriorityTier.CRITICAL]: 0,
          [PriorityTier.HIGH]: 1,
          [PriorityTier.MEDIUM]: 2,
          [PriorityTier.LOW]: 3,
          [PriorityTier.DORMANT]: 4,
        };
        const tierDiff = tierOrder[a.priority.tier] - tierOrder[b.priority.tier];
        if (tierDiff !== 0) return tierDiff;
        return b.priority.score - a.priority.score;
      });
      await this.executeOpportunity(opportunities);
    } else {
      this.status = "idle";
    }
  }

  private async executeOpportunity(
    opportunities: Array<{
      strategy: Strategy;
      result: StrategyResult;
      priority: { tier: PriorityTier; score: number };
    }>
  ): Promise<void> {
    this.status = "executing";

    let selected = opportunities[0];
    try {

      if (opportunities.length > 1) {
        const messages: LLMMessage[] = [
          {
            role: "system",
            content:
              "You are an AI agent evaluating trading opportunities. Respond with only the index (0-based) of the best opportunity to execute, considering risk/reward ratio, confidence, and priority tier.",
          },
          {
            role: "user",
            content: `Choose the best opportunity:\n${opportunities
              .map(
                (o, i) =>
                  `${i}. ${o.strategy.name}: ${o.result.opportunity} (confidence: ${o.result.confidence}, reward: ${o.result.expectedReward}, risk: ${o.result.risk}, tier: ${o.priority.tier}, priority_score: ${o.priority.score.toFixed(2)})`
              )
              .join("\n")}`,
          },
        ];

        try {
          const llmResponse = await routedChat(messages, { temperature: 0.3, taskComplexity: TaskComplexity.STANDARD });
          const index = parseInt(llmResponse.content.trim(), 10);
          if (!isNaN(index) && index >= 0 && index < opportunities.length) {
            selected = opportunities[index];
          }
        } catch (error) {
          logger.warn("LLM ranking failed, using first opportunity", {
            error: (error as Error).message,
          });
        }
      }

      // Risk check before execution
      const tradeAmount = selected.result.expectedReward;
      const riskCheck: TradeCheck = this.riskManager.canTrade(
        Math.abs(tradeAmount)
      );

      if (!riskCheck.allowed) {
        logger.warn("Trade blocked by risk manager", {
          strategy: selected.strategy.name,
          reason: riskCheck.reason,
        });
        this.emit("alert", {
          type: "risk_blocked",
          strategy: selected.strategy.name,
          message: riskCheck.reason,
        });
        this.status = "idle";
        return;
      }

      // Record the decision
      const decisionId = this.memory.recordDecision({
        strategy: selected.strategy.name,
        action: selected.result.opportunity,
        reasoning: `Confidence: ${selected.result.confidence}, Expected reward: ${selected.result.expectedReward}`,
      });

      // Track exposure: open position before execution
      const exposureAmount = Math.abs(tradeAmount);
      this.riskManager.openPosition(exposureAmount);

      let executionResult;
      try {
        // Execute
        executionResult = await selected.strategy.execute(selected.result);
      } finally {
        // Close position after execution completes (success or failure)
        this.riskManager.closePosition(exposureAmount);
      }

      // Record outcome
      this.memory.recordOutcome(
        decisionId,
        executionResult.success ? "success" : "failure",
        executionResult.profitLoss
      );

      // Capture observation for advanced memory
      try {
        await this.memory.captureObservation(
          `Strategy ${selected.strategy.name} executed: ${selected.result.opportunity}. Result: ${executionResult.success ? "success" : "failure"}, P/L: ${executionResult.profitLoss}`,
          { strategy: selected.strategy.name, success: executionResult.success, profitLoss: executionResult.profitLoss }
        );
      } catch (obsError) {
        logger.warn("Failed to capture observation", { error: (obsError as Error).message });
      }

      // Record in risk manager
      this.riskManager.recordTrade(
        exposureAmount,
        executionResult.profitLoss
      );

      // Track priority
      if (executionResult.success && executionResult.profitLoss > 0) {
        this.priorityManager.recordSuccess(selected.strategy.name);
      } else {
        this.priorityManager.recordFailure(selected.strategy.name);
      }

      this.lastAction = `${selected.strategy.name}: ${selected.result.opportunity}`;

      if (executionResult.profitLoss !== 0) {
        const alertType = executionResult.profitLoss > 0 ? "profit" : "loss";
        this.emit("alert", {
          type: alertType,
          strategy: selected.strategy.name,
          amount: executionResult.profitLoss,
          details: executionResult.notes,
        });
      }

      logger.info(`Execution complete`, {
        strategy: selected.strategy.name,
        success: executionResult.success,
        profitLoss: executionResult.profitLoss,
      });
    } catch (error) {
      this.status = "error";
      // Track the failure for priority system
      if (selected) {
        this.priorityManager.recordFailure(selected.strategy.name);
      }
      logger.error("Execution failed", {
        error: (error as Error).message,
      });
      this.emit("alert", {
        type: "error",
        message: (error as Error).message,
      });
    } finally {
      this.status = "idle";
    }
  }

  private async runLearningCycle(): Promise<void> {
    try {
      const insights = await this.learningSystem.runLearningCycle();
      if (insights.length > 0) {
        this.emit("alert", {
          type: "learning_complete",
          message: `Learning cycle completed: ${insights.length} insights extracted`,
        });
      }
    } catch (error) {
      logger.error("Learning cycle failed", {
        error: (error as Error).message,
      });
    }
  }

  private async checkBalance(): Promise<void> {
    try {
      const balance = await this.wallet.getBalance();
      this.riskManager.updateBalance(balance);

      if (balance < LOW_BALANCE_THRESHOLD) {
        this.emit("alert", {
          type: "low_balance",
          message: `Low balance warning: ${balance.toFixed(4)} SOL`,
          amount: balance,
        });
      }
    } catch (error) {
      logger.error("Balance check failed", {
        error: (error as Error).message,
      });
    }
  }

  private checkHealth(): void {
    const timeSinceLastCycle = Date.now() - this.lastSuccessfulCycle;
    if (timeSinceLastCycle > HEALTH_CHECK_TIMEOUT_MS && this.running) {
      logger.error("Agent appears stuck - no successful cycle in 10 minutes");
      this.emit("alert", {
        type: "error",
        message: `Agent health warning: no successful cycle in ${Math.floor(timeSinceLastCycle / 60000)} minutes`,
      });
    }
  }

  async getState(): Promise<AgentState> {
    let balance = 0;
    try {
      balance = await this.wallet.getBalance();
    } catch {
      // Balance check may fail if no connection
    }

    return {
      status: this.status,
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
      balance,
      activeStrategies: Array.from(this.strategies.entries())
        .filter(([_, s]) => s.enabled)
        .map(([name]) => name),
      lastAction: this.lastAction,
    };
  }
}
