import { createLogger } from "./logger.js";

const logger = createLogger("connectivity");

export interface ConnectivityEndpoint {
  name: string;
  url: string;
  method?: string;
  critical?: boolean;
}

export interface ConnectivityStatus {
  endpoint: string;
  reachable: boolean;
  latencyMs: number;
  lastChecked: number;
  consecutiveFailures: number;
}

export interface ConnectivityConfig {
  endpoints: ConnectivityEndpoint[];
  checkIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_ENDPOINTS: ConnectivityEndpoint[] = [
  { name: "solana-rpc", url: "https://api.mainnet-beta.solana.com", method: "GET", critical: true },
  { name: "openrouter-api", url: "https://openrouter.ai/api/v1/models", method: "GET", critical: true },
];

export class ConnectivityMonitor {
  private statuses: Map<string, ConnectivityStatus> = new Map();
  private endpoints: ConnectivityEndpoint[];
  private timeoutMs: number;
  private callbacks: Array<(endpoint: string, reachable: boolean) => void> = [];

  constructor(config?: ConnectivityConfig) {
    this.endpoints = config?.endpoints ?? DEFAULT_ENDPOINTS;
    this.timeoutMs = config?.timeoutMs ?? 5000;

    // Initialize statuses
    for (const ep of this.endpoints) {
      this.statuses.set(ep.name, {
        endpoint: ep.name,
        reachable: false,
        latencyMs: 0,
        lastChecked: 0,
        consecutiveFailures: 0,
      });
    }

    logger.info("Connectivity monitor initialized", {
      endpoints: this.endpoints.map((e) => e.name),
      timeoutMs: this.timeoutMs,
    });
  }

  async checkEndpoint(endpoint: ConnectivityEndpoint): Promise<ConnectivityStatus> {
    const start = Date.now();
    const existing = this.statuses.get(endpoint.name);
    const previousReachable = existing?.reachable ?? false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(endpoint.url, {
        method: endpoint.method ?? "GET",
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const latencyMs = Date.now() - start;
      const reachable = response.ok || response.status < 500;

      const status: ConnectivityStatus = {
        endpoint: endpoint.name,
        reachable,
        latencyMs,
        lastChecked: Date.now(),
        consecutiveFailures: reachable ? 0 : (existing?.consecutiveFailures ?? 0) + 1,
      };

      this.statuses.set(endpoint.name, status);

      if (previousReachable !== reachable) {
        this.notifyStatusChange(endpoint.name, reachable);
      }

      logger.debug(`Endpoint ${endpoint.name} check: ${reachable ? "ok" : "failed"}`, { latencyMs });
      return status;
    } catch (error) {
      const latencyMs = Date.now() - start;
      const status: ConnectivityStatus = {
        endpoint: endpoint.name,
        reachable: false,
        latencyMs,
        lastChecked: Date.now(),
        consecutiveFailures: (existing?.consecutiveFailures ?? 0) + 1,
      };

      this.statuses.set(endpoint.name, status);

      if (previousReachable !== false) {
        this.notifyStatusChange(endpoint.name, false);
      }

      logger.warn(`Endpoint ${endpoint.name} unreachable`, {
        error: (error as Error).message,
        consecutiveFailures: status.consecutiveFailures,
      });
      return status;
    }
  }

  async checkAll(): Promise<ConnectivityStatus[]> {
    const results: ConnectivityStatus[] = [];
    for (const endpoint of this.endpoints) {
      const status = await this.checkEndpoint(endpoint);
      results.push(status);
    }
    return results;
  }

  isOnline(): boolean {
    const criticalEndpoints = this.endpoints.filter((e) => e.critical !== false);
    let anyChecked = false;
    for (const ep of criticalEndpoints) {
      const status = this.statuses.get(ep.name);
      if (status && status.lastChecked > 0) {
        anyChecked = true;
        if (status.reachable) {
          return true;
        }
      }
    }
    // If no critical endpoint has been checked yet, assume online
    if (!anyChecked) {
      return true;
    }
    return false;
  }

  getStatus(): Map<string, ConnectivityStatus> {
    return new Map(this.statuses);
  }

  onStatusChange(callback: (endpoint: string, reachable: boolean) => void): void {
    this.callbacks.push(callback);
  }

  private notifyStatusChange(endpoint: string, reachable: boolean): void {
    for (const cb of this.callbacks) {
      try {
        cb(endpoint, reachable);
      } catch (error) {
        logger.error("Status change callback error", { error: (error as Error).message });
      }
    }
  }
}
