import { describe, it, expect, beforeEach } from "vitest";
import winston from "winston";
import { BaseWorkflow } from "../../../src/core/workflow/base-workflow.js";
import type { WorkflowStep, WorkflowResult } from "../../../src/core/workflow/types.js";

class TestWorkflow extends BaseWorkflow {
  private steps: WorkflowStep[];
  private allowedTools: string[];

  constructor(logger: winston.Logger, steps: WorkflowStep[], allowedTools: string[]) {
    super(logger);
    this.steps = steps;
    this.allowedTools = allowedTools;
  }

  getName(): string {
    return "test-workflow";
  }

  getDescription(): string {
    return "A test workflow";
  }

  getSteps(): WorkflowStep[] {
    return this.steps;
  }

  getAllowedTools(): string[] {
    return this.allowedTools;
  }

  // Expose protected methods for testing
  public testExecuteStep(step: WorkflowStep) {
    return this.executeStep(step);
  }

  public testCreateResultDict(
    steps: Array<{ name: string; success: boolean; output: unknown; duration: number }>,
    startedAt: number,
    error?: string
  ): WorkflowResult {
    return this.createResultDict(steps, startedAt, error);
  }

  public testValidateCommand(tool: string, params: Record<string, unknown>) {
    return this.validateCommand(tool, params);
  }

  public testParseOutput(raw: unknown): unknown {
    return this.parseOutput(raw);
  }
}

