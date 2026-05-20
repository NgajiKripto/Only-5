import { EventEmitter } from "events";
import { config } from "../config.js";
import { createLogger } from "./logger.js";
import { MemorySystem } from "./memory.js";
import { Scheduler } from "./scheduler.js";
import { WalletManager } from "./wallet.js";
import { chat } from "../integrations/openrouter.js";
import type {
  AgentState,
  Strategy,
  StrategyResult,
  LLMMessage,
} from "../types/index.js";

const logger = createLogger("agent");

export class AgentController extends EventEmitter {
  private memory: MemorySystem;
  private wallet: WalletManager;
  private scheduler: Scheduler;
  private strategies: Map<string, Strategy> = new Map();
  private status: AgentState["status"] = "idle";
  private startTime: number = 0;
  private lastAction?: string;
  private running: boolean = false;

  constructor() {
    super();
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

    // Register the main evaluation loop (every 30 seconds)
    this.scheduler.registerTask(
      "evaluate-strategies",
      "*/30 * * * * *",
      async () => {
        if (this.status === "executing") return;
        await this.evaluateStrategies();
      }
    );

    // Register the learning review loop (every hour)
    this.scheduler.registerTask(
      "learning-review",
      "0 * * * *",
      async () => {
        await this.reviewAndLearn();
      }
    );

    this.scheduler.startAll();
    this.emit("started");
    logger.info(`${config.AGENT_NAME} started successfully`);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.scheduler.stopAll();
    this.memory.close();
    this.status = "idle";
    this.emit("stopped");
    logger.info(`${config.AGENT_NAME} stopped`);
  }

  async evaluateStrategies(): Promise<void> {
    if (!this.running) return;

    this.status = "evaluating";
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

      // Record the decision
      const decisionId = this.memory.recordDecision({
        strategy: selected.strategy.name,
        action: selected.result.opportunity,
        reasoning: `Confidence: ${selected.result.confidence}, Expected reward: ${selected.result.expectedReward}`,
      });

      // Execute
      const executionResult = await selected.strategy.execute(selected.result);

      // Record outcome
      this.memory.recordOutcome(
        decisionId,
        executionResult.success ? "success" : "failure",
        executionResult.profitLoss
      );

      this.lastAction = `${selected.strategy.name}: ${selected.result.opportunity}`;

      if (executionResult.profitLoss !== 0) {
        this.emit("alert", {
          type: executionResult.success ? "profit" : "loss",
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

  private async reviewAndLearn(): Promise<void> {
    try {
      const recentDecisions = this.memory.recall("decisions", 20);
      if (recentDecisions.length === 0) return;

      const messages: LLMMessage[] = [
        {
          role: "system",
          content:
            "You are an AI agent reviewing past decisions. Analyze the patterns and suggest improvements. Be concise.",
        },
        {
          role: "user",
          content: `Review these recent observations and extract useful patterns:\n${recentDecisions
            .map((d) => d.content)
            .join("\n")}`,
        },
      ];

      const response = await chat(messages, { temperature: 0.5 });
      this.memory.remember("learning", response.content);
      logger.info("Learning review completed");
    } catch (error) {
      logger.error("Learning review failed", {
        error: (error as Error).message,
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
