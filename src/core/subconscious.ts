import { createLogger } from "./logger.js";
import type { MemorySystem } from "./memory.js";
import type { HealthMonitor } from "./health-monitor.js";
import type { LLMMessage, LLMResponse } from "../types/index.js";

const logger = createLogger("subconscious");

type LLMFunction = (
  messages: LLMMessage[],
  options?: { temperature?: number; maxTokens?: number }
) => Promise<LLMResponse>;

export interface Escalation {
  level: "info" | "warning" | "critical";
  message: string;
  source: string;
  timestamp: number;
}

export interface SubconsciousResult {
  insights: string[];
  actions: string[];
  escalations: Escalation[];
}

export interface SubconsciousTask {
  id: string;
  name: string;
  handler: () => Promise<SubconsciousResult>;
  intervalMs: number;
  lastRun: number;
  enabled: boolean;
}

export interface SubconsciousDeps {
  memory: MemorySystem;
  llm: LLMFunction;
  healthMonitor: HealthMonitor;
}

let taskIdCounter = 0;

const MAX_ESCALATIONS = 500;

function generateTaskId(): string {
  return `sub-task-${++taskIdCounter}-${Date.now()}`;
}

export class SubconsciousEngine {
  private tasks: Map<string, SubconsciousTask> = new Map();
  private escalations: Escalation[] = [];
  private deps: SubconsciousDeps;

  constructor(deps: SubconsciousDeps) {
    this.deps = deps;
    this.registerBuiltinTasks();
    logger.info("Subconscious engine initialized");
  }

  registerTask(
    task: Omit<SubconsciousTask, "id" | "lastRun">
  ): string {
    const id = generateTaskId();
    this.tasks.set(id, {
      ...task,
      id,
      lastRun: 0,
    });
    logger.debug(`Task registered: ${task.name}`, { id, intervalMs: task.intervalMs });
    return id;
  }

  async tick(): Promise<SubconsciousResult> {
    const now = Date.now();
    const aggregated: SubconsciousResult = {
      insights: [],
      actions: [],
      escalations: [],
    };

    for (const [, task] of this.tasks) {
      if (!task.enabled) continue;
      if (now - task.lastRun < task.intervalMs) continue;

      try {
        logger.debug(`Running subconscious task: ${task.name}`);
        task.lastRun = now;
        const result = await task.handler();
        aggregated.insights.push(...result.insights);
        aggregated.actions.push(...result.actions);
        aggregated.escalations.push(...result.escalations);
      } catch (error) {
        logger.error(`Subconscious task "${task.name}" failed`, {
          error: (error as Error).message,
        });
        aggregated.escalations.push({
          level: "warning",
          message: `Task "${task.name}" failed: ${(error as Error).message}`,
          source: task.name,
          timestamp: now,
        });
      }
    }

    // Store escalations (bounded to prevent memory leak)
    this.escalations.push(...aggregated.escalations);
    if (this.escalations.length > MAX_ESCALATIONS) {
      this.escalations = this.escalations.slice(-MAX_ESCALATIONS);
    }

    if (aggregated.insights.length > 0) {
      logger.info("Subconscious insights", { count: aggregated.insights.length });
    }

    return aggregated;
  }

  getEscalations(since?: number): Escalation[] {
    if (since === undefined) {
      return [...this.escalations];
    }
    return this.escalations.filter((e) => e.timestamp >= since);
  }

  private registerBuiltinTasks(): void {
    // Memory pattern scan - every 30 minutes
    this.registerTask({
      name: "memory-pattern-scan",
      intervalMs: 30 * 60 * 1000,
      enabled: true,
      handler: async () => this.memoryPatternScan(),
    });

    // Market sentiment check - every 15 minutes
    this.registerTask({
      name: "market-sentiment-check",
      intervalMs: 15 * 60 * 1000,
      enabled: true,
      handler: async () => this.marketSentimentCheck(),
    });

    // Strategy health check - every 20 minutes
    this.registerTask({
      name: "strategy-health-check",
      intervalMs: 20 * 60 * 1000,
      enabled: true,
      handler: async () => this.strategyHealthCheck(),
    });
  }

