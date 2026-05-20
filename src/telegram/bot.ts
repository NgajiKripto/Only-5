import { Bot, GrammyError, HttpError } from "grammy";
import { config } from "../config.js";
import { createLogger } from "../core/logger.js";
import type { AgentController } from "../core/agent.js";

const logger = createLogger("telegram-bot");

export class TelegramBot {
  private bot: Bot;
  private agent: AgentController;
  private authorizedChatIds: Set<number> = new Set();
  private started: boolean = false;

  constructor(agent: AgentController, authorizedChatIds?: number[]) {
    this.agent = agent;
    this.bot = new Bot(config.TELEGRAM_BOT_TOKEN);

    if (authorizedChatIds && authorizedChatIds.length > 0) {
      for (const id of authorizedChatIds) {
        this.authorizedChatIds.add(id);
      }
    }

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
    logger.info(`Authorized chat added: ${chatId}`);
  }

  isAuthorized(chatId: number): boolean {
    // If no authorized chats set, authorize the first user
    if (this.authorizedChatIds.size === 0) {
      this.addAuthorizedChat(chatId);
      return true;
    }
    return this.authorizedChatIds.has(chatId);
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
