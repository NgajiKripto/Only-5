import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  SOLANA_PRIVATE_KEY: z.string().min(1, "SOLANA_PRIVATE_KEY is required"),
  SOLANA_RPC_URL: z
    .string()
    .url()
    .default("https://api.mainnet-beta.solana.com"),
  GITHUB_TOKEN: z.string().optional(),
  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),
  DB_PATH: z.string().default("./data/only5.db"),
  AGENT_NAME: z.string().default("Only-5"),
});

export type Config = z.infer<typeof configSchema>;

export const config: Config = configSchema.parse({
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  SOLANA_PRIVATE_KEY: process.env.SOLANA_PRIVATE_KEY,
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || undefined,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || undefined,
  LOG_LEVEL: process.env.LOG_LEVEL || undefined,
  DB_PATH: process.env.DB_PATH || undefined,
  AGENT_NAME: process.env.AGENT_NAME || undefined,
});
