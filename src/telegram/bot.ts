import { Bot, GrammyError, HttpError } from "grammy";
import { timingSafeEqual } from "crypto";
import { config, authPassphrase } from "../config.js";
import { createLogger } from "../core/logger.js";
import type { AgentController } from "../core/agent.js";
import type { MemorySystem } from "../core/memory.js";

const logger = createLogger("telegram-bot");

const PASSPHRASE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_AUTH_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export class TelegramBot {
  private bot: Bot;
  private agent: AgentController;
  private authorizedChatIds: Set<number> = new Set();
  private started: boolean = false;
  private passphraseUsed: boolean = false;
  private passphraseCreatedAt: number = Date.now();
  private memory: MemorySystem | null = null;
  private failedAttempts: Map<number, { count: number; blockedUntil: number }> = new Map();

  constructor(agent: AgentController, authorizedChatIds?: number[]) {
    this.agent = agent;
    this.bot = new Bot(config.TELEGRAM_BOT_TOKEN);

    // Get memory system if available for persisting authorized chat IDs
    try {
      this.memory = agent.getMemory();
    } catch {
      // Memory may not be available in all contexts (e.g., tests)
    }

    // If TELEGRAM_OWNER_CHAT_ID is configured, pre-authorize it
    if (config.TELEGRAM_OWNER_CHAT_ID) {
      const ownerChatId = parseInt(config.TELEGRAM_OWNER_CHAT_ID, 10);
      if (!isNaN(ownerChatId)) {
        this.authorizedChatIds.add(ownerChatId);
        logger.info(`Pre-authorized owner chat ID: ${ownerChatId}`);
      }
    }

    if (authorizedChatIds && authorizedChatIds.length > 0) {
      for (const id of authorizedChatIds) {
        this.authorizedChatIds.add(id);
      }
    }

    // Load persisted authorized chat IDs from DB
    this.loadAuthorizedChatIds();

    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.bot.catch((err) => {
      const ctx = err.ctx;
      const e = err.error;

      if (e instanceof GrammyError) {
        logger.error(`Grammy error while handling update ${ctx.update.update_id}:`, {
          error: e.message,
        });
      } else if (e instanceof HttpError) {
        logger.error(`HTTP error while handling update:`, {
          error: e.message,
        });
      } else {
        logger.error(`Unknown error while handling update:`, {
          error: (e as Error).message,
        });
      }
    });
  }

  private loadAuthorizedChatIds(): void {
    if (!this.memory) return;

    try {
      const records = this.memory.recall("authorized_chat_ids", 1);
      if (records.length > 0) {
        const chatIds = JSON.parse(records[0].content) as number[];
        for (const id of chatIds) {
          this.authorizedChatIds.add(id);
        }
        logger.info(`Loaded ${chatIds.length} authorized chat IDs from DB`);
      }
    } catch (error) {
      logger.debug("No persisted authorized chat IDs found", {
        error: (error as Error).message,
      });
    }
  }

  private persistAuthorizedChatIds(): void {
    if (!this.memory) return;

    try {
      const chatIds = Array.from(this.authorizedChatIds);
      this.memory.remember("authorized_chat_ids", JSON.stringify(chatIds));
      logger.debug(`Persisted ${chatIds.length} authorized chat IDs to DB`);
    } catch (error) {
      logger.error("Failed to persist authorized chat IDs", {
        error: (error as Error).message,
      });
    }
  }

  getBot(): Bot {
    return this.bot;
  }

  getAgent(): AgentController {
    return this.agent;
  }

  getAuthorizedChatIds(): Set<number> {
    return this.authorizedChatIds;
  }

  addAuthorizedChat(chatId: number): void {
    this.authorizedChatIds.add(chatId);
    this.persistAuthorizedChatIds();
    logger.info(`Authorized chat added: ${chatId}`);
  }

  /**
   * Revoke authorization for a chat ID.
   */
  revokeAuthorizedChat(chatId: number): boolean {
    const removed = this.authorizedChatIds.delete(chatId);
    if (removed) {
      this.persistAuthorizedChatIds();
      logger.info(`Authorization revoked for chat: ${chatId}`);
    }
    return removed;
  }

  isAuthorized(chatId: number): boolean {
    return this.authorizedChatIds.has(chatId);
  }

  /**
   * Attempt to authorize a chat ID using a passphrase.
   * Returns true if authorization succeeds, false otherwise.
   * Passphrase expires after 5 minutes.
   */
  tryAuthorizeWithPassphrase(chatId: number, message: string): boolean {
    // If already authorized, no need for passphrase
    if (this.authorizedChatIds.has(chatId)) {
      return true;
    }

    // If passphrase has already been used, reject
    if (this.passphraseUsed) {
      return false;
    }

    // Check if chatId is blocked due to too many failed attempts
    const attempts = this.failedAttempts.get(chatId);
    if (attempts && attempts.blockedUntil > Date.now()) {
      return false;
    }

    // Check if the passphrase has expired
    const elapsed = Date.now() - this.passphraseCreatedAt;
    if (elapsed > PASSPHRASE_EXPIRY_MS) {
      logger.warn("Passphrase has expired (5 minute limit)");
      return false;
    }

    // Timing-safe comparison
    const input = Buffer.from(message.trim());
    const expected = Buffer.from(authPassphrase);

    if (input.length !== expected.length) {
      this.trackFailedAttempt(chatId);
      return false;
    }

    const match = timingSafeEqual(input, expected);
    if (!match) {
      this.trackFailedAttempt(chatId);
      return false;
    }

    // Success - clear failed attempts and authorize
    this.failedAttempts.delete(chatId);
    this.addAuthorizedChat(chatId);
    this.passphraseUsed = true;
    logger.info(`Chat ${chatId} authorized via passphrase`);
    return true;
  }

  private trackFailedAttempt(chatId: number): void {
    const attempts = this.failedAttempts.get(chatId) ?? { count: 0, blockedUntil: 0 };
    attempts.count++;
    if (attempts.count >= MAX_AUTH_ATTEMPTS) {
      attempts.blockedUntil = Date.now() + BLOCK_DURATION_MS;
      logger.warn(`Chat ${chatId} blocked for ${BLOCK_DURATION_MS / 60000} minutes after ${MAX_AUTH_ATTEMPTS} failed auth attempts`);
    }
    this.failedAttempts.set(chatId, attempts);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    logger.info("Starting Telegram bot...");
    this.bot.start({
      onStart: () => {
        logger.info("Telegram bot started successfully");
      },
    });
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.bot.stop();
    logger.info("Telegram bot stopped");
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(chatId, text, { parse_mode: "HTML" });
    } catch (error) {
      logger.error(`Failed to send message to ${chatId}:`, {
        error: (error as Error).message,
      });
    }
  }

  async sendAlert(text: string): Promise<void> {
    for (const chatId of this.authorizedChatIds) {
      await this.sendMessage(chatId, text);
    }
  }
}
