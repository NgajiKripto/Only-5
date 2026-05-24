import type winston from "winston";
import type { WorkflowStep, WorkflowResult } from "./types.js";

const SHELL_INJECTION_PATTERNS = /[;`|]|&&|\$\(|\$\{/;

export abstract class BaseWorkflow {
  protected logger: winston.Logger;

  constructor(logger: winston.Logger) {
    this.logger = logger;
  }

  abstract getName(): string;
  abstract getDescription(): string;
  abstract getSteps(): WorkflowStep[];
  abstract getAllowedTools(): string[];

  async execute(params: Record<string, unknown>): Promise<WorkflowResult> {
    const startedAt = Date.now();
    const steps = this.getSteps();
    const stepResults: Array<{ name: string; success: boolean; output: unknown; duration: number }> = [];

    this.logger.info(`Workflow "${this.getName()}" started`, { params, totalSteps: steps.length });

    for (const step of steps) {
      const mergedStep: WorkflowStep = {
        ...step,
        params: { ...step.params, ...params },
      };

      const validation = this.validateCommand(mergedStep.tool, mergedStep.params);
      if (!validation.valid) {
        this.logger.warn(`Step "${step.name}" failed validation`, { error: validation.error });
        stepResults.push({ name: step.name, success: false, output: null, duration: 0 });
        return this.createResultDict(stepResults, startedAt, validation.error);
      }

      const result = await this.executeStep(mergedStep);
      stepResults.push({ name: step.name, ...result });

      if (!result.success) {
        this.logger.warn(`Step "${step.name}" failed`, { output: result.output });
        return this.createResultDict(stepResults, startedAt, `Step "${step.name}" failed`);
      }
    }

    this.logger.info(`Workflow "${this.getName()}" completed successfully`);
    return this.createResultDict(stepResults, startedAt);
  }

  protected async executeStep(
    step: WorkflowStep
  ): Promise<{ success: boolean; output: unknown; duration: number }> {
    const startTime = Date.now();
    const timeoutMs = step.timeoutMs ?? 30000;
    const retries = step.retries ?? 1;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const result = await new Promise<unknown>((resolve, reject) => {
            controller.signal.addEventListener("abort", () => {
              reject(new Error(`Step "${step.name}" timed out after ${timeoutMs}ms`));
            });

            // Stub execution - no real tool dispatch wired yet
            this.logger.debug(`Stub execution for step "${step.name}" (tool: ${step.tool}) - no real dispatch`);
            Promise.resolve({ tool: step.tool, params: step.params, executed: true, dispatched: false })
              .then(resolve)
              .catch(reject);
          });

          clearTimeout(timeoutId);
          const output = step.parseJson ? this.parseOutput(result) : result;
          return { success: true, output, duration: Date.now() - startTime };
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        this.logger.debug(`Step "${step.name}" attempt ${attempt + 1} failed`, { error: errorMessage });

        if (attempt === retries) {
          return { success: false, output: errorMessage, duration: Date.now() - startTime };
        }
      }
    }

    return { success: false, output: "Exhausted retries", duration: Date.now() - startTime };
  }

  protected createResultDict(
    steps: Array<{ name: string; success: boolean; output: unknown; duration: number }>,
    startedAt: number,
    error?: string
  ): WorkflowResult {
    const completedAt = Date.now();
    const allSuccess = steps.every((s) => s.success);
    const lastStep = steps[steps.length - 1];

    return {
      success: allSuccess && !error,
      data: lastStep?.output ?? null,
      error,
      steps,
      startedAt,
      completedAt,
      duration: completedAt - startedAt,
    };
  }

  protected validateCommand(
    tool: string,
    params: Record<string, unknown>
  ): { valid: boolean; error?: string } {
    const allowedTools = this.getAllowedTools();

    if (!allowedTools.includes(tool)) {
      return { valid: false, error: `Tool "${tool}" is not in the allowed tools list` };
    }

    const injectionError = this.checkParams(params);
    if (injectionError) {
      return { valid: false, error: injectionError };
    }

    return { valid: true };
  }

  protected parseOutput(raw: unknown): unknown {
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  }

  private checkParams(params: Record<string, unknown>): string | null {
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && SHELL_INJECTION_PATTERNS.test(value)) {
        return `Blocked pattern detected in parameter "${key}"`;
      }
      if (typeof value === "object" && value !== null) {
        const nested = this.checkParams(value as Record<string, unknown>);
        if (nested) return nested;
      }
    }
    return null;
  }
}
