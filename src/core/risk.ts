import { createLogger } from "./logger.js";
import type { MemorySystem } from "./memory.js";

const logger = createLogger("risk");

export interface RiskLimits {
  maxDailyLoss: number; // percentage of starting balance (0-1), default 0.20
  maxTradeSize: number; // percentage of current balance (0-1), default 0.10
  maxExposure: number; // percentage of balance for open positions (0-1), default 0.50
  cooldownAfterLoss: number; // minutes to pause after a loss, default 30
  minBalance: number; // minimum SOL balance (for rent), default 0.1
}

export interface TradeCheck {
  allowed: boolean;
  reason?: string;
}

export interface DailyPnL {
  profit: number;
  loss: number;
  net: number;
  tradeCount: number;
}

interface TradeRecord {
  amount: number;
  result: number; // positive = profit, negative = loss
  timestamp: number;
}

const DEFAULT_LIMITS: RiskLimits = {
  maxDailyLoss: 0.20,
  maxTradeSize: 0.10,
  maxExposure: 0.50,
  cooldownAfterLoss: 30,
  minBalance: 0.1,
};

export class RiskManager {
  private limits: RiskLimits;
  private trades: TradeRecord[] = [];
  private startingBalance: number;
  private currentBalance: number;
  private lastLossTime: number = 0;
  private memory: MemorySystem | null;
  private openPositions: number = 0;

  constructor(
    balance: number,
    limits?: Partial<RiskLimits>,
    memory?: MemorySystem
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.startingBalance = balance;
    this.currentBalance = balance;
    this.memory = memory ?? null;

    // Restore state from memory if available
    this.restoreState();

    logger.info("Risk manager initialized", {
      balance,
      limits: this.limits,
    });
  }

  canTrade(amount: number): TradeCheck {
    // Check if in cooldown
    if (this.isInCooldown()) {
      const remaining = this.getCooldownRemaining();
      return {
        allowed: false,
        reason: `In cooldown after loss. ${Math.ceil(remaining / 60000)} minutes remaining.`,
      };
    }

    // Check minimum balance protection
    if (this.currentBalance - amount < this.limits.minBalance) {
      return {
        allowed: false,
        reason: `Trade would reduce balance below minimum (${this.limits.minBalance} SOL).`,
      };
    }

    // Check max trade size
    const maxSize = this.currentBalance * this.limits.maxTradeSize;
    if (amount > maxSize) {
      return {
        allowed: false,
        reason: `Trade size (${amount.toFixed(4)} SOL) exceeds maximum (${maxSize.toFixed(4)} SOL, ${this.limits.maxTradeSize * 100}% of balance).`,
      };
    }

    // Check daily loss limit
    const dailyPnl = this.getDailyPnL();
    const maxLoss = this.startingBalance * this.limits.maxDailyLoss;
    if (Math.abs(dailyPnl.loss) >= maxLoss) {
      return {
        allowed: false,
        reason: `Daily loss limit reached (${Math.abs(dailyPnl.loss).toFixed(4)} SOL lost, max ${maxLoss.toFixed(4)} SOL).`,
      };
    }

    // Check max exposure (cumulative open positions + this trade)
    const maxExposureAmount = this.currentBalance * this.limits.maxExposure;
    const totalExposure = this.openPositions + amount;
    if (totalExposure > maxExposureAmount) {
      return {
        allowed: false,
        reason: `Total exposure (${totalExposure.toFixed(4)} SOL) would exceed max exposure (${maxExposureAmount.toFixed(4)} SOL, ${this.limits.maxExposure * 100}% of balance).`,
      };
    }

    return { allowed: true };
  }

  recordTrade(amount: number, result: number): void {
    const trade: TradeRecord = {
      amount,
      result,
      timestamp: Date.now(),
    };

    this.trades.push(trade);
    this.currentBalance += result;

    if (result < 0) {
      this.lastLossTime = Date.now();
      logger.warn(`Loss recorded: ${result} SOL`, {
        newBalance: this.currentBalance,
      });
    } else {
      logger.info(`Profit recorded: ${result} SOL`, {
        newBalance: this.currentBalance,
      });
    }

    this.persistState();
  }

  openPosition(amount: number): void {
    this.openPositions += amount;
    logger.debug(`Position opened: ${amount} SOL, total open: ${this.openPositions} SOL`);
  }

  closePosition(amount: number): void {
    this.openPositions = Math.max(0, this.openPositions - amount);
    logger.debug(`Position closed: ${amount} SOL, total open: ${this.openPositions} SOL`);
  }

  getOpenPositions(): number {
    return this.openPositions;
  }

  getDailyPnL(): DailyPnL {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const cutoff = todayStart.getTime();

    const todayTrades = this.trades.filter((t) => t.timestamp >= cutoff);

    let profit = 0;
    let loss = 0;

    for (const trade of todayTrades) {
      if (trade.result > 0) {
        profit += trade.result;
      } else {
        loss += trade.result;
      }
    }

    return {
      profit,
      loss,
      net: profit + loss,
      tradeCount: todayTrades.length,
    };
  }

  isInCooldown(): boolean {
    if (this.lastLossTime === 0) return false;
    const cooldownMs = this.limits.cooldownAfterLoss * 60 * 1000;
    return Date.now() - this.lastLossTime < cooldownMs;
  }

  resetDaily(): void {
    this.trades = this.trades.filter((t) => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      return t.timestamp >= todayStart.getTime();
    });

    this.startingBalance = this.currentBalance;
    logger.info("Daily risk counters reset", {
      newStartingBalance: this.startingBalance,
    });

    this.persistState();
  }

  updateBalance(balance: number): void {
    this.currentBalance = balance;
  }

  getLimits(): RiskLimits {
    return { ...this.limits };
  }

  getCurrentBalance(): number {
    return this.currentBalance;
  }

  private getCooldownRemaining(): number {
    const cooldownMs = this.limits.cooldownAfterLoss * 60 * 1000;
    return Math.max(0, cooldownMs - (Date.now() - this.lastLossTime));
  }

  private persistState(): void {
    if (!this.memory) return;

    try {
      this.memory.remember(
        "risk_state",
        JSON.stringify({
          trades: this.trades.slice(-100), // Keep last 100 trades
          startingBalance: this.startingBalance,
          currentBalance: this.currentBalance,
          lastLossTime: this.lastLossTime,
          openPositions: this.openPositions,
        })
      );
    } catch (error) {
      logger.error("Failed to persist risk state", {
        error: (error as Error).message,
      });
    }
  }

  private restoreState(): void {
    if (!this.memory) return;

    try {
      const states = this.memory.recall("risk_state", 1);
      if (states.length > 0) {
        const state = JSON.parse(states[0].content);
        this.trades = state.trades ?? [];
        this.lastLossTime = state.lastLossTime ?? 0;
        this.openPositions = state.openPositions ?? 0;
        logger.info("Risk state restored from memory", {
          tradeCount: this.trades.length,
          openPositions: this.openPositions,
        });
      }
    } catch (error) {
      logger.debug("No previous risk state to restore", {
        error: (error as Error).message,
      });
    }
  }
}
