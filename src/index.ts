import { AgentController } from "./core/agent.js";
import { setupTelegram } from "./telegram/index.js";
import { createLogger } from "./core/logger.js";
import { config } from "./config.js";

const logger = createLogger("main");

async function main(): Promise<void> {
  logger.info(`${config.AGENT_NAME} Starting...`);

  const agent = new AgentController();

  // Setup Telegram bot
  const { bot, alertManager } = setupTelegram(agent);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    alertManager.stop();
    await bot.stop();
    await agent.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start agent
  await agent.start();

  // Start Telegram bot
  await bot.start();

  logger.info(`${config.AGENT_NAME} fully initialized`);
}

main().catch((error) => {
  logger.error("Fatal error:", { error: (error as Error).message });
  process.exit(1);
});
