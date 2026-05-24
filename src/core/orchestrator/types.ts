export interface AgentConfig {
  name: string;
  description: string;
  capabilities: string[];
  triggers: string[];
  priority: number;
}

export interface AgentTask {
  id: string;
  type: string;
  target: string;
  params: Record<string, unknown>;
  createdAt: number;
}

export interface AgentResult {
  agentName: string;
  taskId: string;
  success: boolean;
  data: unknown;
  error?: string;
  duration: number;
  findings: string[];
}

export interface OrchestrationPlan {
  tasks: AgentTask[];
  selectedAgents: string[];
  parallel: boolean;
}

export interface AgentStatus {
  name: string;
  status: "idle" | "running" | "error";
  lastRun: number | null;
  tasksCompleted: number;
  tasksFailed: number;
}
