import { EventEmitter } from "events";
import { config } from "../config.js";
import { createLogger } from "./logger.js";
import { MemorySystem } from "./memory.js";
import { Scheduler } from "./scheduler.js";
import { WalletManager } from "./wallet.js";
import { RiskManager, type RiskLimits, type TradeCheck } from "./risk.js";
import { LearningSystem } from "./learning.js";
import { chat } from "../integrations/openrouter.js";
import type {
  AgentState,
  Strategy,
  StrategyResult,
  LLMMessage,
} from "../types/index.js";

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
    this.memory = new MemorySystem();
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

  registerStrategy(strategy: Strategy): void {
    this.strategies.set(strategy.name, strategy);
    logger.info(`Registered strategy: ${strategy.name}`);
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
      llm: chat,
      memory: this.memory,
    });

    // Register the main evaluation loop (every 30 seconds)
    this.scheduler.registerTask(
      "evaluate-strategies",
      "*/30 * * * * *",
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

    const opportunities: Array<{
      strategy: Strategy;
      result: StrategyResult;
    }> = [];

    for (const [name, strategy] of this.strategies) {
      if (!strategy.enabled) continue;

      try {
        const result = await strategy.evaluate();
        if (result && result.confidence > 0.5) {
          opportunities.push({ strategy, result });
          logger.info(`Opportunity found: ${name}`, {
            confidence: result.confidence,
            expectedReward: result.expectedReward,
          });
        }
      } catch (error) {
        logger.error(`Strategy "${name}" evaluation failed`, {
          error: (error as Error).message,
        });
      }
    }

    if (opportunities.length > 0) {
      await this.executeOpportunity(opportunities);
    } else {
      this.status = "idle";
    }
  }

  private async executeOpportunity(
    opportunities: Array<{ strategy: Strategy; result: StrategyResult }>
  ): Promise<void> {
    this.status = "executing";

    try {
      // Use LLM to rank opportunities if multiple exist
      let selected = opportunities[0];

      if (opportunities.length > 1) {
        const messages: LLMMessage[] = [
          {
            role: "system",
            content:
              "You are an AI agent evaluating trading opportunities. Respond with only the index (0-based) of the best opportunity to execute, considering risk/reward ratio and confidence.",
          },
          {
            role: "user",
            content: `Choose the best opportunity:\n${opportunities
              .map(
                (o, i) =>
                  `${i}. ${o.strategy.name}: ${o.result.opportunity} (confidence: ${o.result.confidence}, expected reward: ${o.result.expectedReward}, risk: ${o.result.risk})`
              )
              .join("\n")}`,
          },
        ];

        try {
          const llmResponse = await chat(messages, { temperature: 0.3 });
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

      // Record in risk manager
      this.riskManager.recordTrade(
        exposureAmount,
        executionResult.profitLoss
      );

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
