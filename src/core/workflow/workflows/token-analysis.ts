import type winston from "winston";
import { BaseWorkflow } from "../base-workflow.js";
import type { WorkflowStep } from "../types.js";

export class TokenAnalysisWorkflow extends BaseWorkflow {
  constructor(logger: winston.Logger) {
    super(logger);
  }

  getName(): string {
    return "token-analysis";
  }

  getDescription(): string {
    return "Token and DeFi opportunity analysis";
  }

  getAllowedTools(): string[] {
    return ["token-info", "liquidity-check", "holder-analysis", "risk-score"];
  }

  getSteps(): WorkflowStep[] {
    return [
      {
        name: "fetch-token-info",
        tool: "token-info",
        params: { action: "fetch" },
        timeoutMs: 15000,
        retries: 2,
      },
      {
        name: "check-liquidity",
        tool: "liquidity-check",
        params: { action: "check" },
        timeoutMs: 20000,
        retries: 1,
      },
      {
        name: "analyze-holders",
        tool: "holder-analysis",
        params: { action: "analyze" },
        timeoutMs: 25000,
        retries: 1,
      },
      {
        name: "risk-assessment",
        tool: "risk-score",
        params: { action: "assess" },
        timeoutMs: 10000,
        retries: 0,
      },
    ];
  }
}
