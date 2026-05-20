import { createLogger } from "../core/logger.js";
import type { TelegramBot } from "./bot.js";

const logger = createLogger("alerts");

export enum AlertType {
  PROFIT = "PROFIT",
  LOSS = "LOSS",
  ERROR = "ERROR",
  INFO = "INFO",
  WARNING = "WARNING",
}

interface QueuedAlert {
  type: AlertType;
  message: string;
  timestamp: number;
}

const ALERT_ICONS: Record<AlertType, string> = {
  [AlertType.PROFIT]: "\u2705",
  [AlertType.LOSS]: "\u274C",
  [AlertType.ERROR]: "\u26A0\uFE0F",
  [AlertType.INFO]: "\u2139\uFE0F",
  [AlertType.WARNING]: "\u26A0\uFE0F",
};

const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes per alert type

export class AlertManager {
  private bot: TelegramBot;
  private lastAlertTime: Map<AlertType, number> = new Map();
  private queue: QueuedAlert[] = [];
  private queueInterval: NodeJS.Timeout | null = null;

  constructor(bot: TelegramBot) {
    this.bot = bot;
    this.startQueueProcessor();
  }

  private startQueueProcessor(): void {
    this.queueInterval = setInterval(() => {
      this.processQueue();
    }, 30_000); // Check queue every 30 seconds
  }

  private processQueue(): void {
    const now = Date.now();
    const remaining: QueuedAlert[] = [];

    for (const alert of this.queue) {
      if (this.canSendAlert(alert.type, now)) {
        this.doSend(alert.type, alert.message);
      } else {
        remaining.push(alert);
      }
    }

    this.queue = remaining;
  }

  private canSendAlert(type: AlertType, now: number = Date.now()): boolean {
    const lastTime = this.lastAlertTime.get(type);
    if (!lastTime) return true;
    return now - lastTime >= RATE_LIMIT_MS;
  }

  private doSend(type: AlertType, message: string): void {
    const icon = ALERT_ICONS[type];
    const formatted = `${icon} <b>${type}</b>\n\n${message}`;
    this.lastAlertTime.set(type, Date.now());
    this.bot.sendAlert(formatted).catch((err) => {
      logger.error(`Failed to send alert: ${(err as Error).message}`);
    });
  }

  async sendAlert(type: AlertType, message: string): Promise<void> {
    if (this.canSendAlert(type)) {
      this.doSend(type, message);
    } else {
      this.queue.push({ type, message, timestamp: Date.now() });
      logger.debug(`Alert queued (rate limited): ${type}`);
    }
  }

  async onProfit(amount: number): Promise<void> {
    await this.sendAlert(
      AlertType.PROFIT,
      `Profit realized: +${amount.toFixed(4)} SOL`
    );
  }

  async onLoss(amount: number): Promise<void> {
    await this.sendAlert(
      AlertType.LOSS,
      `Loss recorded: ${amount.toFixed(4)} SOL`
    );
  }

  async onError(error: Error | string): Promise<void> {
    const msg = typeof error === "string" ? error : error.message;
    await this.sendAlert(AlertType.ERROR, `Error: ${msg}`);
  }

  async onLowBalance(balance: number): Promise<void> {
    await this.sendAlert(
      AlertType.WARNING,
      `Low balance warning: ${balance.toFixed(4)} SOL remaining`
    );
  }

  async onStrategyComplete(result: {
    strategy: string;
    success: boolean;
    profitLoss: number;
  }): Promise<void> {
    const icon = result.success ? "\u2705" : "\u274C";
    await this.sendAlert(
      AlertType.INFO,
      `Strategy ${icon} <b>${result.strategy}</b>\nResult: ${result.success ? "Success" : "Failed"}\nP&L: ${result.profitLoss >= 0 ? "+" : ""}${result.profitLoss.toFixed(4)} SOL`
    );
  }

  stop(): void {
    if (this.queueInterval) {
      clearInterval(this.queueInterval);
      this.queueInterval = null;
    }
  }
}
