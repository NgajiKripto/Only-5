// TODO: Connection and Keypair are only used in signAndSendSwapLegacy (deprecated).
// Remove these imports when signAndSendSwapLegacy is deleted.
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { createLogger } from "../core/logger.js";
import type { WalletManager } from "../core/wallet.js";
import { waitForConfirmation } from "./solana.js";
import { JUPITER_MAX_RETRIES, JUPITER_BASE_BACKOFF_MS } from "../constants.js";

const logger = createLogger("jupiter");

const JUPITER_QUOTE_API = "https://quote-api.jup.ag/v6";
const JUPITER_PRICE_API = "https://price.jup.ag/v6";

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  routePlan: unknown[];
}

export interface SwapTransaction {
  swapTransaction: string;
  lastValidBlockHeight: number;
}

export interface TokenPrice {
  id: string;
  mintSymbol: string;
  vsToken: string;
  vsTokenSymbol: string;
  price: number;
}

export class JupiterError extends Error {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = "JupiterError";
  }
}

export async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps: number = 50
): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: slippageBps.toString(),
  });

  const url = `${JUPITER_QUOTE_API}/quote?${params}`;
  logger.debug(`Fetching Jupiter quote`, { inputMint, outputMint, amount });

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();
    throw new JupiterError(
      `Jupiter quote failed: ${response.status} - ${body}`,
      response.status
    );
  }

  const data = (await response.json()) as JupiterQuote;
  logger.debug(`Got quote: ${data.inAmount} -> ${data.outAmount}`);
  return data;
}

export async function executeSwap(
  quote: JupiterQuote,
  userPublicKey: string
): Promise<SwapTransaction> {
  const url = `${JUPITER_QUOTE_API}/swap`;

  logger.info(`Executing swap`, {
    inputMint: quote.inputMint,
    outputMint: quote.outputMint,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new JupiterError(
      `Jupiter swap failed: ${response.status} - ${body}`,
      response.status
    );
  }

  const data = (await response.json()) as SwapTransaction;
  logger.info(`Swap transaction received`, {
    lastValidBlockHeight: data.lastValidBlockHeight,
  });
  return data;
}

/**
 * Signs a swap transaction using the WalletManager (without exposing the keypair)
 * and submits it to the Solana network with retry logic on blockhash expiration.
 * Retries up to 3 times with exponential backoff.
 */
export async function signAndSendSwap(
  swapTransaction: SwapTransaction,
  wallet: WalletManager
): Promise<string> {
  const connection = wallet.getConnection();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < JUPITER_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const backoff = JUPITER_BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        logger.info(`Retry attempt ${attempt + 1}/${JUPITER_MAX_RETRIES} after ${backoff}ms backoff`);
        await new Promise((resolve) => setTimeout(resolve, backoff));

        // Fetch a fresh blockhash for retries
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        logger.debug(`Fresh blockhash obtained for retry: ${blockhash.substring(0, 8)}...`);
      }

      // Deserialize the transaction from base64
      const transactionBuf = Buffer.from(swapTransaction.swapTransaction, "base64");

      // Use wallet's signing method instead of exposing keypair
      const signature = await wallet.signAndSendVersionedTransaction(transactionBuf);

      logger.info(`Transaction submitted: ${signature}`);

      // Wait for confirmation
      const confirmed = await waitForConfirmation(connection, signature, 30000);
      if (!confirmed) {
        throw new JupiterError(`Transaction failed to confirm: ${signature}`);
      }

      logger.info(`Transaction confirmed: ${signature}`);
      return signature;
    } catch (error) {
      lastError = error as Error;
      const errorMessage = lastError.message.toLowerCase();

      // Retry on blockhash expiration or confirmation timeout
      const isRetryable =
        errorMessage.includes("blockhash") ||
        errorMessage.includes("expired") ||
        errorMessage.includes("failed to confirm");

      if (!isRetryable || attempt === JUPITER_MAX_RETRIES - 1) {
        throw lastError;
      }

      logger.warn(`Transaction attempt ${attempt + 1} failed (retryable): ${lastError.message}`);
    }
  }

  throw lastError ?? new JupiterError("Transaction failed after all retries");
}

/**
 * @deprecated Use signAndSendSwap(swapTransaction, wallet) instead.
 * Legacy function that accepts a raw Keypair - kept for backward compatibility during migration.
 */
export async function signAndSendSwapLegacy(
  swapTransaction: SwapTransaction,
  keypair: Keypair,
  connection: Connection
): Promise<string> {
  // Deserialize the transaction from base64
  const transactionBuf = Buffer.from(swapTransaction.swapTransaction, "base64");
  const transaction = VersionedTransaction.deserialize(transactionBuf);

  // Sign the transaction with the wallet keypair
  transaction.sign([keypair]);

  // Submit the signed transaction to the network
  const rawTransaction = transaction.serialize();
  const signature = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    maxRetries: 2,
  });

  logger.info(`Transaction submitted: ${signature}`);

  // Wait for confirmation
  const confirmed = await waitForConfirmation(connection, signature, 30000);
  if (!confirmed) {
    throw new JupiterError(`Transaction failed to confirm: ${signature}`);
  }

  logger.info(`Transaction confirmed: ${signature}`);
  return signature;
}

export async function getTokenPrice(
  mint: string
): Promise<number | null> {
  const params = new URLSearchParams({ ids: mint });
  const url = `${JUPITER_PRICE_API}/price?${params}`;

  logger.debug(`Fetching token price`, { mint });

  const response = await fetch(url);

  if (!response.ok) {
    logger.warn(`Failed to fetch price for ${mint}: ${response.status}`);
    return null;
  }

  const data = (await response.json()) as {
    data: Record<string, TokenPrice>;
  };

  const priceData = data.data[mint];
  if (!priceData) {
    logger.warn(`No price data found for ${mint}`);
    return null;
  }

  return priceData.price;
}
