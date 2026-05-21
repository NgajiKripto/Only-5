import { createLogger } from "./logger.js";
import { MemorySystem } from "./memory.js";
import { PriorityTier, StrategyPriorityRecord } from "../types/index.js";

const logger = createLogger("strategy-priority");

const TIER_ORDER: Record<PriorityTier, number> = {
  [PriorityTier.CRITICAL]: 0,
  [PriorityTier.HIGH]: 1,
  [PriorityTier.MEDIUM]: 2,
  [PriorityTier.LOW]: 3,
  [PriorityTier.DORMANT]: 4,
};

const TIER_UPGRADE: Record<PriorityTier, PriorityTier> = {
  [PriorityTier.DORMANT]: PriorityTier.MEDIUM,
  [PriorityTier.LOW]: PriorityTier.MEDIUM,
  [PriorityTier.MEDIUM]: PriorityTier.HIGH,
  [PriorityTier.HIGH]: PriorityTier.CRITICAL,
  [PriorityTier.CRITICAL]: PriorityTier.CRITICAL,
};

export class StrategyPriorityManager {
  private memory: MemorySystem;
  private priorities: Map<string, StrategyPriorityRecord> = new Map();

  constructor({ memory }: { memory: MemorySystem }) {
    this.memory = memory;
  }

  calculateScore(strategy: string): number {
    const perf = this.memory.getStrategyPerformance(strategy);

    // Revenue rate: count of successful revenue decisions in last 7 days / 168 hours
    // We use totalReward as a proxy normalized against a reasonable max
    const revenueRate = Math.min(perf.totalReward / 168, 1);

    // Success rate from performance data
    const successRate = perf.successRate;

    // Consecutive failures penalty
    const existing = this.priorities.get(strategy);
    const consecutiveFailures = existing?.consecutiveFailures ?? 0;
    const failurePenalty = consecutiveFailures * 0.1;

    // Recency bonus: if there's recent revenue, give a boost
    const lastRevenueAt = existing?.lastRevenueAt ?? null;
    let recencyBonus = 0;
    if (lastRevenueAt !== null) {
      const hoursSince = (Date.now() - lastRevenueAt) / (1000 * 60 * 60);
      if (hoursSince < 24) {
        recencyBonus = 1.0;
      } else if (hoursSince < 72) {
        recencyBonus = 0.5;
      } else {
        recencyBonus = 0.1;
      }
    }

    // Weight: 40% revenue rate, 40% success rate, 20% recency bonus
    const rawScore = 0.4 * revenueRate + 0.4 * successRate + 0.2 * recencyBonus - failurePenalty;

    // Clamp 0-1
    return Math.max(0, Math.min(1, rawScore));
  }

  getTier(score: number, consecutiveFailures: number, hoursSinceRevenue: number | null): PriorityTier {
    if (consecutiveFailures >= 5) return PriorityTier.LOW;
    if (hoursSinceRevenue !== null && hoursSinceRevenue > 168) return PriorityTier.DORMANT;
    if (score > 0.8) return PriorityTier.CRITICAL;
    if (score > 0.6) return PriorityTier.HIGH;
    if (score > 0.3) return PriorityTier.MEDIUM;
    return PriorityTier.LOW;
  }

  recalculateAll(strategyNames: string[]): void {
    for (const strategy of strategyNames) {
      const score = this.calculateScore(strategy);
      const existing = this.priorities.get(strategy);
      const consecutiveFailures = existing?.consecutiveFailures ?? 0;
      const lastRevenueAt = existing?.lastRevenueAt ?? null;

      let hoursSinceRevenue: number | null = null;
      if (lastRevenueAt !== null) {
        hoursSinceRevenue = (Date.now() - lastRevenueAt) / (1000 * 60 * 60);
      }

      const tier = this.getTier(score, consecutiveFailures, hoursSinceRevenue);
      const record: StrategyPriorityRecord = {
        strategy,
        tier,
        score,
        consecutiveFailures,
        lastRevenueAt,
        updatedAt: Date.now(),
      };

      this.priorities.set(strategy, record);
      this.memory.saveStrategyPriority(record);
      logger.debug(`Recalculated ${strategy}`, { tier, score });
    }
  }

  recordSuccess(strategy: string): void {
    const existing = this.priorities.get(strategy) ?? this.memory.getStrategyPriority(strategy);
    const now = Date.now();
    const currentTier = existing?.tier ?? PriorityTier.MEDIUM;
    const upgradedTier = TIER_UPGRADE[currentTier];
    const score = this.calculateScore(strategy);

    const record: StrategyPriorityRecord = {
      strategy,
      tier: upgradedTier,
      score,
      consecutiveFailures: 0,
      lastRevenueAt: now,
      updatedAt: now,
    };

    this.priorities.set(strategy, record);
    this.memory.saveStrategyPriority(record);
    logger.info(`Recorded success for ${strategy}`, { tier: upgradedTier, score });
  }

  recordFailure(strategy: string): void {
    const existing = this.priorities.get(strategy) ?? this.memory.getStrategyPriority(strategy);
    const now = Date.now();
    const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1;
    const tier = consecutiveFailures >= 5 ? PriorityTier.LOW : (existing?.tier ?? PriorityTier.MEDIUM);

    const record: StrategyPriorityRecord = {
      strategy,
      tier,
      score: existing?.score ?? 0.5,
      consecutiveFailures,
      lastRevenueAt: existing?.lastRevenueAt ?? null,
      updatedAt: now,
    };

    this.priorities.set(strategy, record);
    this.memory.saveStrategyPriority(record);
    logger.info(`Recorded failure for ${strategy}`, { consecutiveFailures, tier });
  }

  getPrioritizedStrategies(): StrategyPriorityRecord[] {
    const records = this.memory.getStrategyPriorities();
    return records.sort((a, b) => {
      const tierDiff = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
      if (tierDiff !== 0) return tierDiff;
      return b.score - a.score;
    });
  }

  boostStrategy(strategy: string): void {
    const existing = this.priorities.get(strategy) ?? this.memory.getStrategyPriority(strategy);
    const now = Date.now();
    const currentScore = existing?.score ?? 0.5;
    const newScore = Math.min(1.0, currentScore + 0.2);
    const currentTier = existing?.tier ?? PriorityTier.MEDIUM;
    const upgradedTier = TIER_UPGRADE[currentTier];

    const record: StrategyPriorityRecord = {
      strategy,
      tier: upgradedTier,
      score: newScore,
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
      lastRevenueAt: existing?.lastRevenueAt ?? null,
      updatedAt: now,
    };

    this.priorities.set(strategy, record);
    this.memory.saveStrategyPriority(record);
    logger.info(`Boosted strategy ${strategy}`, { tier: upgradedTier, score: newScore });
  }

  loadFromDatabase(): void {
    const records = this.memory.getStrategyPriorities();
    this.priorities.clear();
    for (const record of records) {
      this.priorities.set(record.strategy, record);
    }
    logger.info(`Loaded ${records.length} strategy priorities from database`);
  }
}
