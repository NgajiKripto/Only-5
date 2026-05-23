import { createLogger } from "./logger.js";
import type { ConnectivityMonitor } from "./connectivity.js";
import type { HealthMonitor } from "./health-monitor.js";
import type { WalletManager } from "./wallet.js";

const logger = createLogger("scheduler-gate");

export interface GateCondition {
  name: string;
  check: () => boolean | Promise<boolean>;
  required?: boolean;
}

export interface SchedulerGateConfig {
  conditions: GateCondition[];
  requireAll?: boolean;
}

export class SchedulerGate {
  private conditions: GateCondition[];
  private requireAll: boolean;

  constructor(config: SchedulerGateConfig) {
    this.conditions = [...config.conditions];
    this.requireAll = config.requireAll ?? true;
    logger.info("Scheduler gate initialized", {
      conditionCount: this.conditions.length,
      requireAll: this.requireAll,
    });
  }

  addCondition(condition: GateCondition): void {
    this.conditions.push(condition);
    logger.debug(`Condition added: ${condition.name}`);
  }

  removeCondition(name: string): void {
    this.conditions = this.conditions.filter((c) => c.name !== name);
    logger.debug(`Condition removed: ${name}`);
  }

  async canProceed(): Promise<{ allowed: boolean; failedConditions: string[] }> {
    const failedConditions: string[] = [];

    for (const condition of this.conditions) {
      try {
        const result = await condition.check();
        if (!result) {
          failedConditions.push(condition.name);
        }
      } catch (error) {
        logger.warn(`Condition check failed: ${condition.name}`, {
          error: (error as Error).message,
        });
        failedConditions.push(condition.name);
      }
    }

    let allowed: boolean;
    if (this.requireAll) {
      allowed = failedConditions.length === 0;
    } else {
      // At least one condition must pass
      allowed = failedConditions.length < this.conditions.length;
    }

    if (!allowed) {
      logger.warn("Gate blocked", { failedConditions });
    }

    return { allowed, failedConditions };
  }
}

export function connectivityGate(monitor: ConnectivityMonitor): GateCondition {
  return {
    name: "connectivity",
    check: () => monitor.isOnline(),
  };
}

export function healthGate(monitor: HealthMonitor): GateCondition {
  return {
    name: "health",
    check: () => monitor.isHealthy(),
  };
}

export function balanceGate(wallet: WalletManager, minBalance: number): GateCondition {
  return {
    name: "balance",
    check: async () => {
      const balance = await wallet.getBalance();
      return balance > minBalance;
    },
  };
}

export function timeWindowGate(startHour: number, endHour: number): GateCondition {
  return {
    name: "time-window",
    check: () => {
      const hour = new Date().getUTCHours();
      if (startHour <= endHour) {
        return hour >= startHour && hour < endHour;
      }
      // Handles overnight windows (e.g., 22:00 to 06:00)
      return hour >= startHour || hour < endHour;
    },
  };
}

export function cooldownGate(lastExecTime: () => number, cooldownMs: number): GateCondition {
  return {
    name: "cooldown",
    check: () => {
      const elapsed = Date.now() - lastExecTime();
      return elapsed >= cooldownMs;
    },
  };
}