describe("BaseWorkflow", () => {
  let logger: winston.Logger;

  beforeEach(() => {
    logger = winston.createLogger({
      silent: true,
      transports: [new winston.transports.Console()],
    });
  });

  describe("executeStep", () => {
    it("should succeed with a valid step", async () => {
      const workflow = new TestWorkflow(logger, [], ["test-tool"]);
      const step: WorkflowStep = {
        name: "test-step",
        tool: "test-tool",
        params: { action: "test" },
        timeoutMs: 5000,
      };

      const result = await workflow.testExecuteStep(step);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ tool: "test-tool", params: { action: "test" }, executed: true, dispatched: false });
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should timeout with a very short timeout", async () => {
      const workflow = new TestWorkflow(logger, [], ["slow-tool"]);

      // Create a subclass that overrides executeStep to simulate slow execution
      class SlowWorkflow extends TestWorkflow {
        protected override async executeStep(step: WorkflowStep): Promise<{ success: boolean; output: unknown; duration: number }> {
          const startTime = Date.now();
          const timeoutMs = step.timeoutMs ?? 30000;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

          try {
            await new Promise<unknown>((resolve, reject) => {
              controller.signal.addEventListener("abort", () => {
                reject(new Error(`Step "${step.name}" timed out after ${timeoutMs}ms`));
              });

              // Simulate a slow operation that will never resolve before timeout
              setTimeout(() => resolve("done"), 60000);
            });
            clearTimeout(timeoutId);
            return { success: true, output: "done", duration: Date.now() - startTime };
          } catch (error) {
            clearTimeout(timeoutId);
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            return { success: false, output: errorMessage, duration: Date.now() - startTime };
          }
        }
      }

      const slowWorkflow = new SlowWorkflow(logger, [], ["slow-tool"]);
      const step: WorkflowStep = {
        name: "slow-step",
        tool: "slow-tool",
        params: {},
        timeoutMs: 50,
        retries: 0,
      };

      const result = await slowWorkflow.testExecuteStep(step);
      expect(result.success).toBe(false);
      expect(result.output).toContain("timed out");
    });
  });

  describe("createResultDict", () => {
    it("should produce correct format for successful steps", () => {
      const workflow = new TestWorkflow(logger, [], []);
      const startedAt = Date.now() - 100;
      const steps = [
        { name: "step-1", success: true, output: "data1", duration: 50 },
        { name: "step-2", success: true, output: "data2", duration: 50 },
      ];

      const result = workflow.testCreateResultDict(steps, startedAt);
      expect(result.success).toBe(true);
      expect(result.data).toBe("data2");
      expect(result.error).toBeUndefined();
      expect(result.steps).toEqual(steps);
      expect(result.startedAt).toBe(startedAt);
      expect(result.completedAt).toBeGreaterThanOrEqual(startedAt);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should produce correct format with error", () => {
      const workflow = new TestWorkflow(logger, [], []);
      const startedAt = Date.now() - 100;
      const steps = [
        { name: "step-1", success: true, output: "data1", duration: 50 },
        { name: "step-2", success: false, output: null, duration: 10 },
      ];

      const result = workflow.testCreateResultDict(steps, startedAt, "Step failed");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Step failed");
    });
  });

  describe("validateCommand", () => {
    it("should allow whitelisted tools", () => {
      const workflow = new TestWorkflow(logger, [], ["http-request", "scan"]);
      const result = workflow.testValidateCommand("http-request", { url: "https://example.com" });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should reject non-whitelisted tools", () => {
      const workflow = new TestWorkflow(logger, [], ["http-request"]);
      const result = workflow.testValidateCommand("port-scan", {});
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not in the allowed tools list");
    });

    it("should reject shell injection with semicolons", () => {
      const workflow = new TestWorkflow(logger, [], ["exec"]);
      const result = workflow.testValidateCommand("exec", { cmd: "ls; rm -rf /" });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Blocked pattern");
    });

    it("should reject shell injection with && operator", () => {
      const workflow = new TestWorkflow(logger, [], ["exec"]);
      const result = workflow.testValidateCommand("exec", { cmd: "true && cat /etc/passwd" });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Blocked pattern");
    });

    it("should reject shell injection with backticks", () => {
      const workflow = new TestWorkflow(logger, [], ["exec"]);
      const result = workflow.testValidateCommand("exec", { cmd: "`whoami`" });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Blocked pattern");
    });

    it("should reject shell injection with $() syntax", () => {
      const workflow = new TestWorkflow(logger, [], ["exec"]);
      const result = workflow.testValidateCommand("exec", { cmd: "$(cat /etc/passwd)" });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Blocked pattern");
    });

    it("should reject shell injection with ${} syntax", () => {
      const workflow = new TestWorkflow(logger, [], ["exec"]);
      const result = workflow.testValidateCommand("exec", { cmd: "${IFS}" });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Blocked pattern");
    });

    it("should reject shell injection with pipe operator", () => {
      const workflow = new TestWorkflow(logger, [], ["exec"]);
      const result = workflow.testValidateCommand("exec", { cmd: "ls | grep secret" });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Blocked pattern");
    });

    it("should reject nested params with injection", () => {
      const workflow = new TestWorkflow(logger, [], ["exec"]);
      const result = workflow.testValidateCommand("exec", { nested: { deep: "value; drop" } });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Blocked pattern");
    });
  });

  describe("parseOutput", () => {
    it("should parse valid JSON strings", () => {
      const workflow = new TestWorkflow(logger, [], []);
      const result = workflow.testParseOutput('{"key": "value"}');
      expect(result).toEqual({ key: "value" });
    });

    it("should return non-JSON strings as-is", () => {
      const workflow = new TestWorkflow(logger, [], []);
      const result = workflow.testParseOutput("plain text");
      expect(result).toBe("plain text");
    });

    it("should return non-string values as-is", () => {
      const workflow = new TestWorkflow(logger, [], []);
      const obj = { already: "parsed" };
      const result = workflow.testParseOutput(obj);
      expect(result).toBe(obj);
    });

    it("should return numbers as-is", () => {
      const workflow = new TestWorkflow(logger, [], []);
      const result = workflow.testParseOutput(42);
      expect(result).toBe(42);
    });

    it("should return null as-is", () => {
      const workflow = new TestWorkflow(logger, [], []);
      const result = workflow.testParseOutput(null);
      expect(result).toBe(null);
    });
  });
});
