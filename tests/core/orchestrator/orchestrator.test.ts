import { describe, it, expect, beforeEach } from "vitest";
import { createLogger } from "../../../src/core/logger.js";
import { AgentRegistry } from "../../../src/core/orchestrator/agent-registry.js";
import { SubAgentOrchestrator } from "../../../src/core/orchestrator/orchestrator.js";
import { AgentRunner } from "../../../src/core/orchestrator/agent-runner.js";
import { SecurityAgent } from "../../../src/core/orchestrator/agents/security-agent.js";
import { DeFiAgent } from "../../../src/core/orchestrator/agents/defi-agent.js";
import { BountyAgent } from "../../../src/core/orchestrator/agents/bounty-agent.js";
import { MarketAgent } from "../../../src/core/orchestrator/agents/market-agent.js";
import type { AgentTask, AgentResult } from "../../../src/core/orchestrator/types.js";

const logger = createLogger("test-orchestrator");

describe("SubAgentOrchestrator", () => {
  let registry: AgentRegistry;
  let orchestrator: SubAgentOrchestrator;

  beforeEach(() => {
    registry = new AgentRegistry(logger);
    registry.register(new SecurityAgent(logger));
    registry.register(new DeFiAgent(logger));
    registry.register(new BountyAgent(logger));
    registry.register(new MarketAgent(logger));
    orchestrator = new SubAgentOrchestrator(logger, registry);
  });

  describe("dispatch()", () => {
    it("should select the correct agent for a task type", async () => {
      const task: AgentTask = {
        id: "task-1",
        type: "security-scan",
        target: "0xContractAddress",
        params: {},
        createdAt: Date.now(),
      };

      const result = await orchestrator.dispatch(task);
      expect(result.success).toBe(true);
      expect(result.agentName).toBe("security-agent");
      expect(result.taskId).toBe("task-1");
      expect(result.findings.length).toBeGreaterThan(0);
    });

    it("should return error result when no agent can handle the task", async () => {
      const task: AgentTask = {
        id: "task-2",
        type: "unknown-operation",
        target: "no-match",
        params: {},
        createdAt: Date.now(),
      };

      const result = await orchestrator.dispatch(task);
      expect(result.success).toBe(false);
      expect(result.agentName).toBe("none");
      expect(result.error).toContain("No agent available");
    });

    it("should select the highest priority agent when multiple can handle", async () => {
      const task: AgentTask = {
        id: "task-3",
        type: "security-scan",
        target: "audit-this-defi-token",
        params: {},
        createdAt: Date.now(),
      };

      // Both security-agent (priority 10) and defi-agent (trigger "token") could handle
      // but security-scan is only in security-agent capabilities
      const result = await orchestrator.dispatch(task);
      expect(result.success).toBe(true);
      expect(result.agentName).toBe("security-agent");
    });
  });

  describe("dispatchParallel()", () => {
    it("should run multiple tasks concurrently", async () => {
      const tasks: AgentTask[] = [
        {
          id: "parallel-1",
          type: "security-scan",
          target: "contract-A",
          params: {},
          createdAt: Date.now(),
        },
        {
          id: "parallel-2",
          type: "token-analysis",
          target: "token-B",
          params: {},
          createdAt: Date.now(),
        },
        {
          id: "parallel-3",
          type: "market-analysis",
          target: "SOL",
          params: {},
          createdAt: Date.now(),
        },
      ];

      const results = await orchestrator.dispatchParallel(tasks);
      expect(results).toHaveLength(3);
      expect(results[0].agentName).toBe("security-agent");
      expect(results[1].agentName).toBe("defi-agent");
      expect(results[2].agentName).toBe("market-agent");
      expect(results.every((r) => r.success)).toBe(true);
    });

    it("should handle mixed success and failure", async () => {
      const tasks: AgentTask[] = [
        {
          id: "mix-1",
          type: "security-scan",
          target: "contract-A",
          params: {},
          createdAt: Date.now(),
        },
        {
          id: "mix-2",
          type: "unknown-task",
          target: "no-match",
          params: {},
          createdAt: Date.now(),
        },
      ];

      const results = await orchestrator.dispatchParallel(tasks);
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });
  });

  describe("planExecution()", () => {
    it("should create correct orchestration plan", () => {
      const tasks: AgentTask[] = [
        {
          id: "plan-1",
          type: "security-scan",
          target: "contract",
          params: {},
          createdAt: Date.now(),
        },
        {
          id: "plan-2",
          type: "token-analysis",
          target: "token",
          params: {},
          createdAt: Date.now(),
        },
      ];

      const plan = orchestrator.planExecution(tasks);
      expect(plan.tasks).toHaveLength(2);
      expect(plan.selectedAgents).toContain("security-agent");
      expect(plan.selectedAgents).toContain("defi-agent");
      expect(plan.parallel).toBe(true);
    });
  });

  describe("aggregateResults()", () => {
    it("should correctly merge findings and counts", () => {
      const results: AgentResult[] = [
        {
          agentName: "security-agent",
          taskId: "t1",
          success: true,
          data: {},
          duration: 100,
          findings: ["finding-1", "finding-2"],
        },
        {
          agentName: "defi-agent",
          taskId: "t2",
          success: true,
          data: {},
          duration: 200,
          findings: ["finding-3"],
        },
        {
          agentName: "bounty-agent",
          taskId: "t3",
          success: false,
          data: null,
          error: "timeout",
          duration: 50,
          findings: [],
        },
      ];

      const aggregated = orchestrator.aggregateResults(results);
      expect(aggregated.totalTasks).toBe(3);
      expect(aggregated.succeeded).toBe(2);
      expect(aggregated.failed).toBe(1);
      expect(aggregated.findings).toEqual(["finding-1", "finding-2", "finding-3"]);
      expect(aggregated.duration).toBe(350);
    });
  });

  describe("Event emission", () => {
    it("should emit agent_started event on dispatch", async () => {
      const events: unknown[] = [];
      orchestrator.on("agent_started", (e) => events.push(e));

      const task: AgentTask = {
        id: "event-1",
        type: "security-scan",
        target: "contract",
        params: {},
        createdAt: Date.now(),
      };

      await orchestrator.dispatch(task);
      expect(events).toHaveLength(1);
      expect((events[0] as Record<string, unknown>).agentName).toBe("security-agent");
    });

    it("should emit agent_completed event on success", async () => {
      const events: unknown[] = [];
      orchestrator.on("agent_completed", (e) => events.push(e));

      const task: AgentTask = {
        id: "event-2",
        type: "token-analysis",
        target: "token",
        params: {},
        createdAt: Date.now(),
      };

      await orchestrator.dispatch(task);
      expect(events).toHaveLength(1);
      expect((events[0] as Record<string, unknown>).agentName).toBe("defi-agent");
    });

    it("should emit agent_failed event on failure", async () => {
      // Create a custom agent that always fails
      class FailingAgent extends AgentRunner {
        constructor() {
          super(logger, {
            name: "failing-agent",
            description: "Always fails",
            capabilities: ["fail-task"],
            triggers: [],
            priority: 100,
          });
        }

        async execute(task: AgentTask): Promise<AgentResult> {
          return this.createResult(task, false, null, [], "Intentional failure");
        }
      }

      const failRegistry = new AgentRegistry(logger);
      failRegistry.register(new FailingAgent());
      const failOrchestrator = new SubAgentOrchestrator(logger, failRegistry);

      const events: unknown[] = [];
      failOrchestrator.on("agent_failed", (e) => events.push(e));

      const task: AgentTask = {
        id: "event-3",
        type: "fail-task",
        target: "target",
        params: {},
        createdAt: Date.now(),
      };

      await failOrchestrator.dispatch(task);
      expect(events).toHaveLength(1);
      expect((events[0] as Record<string, unknown>).agentName).toBe("failing-agent");
    });
  });
});
