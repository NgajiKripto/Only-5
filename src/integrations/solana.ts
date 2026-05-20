import { Connection, PublicKey } from "@solana/web3.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("solana");

const LAMPORTS_PER_SOL = 1_000_000_000;

export function createConnection(rpcUrl: string): Connection {
  logger.info(`Creating Solana connection to ${rpcUrl}`);
  return new Connection(rpcUrl, "confirmed");
}

export async function getTokenAccountsByOwner(
  connection: Connection,
  owner: PublicKey
): Promise<
  Array<{
    pubkey: string;
    mint: string;
    amount: number;
    decimals: number;
  }>
> {
  const tokenProgramId = new PublicKey(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
  );

  const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: tokenProgramId,
  });

  return accounts.value.map((account) => {
    const data = account.account.data.parsed.info;
    return {
      pubkey: account.pubkey.toBase58(),
      mint: data.mint as string,
      amount: Number(data.tokenAmount.uiAmount),
      decimals: data.tokenAmount.decimals as number,
    };
  });
}

export async function waitForConfirmation(
  connection: Connection,
  signature: string,
  timeoutMs: number = 30000
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const status = await connection.getSignatureStatus(signature);

    if (status.value !== null) {
      if (status.value.err) {
        logger.error(`Transaction failed: ${signature}`, {
          error: status.value.err,
        });
        return false;
      }
      if (
        status.value.confirmationStatus === "confirmed" ||
        status.value.confirmationStatus === "finalized"
      ) {
        logger.debug(`Transaction confirmed: ${signature}`);
        return true;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  logger.warn(`Transaction confirmation timeout: ${signature}`);
  return false;
}

export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

export function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}
