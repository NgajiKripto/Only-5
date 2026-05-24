import { describe, it, expect, beforeEach } from "vitest";
import winston from "winston";
import { WorkflowRegistry } from "../../../src/core/workflow/workflow-registry.js";
import { BaseWorkflow } from "../../../src/core/workflow/base-workflow.js";
import type { WorkflowStep } from "../../../src/core/workflow/types.js";

class MockWorkflow extends BaseWorkflow {
  private workflowName: string;
  private desc: string;
  private tools: string[];
  private workflowSteps: WorkflowStep[];

  constructor(logger: winston.Logger, name: string, desc: string, tools: string[], steps: WorkflowStep[]) {
    super(logger);
    this.workflowName = name;
    this.desc = desc;
    this.tools = tools;
    this.workflowSteps = steps;
  }

  getName(): string {
    return this.workflowName;
  }

  getDescription(): string {
    return this.desc;
  }

  getAllowedTools(): string[] {
    return this.tools;
  }

  getSteps(): WorkflowStep[] {
    return this.workflowSteps;
  }
}

describe("WorkflowRegistry", () => {
  let logger: winston.Logger;
  let registry: WorkflowRegistry;

  beforeEach(() => {
    logger = winston.createLogger({
      silent: true,
      transports: [new winston.transports.Console()],
    });
    registry = new WorkflowRegistry(logger);
  });

  describe("registration and listing", () => {
    it("should register builtin workflows on construction", () => {
      const workflows = registry.listWorkflows();
      expect(workflows.length).toBeGreaterThanOrEqual(3);

      const names = workflows.map((w) => w.name);
      expect(names).toContain("security-scan");
      expect(names).toContain("token-analysis");
      expect(names).toContain("recon");
    });

    it("should register custom workflows", () => {
      const custom = new MockWorkflow(logger, "custom", "A custom workflow", ["tool-a"], [
        { name: "step-1", tool: "tool-a", params: {} },
      ]);
      registry.register(custom);

      const workflows = registry.listWorkflows();
      const found = workflows.find((w) => w.name === "custom");
      expect(found).toBeDefined();
      expect(found!.description).toBe("A custom workflow");
      expect(found!.steps).toBe(1);
    });

    it("should list workflows with correct metadata", () => {
      const workflows = registry.listWorkflows();
      const secScan = workflows.find((w) => w.name === "security-scan");
      expect(secScan).toBeDefined();
      expect(secScan!.description).toBe("Multi-step security scanning workflow");
      expect(secScan!.steps).toBe(4);
    });
  });

  describe("getWorkflow", () => {
    it("should return a workflow by name", () => {
      const workflow = registry.getWorkflow("security-scan");
      expect(workflow).toBeDefined();
      expect(workflow!.getName()).toBe("security-scan");
    });

    it("should return undefined for unknown workflow", () => {
      const workflow = registry.getWorkflow("nonexistent");
      expect(workflow).toBeUndefined();
    });
  });

  describe("runWorkflow", () => {
    it("should execute a registered workflow successfully", async () => {
      const result = await registry.runWorkflow("security-scan", { target: "test-contract" });
      expect(result.success).toBe(true);
      expect(result.steps.length).toBe(4);
      expect(result.startedAt).toBeGreaterThan(0);
      expect(result.completedAt).toBeGreaterThanOrEqual(result.startedAt);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should return error result for nonexistent workflow", async () => {
      const result = await registry.runWorkflow("does-not-exist");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
      expect(result.steps).toEqual([]);
    });

    it("should pass params to the workflow", async () => {
      const result = await registry.runWorkflow("token-analysis", { token: "SOL" });
      expect(result.success).toBe(true);
      expect(result.steps.length).toBe(4);
    });
  });

  describe("step execution with timeout", () => {
    it("should handle steps with configured timeouts", async () => {
      const workflow = new MockWorkflow(logger, "timeout-test", "Timeout test", ["fast-tool"], [
        { name: "fast-step", tool: "fast-tool", params: {}, timeoutMs: 5000 },
      ]);
      registry.register(workflow);

      const result = await registry.runWorkflow("timeout-test");
      expect(result.success).toBe(true);
      expect(result.steps[0].name).toBe("fast-step");
    });
  });

  describe("step execution with retries", () => {
    it("should use configured retry count", async () => {
      const workflow = new MockWorkflow(logger, "retry-test", "Retry test", ["retry-tool"], [
        { name: "retry-step", tool: "retry-tool", params: {}, retries: 3 },
      ]);
      registry.register(workflow);

      const result = await registry.runWorkflow("retry-test");
      expect(result.success).toBe(true);
    });
  });

  describe("command validation (blocked patterns)", () => {
    it("should reject params with shell injection patterns", async () => {
      const result = await registry.runWorkflow("security-scan", { target: "test; rm -rf /" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Blocked pattern");
    });

    it("should reject params with $() syntax", async () => {
      const result = await registry.runWorkflow("recon", { target: "$(whoami)" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Blocked pattern");
    });

    it("should allow safe params", async () => {
      const result = await registry.runWorkflow("recon", { target: "safe-target-123" });
      expect(result.success).toBe(true);
    });
  });
});
