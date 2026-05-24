import { EventEmitter } from "events";
import type winston from "winston";
import type { AgentRegistry } from "./agent-registry.js";
import type { AgentTask, AgentResult, OrchestrationPlan } from "./types.js";

export class SubAgentOrchestrator extends EventEmitter {
  private logger: winston.Logger;
  private registry: AgentRegistry;

  constructor(logger: winston.Logger, registry: AgentRegistry) {
    super();
    this.logger = logger;
    this.registry = registry;
  }

  async dispatch(task: AgentTask): Promise<AgentResult> {
    const agents = this.registry.findAgentsForTask(task);

    if (agents.length === 0) {
      this.logger.warn(`No agent found for task: ${task.type}`, { taskId: task.id });
      return {
        agentName: "none",
        taskId: task.id,
        success: false,
        data: null,
        error: `No agent available to handle task type "${task.type}"`,
        duration: 0,
        findings: [],
      };
    }

    // Pick the highest priority agent
    const sorted = agents.sort((a, b) => b.getConfig().priority - a.getConfig().priority);
    const selected = sorted[0];
    const config = selected.getConfig();

    this.logger.info(`Dispatching task to agent: ${config.name}`, { taskId: task.id, type: task.type });
    this.emit("agent_started", { agentName: config.name, taskId: task.id });

    try {
      const result = await selected.runWithTimeout(task);

      if (result.success) {
        this.emit("agent_completed", { agentName: config.name, taskId: task.id, result });
      } else {
        this.emit("agent_failed", { agentName: config.name, taskId: task.id, result });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const result: AgentResult = {
        agentName: config.name,
        taskId: task.id,
        success: false,
        data: null,
        error: errorMessage,
        duration: Date.now() - task.createdAt,
        findings: [],
      };

      this.emit("agent_failed", { agentName: config.name, taskId: task.id, result });
      return result;
    }
  }

  async dispatchParallel(tasks: AgentTask[]): Promise<AgentResult[]> {
    this.logger.info(`Dispatching ${tasks.length} tasks in parallel`);

    const results = await Promise.allSettled(tasks.map((task) => this.dispatch(task)));

    return results.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      return {
        agentName: "none",
        taskId: tasks[index].id,
        success: false,
        data: null,
        error: result.reason instanceof Error ? result.reason.message : "Unknown error",
        duration: 0,
        findings: [],
      };
    });
  }

  planExecution(tasks: AgentTask[]): OrchestrationPlan {
    const selectedAgents: Set<string> = new Set();

    for (const task of tasks) {
      const agents = this.registry.findAgentsForTask(task);
      if (agents.length > 0) {
        const sorted = agents.sort((a, b) => b.getConfig().priority - a.getConfig().priority);
        selectedAgents.add(sorted[0].getConfig().name);
      }
    }

    // Determine if tasks can run in parallel: parallel if they use different agents (no contention)
    const parallel = selectedAgents.size >= tasks.length;

    return {
      tasks,
      selectedAgents: Array.from(selectedAgents),
      parallel,
    };
  }

  aggregateResults(results: AgentResult[]): {
    totalTasks: number;
    succeeded: number;
    failed: number;
    findings: string[];
    duration: number;
  } {
    const findings: string[] = [];
    let totalDuration = 0;
    let succeeded = 0;
    let failed = 0;

    for (const result of results) {
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
      findings.push(...result.findings);
      totalDuration += result.duration;
    }

    return {
      totalTasks: results.length,
      succeeded,
      failed,
      findings,
      duration: totalDuration,
    };
  }

  getRegistry(): AgentRegistry {
    return this.registry;
  }
}
