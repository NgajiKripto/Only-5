import type winston from "winston";
import { BaseWorkflow } from "./base-workflow.js";
import type { WorkflowResult } from "./types.js";
import { SecurityScanWorkflow } from "./workflows/security-scan.js";
import { TokenAnalysisWorkflow } from "./workflows/token-analysis.js";
import { ReconWorkflow } from "./workflows/recon.js";

export class WorkflowRegistry {
  private workflows: Map<string, BaseWorkflow> = new Map();
  private logger: winston.Logger;

  constructor(logger: winston.Logger) {
    this.logger = logger;
    this.registerBuiltins();
    this.logger.info("WorkflowRegistry initialized", { count: this.workflows.size });
  }

  register(workflow: BaseWorkflow): void {
    const name = workflow.getName();
    this.workflows.set(name, workflow);
    this.logger.debug(`Workflow registered: ${name}`);
  }

  listWorkflows(): Array<{ name: string; description: string; steps: number }> {
    const list: Array<{ name: string; description: string; steps: number }> = [];
    for (const workflow of this.workflows.values()) {
      list.push({
        name: workflow.getName(),
        description: workflow.getDescription(),
        steps: workflow.getSteps().length,
      });
    }
    return list;
  }

  async runWorkflow(name: string, params?: Record<string, unknown>): Promise<WorkflowResult> {
    const workflow = this.workflows.get(name);
    if (!workflow) {
      return {
        success: false,
        data: null,
        error: `Workflow "${name}" not found`,
        steps: [],
        startedAt: Date.now(),
        completedAt: Date.now(),
        duration: 0,
      };
    }

    this.logger.info(`Running workflow: ${name}`, { params });
    return workflow.execute(params ?? {});
  }

  getWorkflow(name: string): BaseWorkflow | undefined {
    return this.workflows.get(name);
  }

  private registerBuiltins(): void {
    this.register(new SecurityScanWorkflow(this.logger));
    this.register(new TokenAnalysisWorkflow(this.logger));
    this.register(new ReconWorkflow(this.logger));
  }
}
