import { ScannerClient } from "./scanner-client.js";
import { ExecutorClient } from "./executor-client.js";
import { OrchestratorClient } from "./orchestrator-client.js";

interface ServiceStatus {
  name: string;
  url: string;
  healthy: boolean;
  error?: string;
}

export { ScannerClient } from "./scanner-client.js";
export { ExecutorClient } from "./executor-client.js";
export { OrchestratorClient } from "./orchestrator-client.js";
export type { ServiceStatus };

export class ServiceManager {
  private scanner: ScannerClient;
  private executor: ExecutorClient;
  private orchestrator: OrchestratorClient;

  constructor(config?: {
    scannerUrl?: string;
    executorUrl?: string;
    orchestratorUrl?: string;
  }) {
    this.scanner = new ScannerClient(config?.scannerUrl);
    this.executor = new ExecutorClient(config?.executorUrl);
    this.orchestrator = new OrchestratorClient(config?.orchestratorUrl);
  }

  getScanner(): ScannerClient {
    return this.scanner;
  }

  getExecutor(): ExecutorClient {
    return this.executor;
  }

  getOrchestrator(): OrchestratorClient {
    return this.orchestrator;
  }

  async healthCheck(): Promise<ServiceStatus[]> {
    const [scannerHealth, executorHealth, orchestratorHealth] =
      await Promise.all([
        this.scanner.healthCheck(),
        this.executor.healthCheck(),
        this.orchestrator.healthCheck(),
      ]);

    return [
      {
        name: "Scanner (Python)",
        url: this.scanner.getBaseUrl(),
        healthy: scannerHealth.status === "healthy",
        error:
          scannerHealth.status !== "healthy" ? "Service unavailable" : undefined,
      },
      {
        name: "Executor (Rust)",
        url: this.executor.getBaseUrl(),
        healthy: executorHealth.status === "healthy",
        error:
          executorHealth.status !== "healthy"
            ? "Service unavailable"
            : undefined,
      },
      {
        name: "Orchestrator (Go)",
        url: this.orchestrator.getBaseUrl(),
        healthy: orchestratorHealth.status === "healthy",
        error:
          orchestratorHealth.status !== "healthy"
            ? "Service unavailable"
            : undefined,
      },
    ];
  }

  async isAllHealthy(): Promise<boolean> {
    const statuses = await this.healthCheck();
    return statuses.every((s) => s.healthy);
  }
}
