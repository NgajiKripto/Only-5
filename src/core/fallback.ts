import { createLogger } from "./logger.js";
import { MemorySystem } from "./memory.js";
import { FallbackMode, FallbackState } from "../types/index.js";

const logger = createLogger("fallback");

export class FallbackSystem {
  private memory: MemorySystem;
  private currentMode: FallbackMode = FallbackMode.NORMAL;
  private enteredAt: number = Date.now();
  private lastRevenueAt: number | null = null;
  private onModeChange?: (oldMode: FallbackMode, newMode: FallbackMode) => void;

  constructor({ memory, onModeChange }: { memory: MemorySystem; onModeChange?: (oldMode: FallbackMode, newMode: FallbackMode) => void }) {
    this.memory = memory;
    this.onModeChange = onModeChange;
  }

  checkAndUpdateMode(): FallbackMode {
    const lastRevenue = this.memory.getLastRevenueTimestamp();
    this.lastRevenueAt = lastRevenue;

    let targetMode: FallbackMode;

    if (lastRevenue === null) {
      targetMode = FallbackMode.CONCERN;
    } else {
      const hoursSince = (Date.now() - lastRevenue) / (1000 * 60 * 60);
      if (hoursSince < 12) {
        targetMode = FallbackMode.NORMAL;
      } else if (hoursSince < 24) {
        targetMode = FallbackMode.CONCERN;
      } else if (hoursSince < 72) {
        targetMode = FallbackMode.SURVIVAL;
      } else {
        targetMode = FallbackMode.PIVOT;
      }
    }

    if (targetMode !== this.currentMode) {
      const oldMode = this.currentMode;
      this.currentMode = targetMode;
      this.enteredAt = Date.now();
      logger.info(`Mode changed: ${oldMode} -> ${targetMode}`);
      if (this.onModeChange) {
        this.onModeChange(oldMode, targetMode);
      }
    }

    return this.currentMode;
  }

  getMode(): FallbackMode {
    return this.currentMode;
  }

  getState(): FallbackState {
    return {
      mode: this.currentMode,
      enteredAt: this.enteredAt,
      lastRevenueAt: this.lastRevenueAt,
    };
  }

  getConfidenceThreshold(): number {
    switch (this.currentMode) {
      case FallbackMode.NORMAL:
        return 0.5;
      case FallbackMode.CONCERN:
        return 0.3;
      case FallbackMode.SURVIVAL:
        return 0.1;
      case FallbackMode.PIVOT:
        return 0.0;
    }
  }

  getEvaluationIntervalSeconds(): number {
    switch (this.currentMode) {
      case FallbackMode.NORMAL:
        return 30;
      case FallbackMode.CONCERN:
        return 15;
      case FallbackMode.SURVIVAL:
        return 10;
      case FallbackMode.PIVOT:
        return 10;
    }
  }

  shouldSkipLowPriority(): boolean {
    return this.currentMode === FallbackMode.NORMAL;
  }

  getDescription(): string {
    let revenueDesc: string;
    if (this.lastRevenueAt === null) {
      revenueDesc = "no revenue recorded";
    } else {
      const hoursSince = (Date.now() - this.lastRevenueAt) / (1000 * 60 * 60);
      if (hoursSince < 1) {
        const minutesSince = Math.floor(hoursSince * 60);
        revenueDesc = `revenue ${minutesSince}m ago`;
      } else {
        revenueDesc = `revenue ${Math.floor(hoursSince)}h ago`;
      }
    }
    return `${this.currentMode} mode (${revenueDesc})`;
  }
}
