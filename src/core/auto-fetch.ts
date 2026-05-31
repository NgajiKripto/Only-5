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
  private intervals: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private backoffMultipliers: Map<string, number> = new Map();
  private running = false;
  private onData: OnDataCallback | null = null;
  private onHealth: OnHealthCallback | null = null;

  private static readonly BACKOFF_FACTOR = 2;
  private static readonly MAX_BACKOFF_MULTIPLIER = 5;

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
      status.nextFetch = Date.now();
    }

    this.backoffMultipliers.set(source.id, 1);

    // Perform immediate first fetch, then begin scheduling
    void this.fetchSource(source).then(() => {
      if (this.running && this.sources.has(source.id)) {
        this.scheduleNext(source);
      }
    });

    logger.debug(`Started source: ${source.name}`, { intervalMs: source.intervalMs });
  }

  private scheduleNext(source: DataSource): void {
    const multiplier = this.backoffMultipliers.get(source.id) ?? 1;
    const delay = source.intervalMs * multiplier;

    const timeout = setTimeout(() => {
      if (!this.running) return;
      void this.fetchSource(source).then(() => {
        if (this.running && this.sources.has(source.id)) {
          this.scheduleNext(source);
        }
      });
    }, delay);

    this.intervals.set(source.id, timeout);
  }

  private stopSource(sourceId: string): void {
    const timeout = this.intervals.get(sourceId);
    if (timeout) {
      clearTimeout(timeout);
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
      status.successCount += 1;
      status.lastError = null;

      // Reset backoff on success
      this.backoffMultipliers.set(source.id, 1);
      status.nextFetch = Date.now() + source.intervalMs;

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
      status.failCount += 1;
      status.lastError = errorMessage;

      // Exponential backoff: multiply current backoff, cap at MAX_BACKOFF_MULTIPLIER
      const currentMultiplier = this.backoffMultipliers.get(source.id) ?? 1;
      const newMultiplier = Math.min(
        currentMultiplier * AutoFetchManager.BACKOFF_FACTOR,
        AutoFetchManager.MAX_BACKOFF_MULTIPLIER
      );
      this.backoffMultipliers.set(source.id, newMultiplier);
      status.nextFetch = Date.now() + source.intervalMs * newMultiplier;

      if (this.onHealth) {
        this.onHealth(source.id, false, errorMessage);
      }

      logger.warn(`Fetch failed: ${source.name}`, { error: errorMessage, failCount: status.failCount, backoffMultiplier: newMultiplier });
    }
  }
}
