import type winston from "winston";
import { BaseWorkflow } from "../base-workflow.js";
import type { WorkflowStep } from "../types.js";

export class SecurityScanWorkflow extends BaseWorkflow {
  constructor(logger: winston.Logger) {
    super(logger);
  }

  getName(): string {
    return "security-scan";
  }

  getDescription(): string {
    return "Multi-step security scanning workflow";
  }

  getAllowedTools(): string[] {
    return ["contract-scan", "vulnerability-check", "dependency-audit", "report-generate"];
  }

  getSteps(): WorkflowStep[] {
    return [
      {
        name: "initialize-scan",
        tool: "contract-scan",
        params: { action: "initialize" },
        timeoutMs: 15000,
        retries: 1,
      },
      {
        name: "check-contract",
        tool: "vulnerability-check",
        params: { action: "scan" },
        timeoutMs: 30000,
        retries: 2,
      },
      {
        name: "analyze-results",
        tool: "dependency-audit",
        params: { action: "analyze" },
        timeoutMs: 20000,
        retries: 1,
      },
      {
        name: "generate-report",
        tool: "report-generate",
        params: { action: "report" },
        timeoutMs: 10000,
        retries: 0,
      },
    ];
  }
}
