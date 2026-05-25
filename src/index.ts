import { AgentController } from "./core/agent.js";
import { setupTelegram } from "./telegram/index.js";
import { createLogger } from "./core/logger.js";
import { config } from "./config.js";
import { createStrategies } from "./strategies/index.js";

const logger = createLogger("main");

const VERSION = "0.1.0";

function printBanner(): void {
  const walletStatus = config.SOLANA_PRIVATE_KEY ? "configured" : "not configured";

  logger.info("=".repeat(50));
  logger.info(`${config.AGENT_NAME} v${VERSION}`);
  logger.info("Autonomous money-making agent");
  logger.info("-".repeat(50));
  logger.info(`Wallet: ${walletStatus}`);
  logger.info(`RPC: ${config.SOLANA_RPC_URL}`);
  logger.info(`Log Level: ${config.LOG_LEVEL}`);
  logger.info("=".repeat(50));
}

async function main(): Promise<void> {
  printBanner();

  const agent = new AgentController();

  // Register strategies
  const strategies = createStrategies({
    memory: agent.getMemory(),
    wallet: agent.getWallet(),
  });

  for (const [_, strategy] of strategies) {
    agent.registerStrategy(strategy);
  }

  // Setup Telegram bot
  const { bot, alertManager } = setupTelegram(agent);

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
      alertManager.stop();
      await bot.stop();
      await agent.stop();
    } catch (error) {
      logger.error("Error during shutdown", {
        error: (error as Error).message,
      });
    }

    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Global error handlers
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", {
      error: reason instanceof Error ? reason.message : String(reason),
    });
    shutdown("unhandledRejection").catch(() => process.exit(1));
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", { error: error.message });
    // Attempt graceful shutdown for fatal errors
    shutdown("uncaughtException").catch(() => process.exit(1));
  });

  // Start agent
  await agent.start();

  // Perform initial connectivity check via the monitor
  const connectivityMonitor = agent.getConnectivityMonitor();
  const connectivityResults = await connectivityMonitor.checkAll();
  for (const status of connectivityResults) {
    if (status.reachable) {
      logger.info(`${status.endpoint}: reachable`);
    } else {
      logger.warn(`${status.endpoint}: unreachable`);
    }
  }

  // Start Telegram bot
  await bot.start();

  logger.info(`${config.AGENT_NAME} fully initialized and running`);
}

main().catch((error) => {
  logger.error("Fatal error during startup:", {
    error: (error as Error).message,
  });
  process.exit(1);
});
