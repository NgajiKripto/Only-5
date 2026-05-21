import type { AgentController } from "../core/agent.js";
import { TelegramBot } from "./bot.js";
import { AlertManager } from "./alerts.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerBalanceCommand } from "./commands/balance.js";
import { registerStrategiesCommands } from "./commands/strategies.js";
import { registerReportCommands } from "./commands/report.js";
import { registerControlCommands } from "./commands/control.js";
import { registerLogsCommands } from "./commands/logs.js";
import { registerSecurityCommands } from "./commands/security.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("telegram");

export { TelegramBot } from "./bot.js";
export { AlertManager, AlertType } from "./alerts.js";

export interface TelegramSetupResult {
  bot: TelegramBot;
  alertManager: AlertManager;
}

export function setupTelegram(
  agent: AgentController,
  authorizedChatIds?: number[]
): TelegramSetupResult {
  const bot = new TelegramBot(agent, authorizedChatIds);
  const grammyBot = bot.getBot();

  // Register authorization middleware
  grammyBot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (bot.isAuthorized(chatId)) {
      await next();
      return;
    }

    // If not authorized, check if the message is a passphrase attempt
    const messageText = ctx.message?.text;
    if (messageText && bot.tryAuthorizeWithPassphrase(chatId, messageText)) {
      await ctx.reply("Authorization successful. You now have full access.");
      await next();
    } else {
      logger.warn(`Unauthorized access attempt from chat ${chatId}`);
      await ctx.reply("Unauthorized. Send the auth passphrase to gain access.");
    }
  });

  // Register all command handlers
  registerStatusCommand(grammyBot, agent);
  registerBalanceCommand(grammyBot, agent);
  registerStrategiesCommands(grammyBot, agent);
  registerReportCommands(grammyBot, agent);
  registerControlCommands(grammyBot, agent);
  registerLogsCommands(grammyBot, agent);
  registerSecurityCommands(grammyBot, agent);

  // Create alert manager
  const alertManager = new AlertManager(bot);

  // Wire agent events to alerts
  agent.on("alert", (alertData: { type: string; strategy?: string; amount?: number; message?: string; details?: string }) => {
    if (alertData.type === "profit" && alertData.amount) {
      alertManager.onProfit(alertData.amount);
    } else if (alertData.type === "loss" && alertData.amount) {
      alertManager.onLoss(Math.abs(alertData.amount));
    } else if (alertData.type === "error" && alertData.message) {
      alertManager.onError(alertData.message);
    }
  });

  logger.info("Telegram bot configured with all command handlers");

  return { bot, alertManager };
}
