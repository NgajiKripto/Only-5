import type winston from "winston";
import type { AgentRunner } from "./agent-runner.js";
import type { AgentConfig, AgentTask, AgentStatus } from "./types.js";

export class AgentRegistry {
  private logger: winston.Logger;
  private agents: Map<string, AgentRunner> = new Map();

  constructor(logger: winston.Logger) {
    this.logger = logger;
  }

  register(agent: AgentRunner): void {
    const config = agent.getConfig();
    this.agents.set(config.name, agent);
    this.logger.info(`Agent registered: ${config.name}`, {
      capabilities: config.capabilities,
      triggers: config.triggers,
    });
  }

  unregister(name: string): boolean {
    const removed = this.agents.delete(name);
    if (removed) {
      this.logger.info(`Agent unregistered: ${name}`);
    }
    return removed;
  }

  getAgent(name: string): AgentRunner | undefined {
    return this.agents.get(name);
  }

  listAgents(): AgentConfig[] {
    return Array.from(this.agents.values()).map((agent) => agent.getConfig());
  }

  findAgentsForTask(task: AgentTask): AgentRunner[] {
    return Array.from(this.agents.values()).filter((agent) => agent.canHandle(task));
  }

  getAgentStatuses(): AgentStatus[] {
    return Array.from(this.agents.values()).map((agent) => agent.getStatus());
  }
}
