import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    env: {
      TELEGRAM_BOT_TOKEN: "test-token",
      OPENROUTER_API_KEY: "test-key",
      SOLANA_PRIVATE_KEY: "5zGXqXosiizzRPZDzqUPM3jdUraaB2kyS7323Y1JxsktvDMHLmjZYLhfShR4NWvpXQAgxjABye2YeYUDyM74Ccjv",
      SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com",
      LOG_LEVEL: "info",
      DB_PATH: "./data/test.db",
      AGENT_NAME: "Only-5-Test",
    },
  },
});
