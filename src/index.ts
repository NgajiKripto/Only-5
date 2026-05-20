import { AgentController } from "./core/agent.js";
import { setupTelegram } from "./telegram/index.js";
import { createLogger } from "./core/logger.js";
import { config } from "./config.js";

const logger = createLogger("main");

const VERSION = "0.1.0";

async function checkConnectivity(): Promise<void> {
  // Check OpenRouter connectivity
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}` },
    });
    clearTimeout(timeout);
    if (!response.ok) {
      logger.warn(`OpenRouter API responded with status ${response.status}`);
    } else {
      logger.info("OpenRouter API: reachable");
    }
  } catch (error) {
    logger.warn("OpenRouter API: unreachable", {
      error: (error as Error).message,
    });
  }

  // Check Solana RPC connectivity
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(config.SOLANA_RPC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
      }),
    });
    clearTimeout(timeout);
    if (response.ok) {
      logger.info("Solana RPC: reachable");
    } else {
      logger.warn(`Solana RPC responded with status ${response.status}`);
    }
  } catch (error) {
    logger.warn("Solana RPC: unreachable", {
      error: (error as Error).message,
    });
  }
}

function printBanner(): void {
  const walletAddress = config.SOLANA_PRIVATE_KEY
    ? "****" + config.SOLANA_PRIVATE_KEY.slice(-8)
    : "not configured";

  logger.info("=".repeat(50));
  logger.info(`${config.AGENT_NAME} v${VERSION}`);
  logger.info("Autonomous money-making agent");
  logger.info("-".repeat(50));
  logger.info(`Wallet: ${walletAddress}`);
  logger.info(`RPC: ${config.SOLANA_RPC_URL}`);
  logger.info(`Log Level: ${config.LOG_LEVEL}`);
  logger.info("=".repeat(50));
}

async function main(): Promise<void> {
  printBanner();

  // Check API connectivity
  await checkConnectivity();

  const agent = new AgentController();

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
