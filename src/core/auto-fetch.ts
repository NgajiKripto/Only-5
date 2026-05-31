import { createLogger } from "./logger.js";

const logger = createLogger("auto-fetch");

export interface DataSource {
  id: string;
  name: string;
  fetchFn: () => Promise<unknown>;
  intervalMs: number;
  priority: number;
  enabled: boolean;
}

export interface FetchStatus {
  sourceId: string;
  sourceName: string;
  lastFetch: number | null;
  nextFetch: number | null;
  successCount: number;
  failCount: number;
  lastError: string | null;
  enabled: boolean;
}

export interface MarketDataSource extends DataSource {
  id: "market-data";
  name: "Market Data";
}

export interface BountyPlatformSource extends DataSource {
  id: "bounty-platform";
  name: "Bounty Platform";
}

export interface GitHubIssuesSource extends DataSource {
  id: "github-issues";
  name: "GitHub Issues";
}

export type OnDataCallback = (sourceId: string, data: unknown) => void | Promise<void>;
export type OnHealthCallback = (sourceId: string, healthy: boolean, error?: string) => void;

export class AutoFetchManager {
  private sources: Map<string, DataSource> = new Map();
  private statuses: Map<string, FetchStatus> = new Map();
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private running = false;
  private onData: OnDataCallback | null = null;
  private onHealth: OnHealthCallback | null = null;

  constructor() {
    logger.info("Auto-fetch manager initialized");
  }

  setOnData(callback: OnDataCallback): void {
    this.onData = callback;
  }

  setOnHealth(callback: OnHealthCallback): void {
    this.onHealth = callback;
  }

  registerSource(source: DataSource): void {
    if (source.priority < 1 || source.priority > 10) {
      throw new Error(`Invalid priority ${source.priority} for source ${source.id}. Must be 1-10.`);
    }
    this.sources.set(source.id, source);
    this.statuses.set(source.id, {
      sourceId: source.id,
      sourceName: source.name,
      lastFetch: null,
      nextFetch: null,
      successCount: 0,
      failCount: 0,
      lastError: null,
      enabled: source.enabled,
    });
    logger.info(`Registered source: ${source.name}`, { id: source.id, intervalMs: source.intervalMs });

    if (this.running && source.enabled) {
      this.startSource(source);
    }
  }

  unregisterSource(sourceId: string): void {
    this.stopSource(sourceId);
    this.sources.delete(sourceId);
    this.statuses.delete(sourceId);
    logger.info(`Unregistered source: ${sourceId}`);
  }

  start(): void {
    if (this.running) {
      logger.warn("Auto-fetch manager already running");
      return;
    }
    this.running = true;
    for (const source of this.sources.values()) {
      if (source.enabled) {
        this.startSource(source);
      }
    }
    logger.info("Auto-fetch manager started", { sourceCount: this.sources.size });
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    for (const sourceId of this.intervals.keys()) {
      this.stopSource(sourceId);
    }
    logger.info("Auto-fetch manager stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  getStatus(): FetchStatus[] {
    return [...this.statuses.values()];
  }

  getSourceStatus(sourceId: string): FetchStatus | undefined {
    const status = this.statuses.get(sourceId);
    return status ? { ...status } : undefined;
  }

  private startSource(source: DataSource): void {
    const status = this.statuses.get(source.id);
    if (status) {
      status.nextFetch = Date.now() + source.intervalMs;
    }

    const interval = setInterval(() => {
      void this.fetchSource(source);
    }, source.intervalMs);

    this.intervals.set(source.id, interval);
    logger.debug(`Started source: ${source.name}`, { intervalMs: source.intervalMs });
  }

  private stopSource(sourceId: string): void {
    const interval = this.intervals.get(sourceId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(sourceId);
    }
    const status = this.statuses.get(sourceId);
    if (status) {
      status.nextFetch = null;
    }
  }

  private async fetchSource(source: DataSource): Promise<void> {
    const status = this.statuses.get(source.id);
    if (!status) return;

    try {
      const data = await source.fetchFn();
      status.lastFetch = Date.now();
      status.nextFetch = Date.now() + source.intervalMs;
      status.successCount += 1;
      status.lastError = null;

      if (this.onHealth) {
        this.onHealth(source.id, true);
      }

      if (this.onData) {
        await this.onData(source.id, data);
      }

      logger.debug(`Fetch successful: ${source.name}`, { successCount: status.successCount });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      status.lastFetch = Date.now();
      status.nextFetch = Date.now() + source.intervalMs;
      status.failCount += 1;
      status.lastError = errorMessage;

      if (this.onHealth) {
        this.onHealth(source.id, false, errorMessage);
      }

      logger.warn(`Fetch failed: ${source.name}`, { error: errorMessage, failCount: status.failCount });
    }
  }
}
