import type winston from "winston";
import { BaseWorkflow } from "../base-workflow.js";
import type { WorkflowStep } from "../types.js";

export class ReconWorkflow extends BaseWorkflow {
  constructor(logger: winston.Logger) {
    super(logger);
  }

  getName(): string {
    return "recon";
  }

  getDescription(): string {
    return "Target reconnaissance and enumeration";
  }

  getAllowedTools(): string[] {
    return ["target-discover", "endpoint-enum", "tech-detect", "vuln-map"];
  }

  getSteps(): WorkflowStep[] {
    return [
      {
        name: "target-discovery",
        tool: "target-discover",
        params: { action: "discover" },
        timeoutMs: 20000,
        retries: 2,
      },
      {
        name: "endpoint-enumeration",
        tool: "endpoint-enum",
        params: { action: "enumerate" },
        timeoutMs: 30000,
        retries: 1,
      },
      {
        name: "technology-detection",
        tool: "tech-detect",
        params: { action: "detect" },
        timeoutMs: 15000,
        retries: 1,
      },
      {
        name: "vulnerability-mapping",
        tool: "vuln-map",
        params: { action: "map" },
        timeoutMs: 25000,
        retries: 0,
      },
    ];
  }
}