  private async memoryPatternScan(): Promise<SubconsciousResult> {
    const result: SubconsciousResult = { insights: [], actions: [], escalations: [] };

    try {
      const recentDecisions = this.deps.memory.getRecentDecisions(20);
      if (recentDecisions.length < 3) {
        return result;
      }

      const decisionSummary = recentDecisions
        .map((d) => `${d.strategy}: ${d.action} -> ${d.outcome ?? "pending"}`)
        .join("\n");

      const messages: LLMMessage[] = [
        {
          role: "system",
          content: "You are an analytical agent. Identify emerging patterns in the decision history. Be concise. List only novel patterns not obvious from individual decisions. If none found, respond with 'none'.",
        },
        {
          role: "user",
          content: `Recent decisions:\n${decisionSummary}`,
        },
      ];

      const response = await this.deps.llm(messages, { temperature: 0.3, maxTokens: 200 });
      const content = response.content.trim().toLowerCase();
      if (content !== "none" && content.length > 0) {
        result.insights.push(response.content.trim());
      }
    } catch (error) {
      logger.warn("Memory pattern scan failed", { error: (error as Error).message });
    }

    return result;
  }

  private async marketSentimentCheck(): Promise<SubconsciousResult> {
    const result: SubconsciousResult = { insights: [], actions: [], escalations: [] };

    try {
      const recentObservations = this.deps.memory.recall("market", 10);
      if (recentObservations.length < 2) {
        return result;
      }

      const observationSummary = recentObservations
        .map((o) => `[${o.category}] ${o.content}`)
        .join("\n");

      const messages: LLMMessage[] = [
        {
          role: "system",
          content: "You are a market analyst. Analyze these observations for sentiment shifts or market condition changes. Respond with a one-line summary or 'stable' if no notable changes.",
        },
        {
          role: "user",
          content: `Recent observations:\n${observationSummary}`,
        },
      ];

      const response = await this.deps.llm(messages, { temperature: 0.2, maxTokens: 100 });
      const content = response.content.trim().toLowerCase();
      if (content !== "stable" && content.length > 0) {
        result.insights.push(response.content.trim());

        if (content.includes("crash") || content.includes("panic") || content.includes("extreme")) {
          result.escalations.push({
            level: "warning",
            message: `Market sentiment shift detected: ${response.content.trim()}`,
            source: "market-sentiment-check",
            timestamp: Date.now(),
          });
        }
      }
    } catch (error) {
      logger.warn("Market sentiment check failed", { error: (error as Error).message });
    }

    return result;
  }

  private async strategyHealthCheck(): Promise<SubconsciousResult> {
    const result: SubconsciousResult = { insights: [], actions: [], escalations: [] };

    try {
      const snapshot = this.deps.healthMonitor.getSnapshot();
      const unhealthy = this.deps.healthMonitor.getUnhealthyComponents();

      if (unhealthy.length > 0) {
        result.escalations.push({
          level: "warning",
          message: `Unhealthy components detected: ${unhealthy.join(", ")}`,
          source: "strategy-health-check",
          timestamp: Date.now(),
        });
      }

      // Check for degraded performance via recent decision outcomes
      const recentDecisions = this.deps.memory.getRecentDecisions(10);
      const failures = recentDecisions.filter((d) => d.outcome === "failure");

      if (failures.length >= 5) {
        result.escalations.push({
          level: "critical",
          message: `High failure rate detected: ${failures.length}/${recentDecisions.length} recent decisions failed`,
          source: "strategy-health-check",
          timestamp: Date.now(),
        });
        result.actions.push("Consider pausing strategy execution until failure rate drops");
      }
    } catch (error) {
      logger.warn("Strategy health check failed", { error: (error as Error).message });
    }

    return result;
  }
}
