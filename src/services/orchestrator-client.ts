import { randomUUID } from "crypto";
import { config } from "../config.js";

interface AgentTask {
  id: string;
  type: string;
  target: string;
  params: Record<string, unknown>;
  created_at: number;
}

interface AgentResult {
  agent_name: string;
  task_id: string;
  success: boolean;
  data: unknown;
  error?: string;
  duration_ms: number;
  findings: string[];
}

interface AgentInfo {
  name: string;
  description: string;
  capabilities: string[];
  priority: number;
  status: string;
  tasks_completed: number;
  tasks_failed: number;
}

interface Session {
  id: string;
  status: string;
  created_at: number;
  tasks: string[];
  expires_at: number;
}

export type { AgentTask, AgentResult, AgentInfo, Session };

const DEFAULT_TIMEOUT_MS = 30000;

export class OrchestratorClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? process.env.ORCHESTRATOR_SERVICE_URL ?? "http://localhost:7002";
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.INTERNAL_SERVICE_SECRET) {
      headers["Authorization"] = `Bearer ${config.INTERNAL_SERVICE_SECRET}`;
    }
    return headers;
  }

  async dispatch(
    task: Omit<AgentTask, "id" | "created_at">
  ): Promise<AgentResult> {
    const fullTask: AgentTask = {
      ...task,
      id: randomUUID(),
      created_at: Date.now(),
    };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/dispatch`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(fullTask),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return {
          agent_name: "unknown",
          task_id: fullTask.id,
          success: false,
          data: null,
          error: `HTTP ${response.status} - ${response.statusText}`,
          duration_ms: 0,
          findings: [],
        };
      }
      return (await response.json()) as AgentResult;
    } catch (error) {
      return {
        agent_name: "unknown",
        task_id: fullTask.id,
        success: false,
        data: null,
        error: (error as Error).message,
        duration_ms: 0,
        findings: [],
      };
    }
  }

  async dispatchParallel(
    tasks: Array<Omit<AgentTask, "id" | "created_at">>
  ): Promise<AgentResult[]> {
    const fullTasks: AgentTask[] = tasks.map((task) => ({
      ...task,
      id: randomUUID(),
      created_at: Date.now(),
    }));
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/dispatch/parallel`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ tasks: fullTasks }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return fullTasks.map((t) => ({
          agent_name: "unknown",
          task_id: t.id,
          success: false,
          data: null,
          error: `HTTP ${response.status} - ${response.statusText}`,
          duration_ms: 0,
          findings: [],
        }));
      }
      return (await response.json()) as AgentResult[];
    } catch (error) {
      return fullTasks.map((t) => ({
        agent_name: "unknown",
        task_id: t.id,
        success: false,
        data: null,
        error: (error as Error).message,
        duration_ms: 0,
        findings: [],
      }));
    }
  }

  async listAgents(): Promise<AgentInfo[]> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/agents`, {
        headers: this.getHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return [];
      }
      return (await response.json()) as AgentInfo[];
    } catch {
      return [];
    }
  }

  async createSession(): Promise<Session> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/sessions`, {
        method: "POST",
        headers: this.getHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return {
          id: "",
          status: "error",
          created_at: Date.now(),
          tasks: [],
          expires_at: 0,
        };
      }
      return (await response.json()) as Session;
    } catch (error) {
      return {
        id: "",
        status: "error",
        created_at: Date.now(),
        tasks: [],
        expires_at: 0,
        ...({ error: (error as Error).message } as Record<string, unknown>),
      };
    }
  }

  async getSession(id: string): Promise<Session | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/sessions/${id}`, {
        headers: this.getHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as Session;
    } catch {
      return null;
    }
  }

  async healthCheck(): Promise<{ status: string; service: string; version: string }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/health`, {
        headers: this.getHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return { status: "unhealthy", service: "orchestrator", version: "unknown" };
      }
      return (await response.json()) as { status: string; service: string; version: string };
    } catch {
      return { status: "unhealthy", service: "orchestrator", version: "unknown" };
    }
  }
}
