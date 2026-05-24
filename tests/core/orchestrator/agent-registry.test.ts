import { describe, it, expect, beforeEach } from "vitest";
import { createLogger } from "../../../src/core/logger.js";
import { AgentRegistry } from "../../../src/core/orchestrator/agent-registry.js";
import { SecurityAgent } from "../../../src/core/orchestrator/agents/security-agent.js";
import { DeFiAgent } from "../../../src/core/orchestrator/agents/defi-agent.js";
import { BountyAgent } from "../../../src/core/orchestrator/agents/bounty-agent.js";
import { MarketAgent } from "../../../src/core/orchestrator/agents/market-agent.js";
import type { AgentTask } from "../../../src/core/orchestrator/types.js";

const logger = createLogger("test-registry");

describe("AgentRegistry", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry(logger);
  });

  describe("register() and listAgents()", () => {
    it("should register agents and list their configs", () => {
      const securityAgent = new SecurityAgent(logger);
      const defiAgent = new DeFiAgent(logger);

      registry.register(securityAgent);
      registry.register(defiAgent);

      const agents = registry.listAgents();
      expect(agents).toHaveLength(2);
      expect(agents[0].name).toBe("security-agent");
      expect(agents[1].name).toBe("defi-agent");
    });
  });

  describe("unregister()", () => {
    it("should remove a registered agent", () => {
      const securityAgent = new SecurityAgent(logger);
      registry.register(securityAgent);

      expect(registry.listAgents()).toHaveLength(1);

      const removed = registry.unregister("security-agent");
      expect(removed).toBe(true);
      expect(registry.listAgents()).toHaveLength(0);
    });

    it("should return false for unregistered agent", () => {
      const removed = registry.unregister("nonexistent");
      expect(removed).toBe(false);
    });
  });

  describe("getAgent()", () => {
    it("should return agent by name", () => {
      const securityAgent = new SecurityAgent(logger);
      registry.register(securityAgent);

      const agent = registry.getAgent("security-agent");
      expect(agent).toBeDefined();
      expect(agent!.getConfig().name).toBe("security-agent");
    });

    it("should return undefined for unknown agent", () => {
      const agent = registry.getAgent("unknown");
      expect(agent).toBeUndefined();
    });
  });

  describe("findAgentsForTask()", () => {
    it("should find agents that can handle a task by capability", () => {
      registry.register(new SecurityAgent(logger));
      registry.register(new DeFiAgent(logger));
      registry.register(new BountyAgent(logger));
      registry.register(new MarketAgent(logger));

      const task: AgentTask = {
        id: "task-1",
        type: "security-scan",
        target: "some-contract",
        params: {},
        createdAt: Date.now(),
      };

      const found = registry.findAgentsForTask(task);
      expect(found).toHaveLength(1);
      expect(found[0].getConfig().name).toBe("security-agent");
    });

    it("should find agents by trigger match in target", () => {
      registry.register(new SecurityAgent(logger));
      registry.register(new DeFiAgent(logger));

      const task: AgentTask = {
        id: "task-2",
        type: "unknown-type",
        target: "check-token-liquidity",
        params: {},
        createdAt: Date.now(),
      };

      const found = registry.findAgentsForTask(task);
      expect(found).toHaveLength(1);
      expect(found[0].getConfig().name).toBe("defi-agent");
    });

    it("should return empty array for unhandled task type", () => {
      registry.register(new SecurityAgent(logger));
      registry.register(new DeFiAgent(logger));

      const task: AgentTask = {
        id: "task-3",
        type: "unknown-type",
        target: "no-match-here",
        params: {},
        createdAt: Date.now(),
      };

      const found = registry.findAgentsForTask(task);
      expect(found).toHaveLength(0);
    });
  });

  describe("getAgentStatuses()", () => {
    it("should return statuses for all registered agents", () => {
      registry.register(new SecurityAgent(logger));
      registry.register(new DeFiAgent(logger));
      registry.register(new BountyAgent(logger));

      const statuses = registry.getAgentStatuses();
      expect(statuses).toHaveLength(3);

      for (const status of statuses) {
        expect(status.status).toBe("idle");
        expect(status.lastRun).toBeNull();
        expect(status.tasksCompleted).toBe(0);
        expect(status.tasksFailed).toBe(0);
      }
    });
  });
});
