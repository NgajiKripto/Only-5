import { config } from "../config.js";

interface ScanRequest {
  target: string;
  workflow: string;
  params?: Record<string, unknown>;
}

interface Finding {
  type: string;
  severity: string;
  title: string;
  description: string;
  evidence?: string;
  recommendation?: string;
}

interface ScanResult {
  target: string;
  workflow: string;
  timestamp: number;
  findings: Finding[];
  score: number;
  summary: string;
}

interface WorkflowInfo {
  name: string;
  description: string;
  steps: number;
}

export type { ScanRequest, Finding, ScanResult, WorkflowInfo };

const DEFAULT_TIMEOUT_MS = 30000;

export class ScannerClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? process.env.SCANNER_SERVICE_URL ?? "http://localhost:7001";
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

  async scan(
    target: string,
    workflow: string,
    params?: Record<string, unknown>
  ): Promise<ScanResult> {
    const body: ScanRequest = { target, workflow, params };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/scan`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return {
          target,
          workflow,
          timestamp: Date.now(),
          findings: [],
          score: 0,
          summary: `Error: HTTP ${response.status} - ${response.statusText}`,
        };
      }
      return (await response.json()) as ScanResult;
    } catch (error) {
      return {
        target,
        workflow,
        timestamp: Date.now(),
        findings: [],
        score: 0,
        summary: `Error: ${(error as Error).message}`,
      };
    }
  }

  async scanFull(target: string): Promise<ScanResult[]> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/scan/full`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ target }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return [
          {
            target,
            workflow: "full",
            timestamp: Date.now(),
            findings: [],
            score: 0,
            summary: `Error: HTTP ${response.status} - ${response.statusText}`,
          },
        ];
      }
      return (await response.json()) as ScanResult[];
    } catch (error) {
      return [
        {
          target,
          workflow: "full",
          timestamp: Date.now(),
          findings: [],
          score: 0,
          summary: `Error: ${(error as Error).message}`,
        },
      ];
    }
  }

  async listWorkflows(): Promise<WorkflowInfo[]> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/workflows`, {
        headers: this.getHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return [];
      }
      return (await response.json()) as WorkflowInfo[];
    } catch {
      return [];
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
        return { status: "unhealthy", service: "scanner", version: "unknown" };
      }
      return (await response.json()) as { status: string; service: string; version: string };
    } catch {
      return { status: "unhealthy", service: "scanner", version: "unknown" };
    }
  }
}
