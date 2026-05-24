import type winston from "winston";
import type { AgentConfig, AgentTask, AgentResult, AgentStatus } from "./types.js";

export abstract class AgentRunner {
  protected logger: winston.Logger;
  protected config: AgentConfig;
  private _status: "idle" | "running" | "error" = "idle";
  private _lastRun: number | null = null;
  private _tasksCompleted: number = 0;
  private _tasksFailed: number = 0;

  constructor(logger: winston.Logger, config: AgentConfig) {
    this.logger = logger;
    this.config = config;
  }

  abstract execute(task: AgentTask): Promise<AgentResult>;

  canHandle(task: AgentTask): boolean {
    if (this.config.capabilities.includes(task.type)) {
      return true;
    }
    return this.config.triggers.some((trigger) =>
      new RegExp(`\\b${trigger}\\b`, "i").test(task.target)
    );
  }

  getConfig(): AgentConfig {
    return this.config;
  }

  getStatus(): AgentStatus {
    return {
      name: this.config.name,
      status: this._status,
      lastRun: this._lastRun,
      tasksCompleted: this._tasksCompleted,
      tasksFailed: this._tasksFailed,
    };
  }

  async runWithTimeout(task: AgentTask, timeoutMs: number = 30000): Promise<AgentResult> {
    const startTime = Date.now();
    this._status = "running";
    this._lastRun = startTime;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const result = await Promise.race([
          this.execute(task),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener("abort", () => {
              reject(new Error(`Agent "${this.config.name}" timed out after ${timeoutMs}ms`));
            });
          }),
        ]);

        clearTimeout(timeoutId);
        this._status = "idle";

        if (result.success) {
          this._tasksCompleted++;
        } else {
          this._tasksFailed++;
        }

        return result;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      this._status = "error";
      this._tasksFailed++;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return this.createResult(task, false, null, [], errorMessage);
    }
  }

  protected createResult(
    task: AgentTask,
    success: boolean,
    data: unknown,
    findings: string[],
    error?: string
  ): AgentResult {
    return {
      agentName: this.config.name,
      taskId: task.id,
      success,
      data,
      error,
      duration: Date.now() - task.createdAt,
      findings,
    };
  }
}
