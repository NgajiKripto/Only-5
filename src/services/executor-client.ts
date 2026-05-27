import { config } from "../config.js";

interface ExecutionRequest {
  command: string;
  args: string[];
  timeout_ms?: number;
  working_dir?: string;
}

interface ExecutionResult {
  id: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  duration_ms: number;
  findings: Array<{ line: number; content: string; finding_type: string }>;
  error?: string;
}

interface ValidationResult {
  valid: boolean;
  command: string;
  reason?: string;
}

interface SanitizeResult {
  original: string;
  sanitized: string;
  changes: string[];
}

export type { ExecutionRequest, ExecutionResult, ValidationResult, SanitizeResult };

const DEFAULT_TIMEOUT_MS = 30000;

export class ExecutorClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? process.env.EXECUTOR_SERVICE_URL ?? "http://localhost:7003";
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

  async execute(
    command: string,
    args: string[],
    options?: { timeoutMs?: number; workingDir?: string }
  ): Promise<ExecutionResult> {
    const body: ExecutionRequest = {
      command,
      args,
      timeout_ms: options?.timeoutMs,
      working_dir: options?.workingDir,
    };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/execute`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return {
          id: "",
          success: false,
          stdout: "",
          stderr: `HTTP ${response.status} - ${response.statusText}`,
          exit_code: null,
          duration_ms: 0,
          findings: [],
          error: `HTTP ${response.status} - ${response.statusText}`,
        };
      }
      return (await response.json()) as ExecutionResult;
    } catch (error) {
      return {
        id: "",
        success: false,
        stdout: "",
        stderr: (error as Error).message,
        exit_code: null,
        duration_ms: 0,
        findings: [],
        error: (error as Error).message,
      };
    }
  }

  async validate(command: string, args: string[]): Promise<ValidationResult> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/validate`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ command, args }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return {
          valid: false,
          command,
          reason: `HTTP ${response.status} - ${response.statusText}`,
        };
      }
      return (await response.json()) as ValidationResult;
    } catch (error) {
      return {
        valid: false,
        command,
        reason: (error as Error).message,
      };
    }
  }

  async sanitize(input: string): Promise<SanitizeResult> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/sanitize`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ input }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return {
          original: input,
          sanitized: input,
          changes: [`Error: HTTP ${response.status}`],
        };
      }
      return (await response.json()) as SanitizeResult;
    } catch (error) {
      return {
        original: input,
        sanitized: input,
        changes: [`Error: ${(error as Error).message}`],
      };
    }
  }

  async healthCheck(): Promise<{ status: string; service: string; version: string }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return { status: "unhealthy", service: "executor", version: "unknown" };
      }
      return (await response.json()) as { status: string; service: string; version: string };
    } catch {
      return { status: "unhealthy", service: "executor", version: "unknown" };
    }
  }
}
