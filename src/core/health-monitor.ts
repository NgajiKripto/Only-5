import { createLogger } from "./logger.js";

const logger = createLogger("health-monitor");

export interface ComponentHealth {
  status: "ok" | "error" | "starting" | "degraded";
  updatedAt: number;
  lastOk?: number;
  lastError?: string;
  restartCount: number;
}

export interface HealthSnapshot {
  pid: number;
  uptimeMs: number;
  updatedAt: number;
  components: Record<string, ComponentHealth>;
}

export class HealthMonitor {
  private components: Map<string, ComponentHealth> = new Map();
  private startedAt: number;

  constructor() {
    this.startedAt = Date.now();
    logger.info("Health monitor initialized");
  }

  markOk(component: string): void {
    const existing = this.components.get(component);
    const now = Date.now();
    this.components.set(component, {
      status: "ok",
      updatedAt: now,
      lastOk: now,
      lastError: undefined,
      restartCount: existing?.restartCount ?? 0,
    });
    logger.debug(`Component ${component} marked OK`);
  }

  markError(component: string, error: string): void {
    const existing = this.components.get(component);
    const now = Date.now();
    this.components.set(component, {
      status: "error",
      updatedAt: now,
      lastOk: existing?.lastOk,
      lastError: error,
      restartCount: existing?.restartCount ?? 0,
    });
    logger.warn(`Component ${component} error: ${error}`);
  }

  markDegraded(component: string, reason: string): void {
    const existing = this.components.get(component);
    const now = Date.now();
    this.components.set(component, {
      status: "degraded",
      updatedAt: now,
      lastOk: existing?.lastOk,
      lastError: reason,
      restartCount: existing?.restartCount ?? 0,
    });
    logger.warn(`Component ${component} degraded: ${reason}`);
  }

  bumpRestart(component: string): void {
    const existing = this.components.get(component);
    if (existing) {
      existing.restartCount += 1;
      existing.updatedAt = Date.now();
      this.components.set(component, existing);
    } else {
      this.components.set(component, {
        status: "starting",
        updatedAt: Date.now(),
        restartCount: 1,
      });
    }
    logger.info(`Component ${component} restart count bumped`);
  }

  getSnapshot(): HealthSnapshot {
    const now = Date.now();
    const components: Record<string, ComponentHealth> = {};
    for (const [name, health] of this.components) {
      components[name] = { ...health };
    }
    return {
      pid: process.pid,
      uptimeMs: now - this.startedAt,
      updatedAt: now,
      components,
    };
  }

  getStatus(component: string): ComponentHealth | undefined {
    const health = this.components.get(component);
    return health ? { ...health } : undefined;
  }

  isHealthy(): boolean {
    for (const health of this.components.values()) {
      if (health.status !== "ok" && health.status !== "starting") {
        return false;
      }
    }
    return true;
  }

  getUnhealthyComponents(): string[] {
    const unhealthy: string[] = [];
    for (const [name, health] of this.components) {
      if (health.status === "error" || health.status === "degraded") {
        unhealthy.push(name);
      }
    }
    return unhealthy;
  }
}
