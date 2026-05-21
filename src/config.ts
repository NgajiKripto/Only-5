import dotenv from "dotenv";
import { z } from "zod";
import { randomUUID } from "crypto";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

dotenv.config();

const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_OWNER_CHAT_ID: z.string().optional(),
  TELEGRAM_AUTH_PASSPHRASE: z.string().optional(),
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  SOLANA_PRIVATE_KEY: z.string().min(1, "SOLANA_PRIVATE_KEY is required"),
  SOLANA_RPC_URL: z
    .string()
    .url()
    .default("https://api.mainnet-beta.solana.com"),
  GITHUB_TOKEN: z.string().optional(),
  HACKERONE_API_TOKEN: z.string().optional(),
  IMMUNEFI_API_KEY: z.string().optional(),
  SECURITY_SCAN_PRICE_SOL: z.string().optional().default("0.1"),
  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),
  DB_PATH: z.string().default("./data/only5.db"),
  AGENT_NAME: z.string().default("Only-5"),
});

export type Config = z.infer<typeof configSchema>;

// Generate a default passphrase if not configured and no owner chat ID is set
const defaultPassphrase = randomUUID();

export const config: Config = configSchema.parse({
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_OWNER_CHAT_ID: process.env.TELEGRAM_OWNER_CHAT_ID || undefined,
  TELEGRAM_AUTH_PASSPHRASE: process.env.TELEGRAM_AUTH_PASSPHRASE || undefined,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  SOLANA_PRIVATE_KEY: process.env.SOLANA_PRIVATE_KEY,
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || undefined,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || undefined,
  HACKERONE_API_TOKEN: process.env.HACKERONE_API_TOKEN || undefined,
  IMMUNEFI_API_KEY: process.env.IMMUNEFI_API_KEY || undefined,
  SECURITY_SCAN_PRICE_SOL: process.env.SECURITY_SCAN_PRICE_SOL || undefined,
  LOG_LEVEL: process.env.LOG_LEVEL || undefined,
  DB_PATH: process.env.DB_PATH || undefined,
  AGENT_NAME: process.env.AGENT_NAME || undefined,
});

// If no owner chat ID and no passphrase configured, use the generated default
// and write it to a secure file so the operator can retrieve it.
// Check data/auth-passphrase.txt to get the one-time passphrase.
export const authPassphrase: string = config.TELEGRAM_AUTH_PASSPHRASE ?? defaultPassphrase;
if (!config.TELEGRAM_OWNER_CHAT_ID && !config.TELEGRAM_AUTH_PASSPHRASE) {
  const passphraseFile = "data/auth-passphrase.txt";
  try {
    mkdirSync(dirname(passphraseFile), { recursive: true });
    writeFileSync(
      passphraseFile,
      `# One-time auth passphrase for Telegram bot authorization\n# Send this passphrase to the bot to authorize yourself.\n# This file is restricted to owner-only access (0600).\n${authPassphrase}\n`,
      { mode: 0o600 }
    );
    console.log(`[AUTH] No TELEGRAM_OWNER_CHAT_ID or TELEGRAM_AUTH_PASSPHRASE set.`);
    console.log(`[AUTH] Passphrase written to ${passphraseFile} (mode 0600).`);
    console.log(`[AUTH] Read that file to get your one-time authorization passphrase.`);
  } catch {
    // Fallback: if file write fails, still do not log the passphrase itself
    console.log(`[AUTH] No TELEGRAM_OWNER_CHAT_ID or TELEGRAM_AUTH_PASSPHRASE set.`);
    console.log(`[AUTH] Could not write passphrase file. Set TELEGRAM_AUTH_PASSPHRASE in .env.`);
  }
}
